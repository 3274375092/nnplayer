import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DesktopLyricsClockAnchor,
  DesktopLyricsTimelineSnapshot,
} from "@/lyrics/desktopLyricsSync";
import {
  createDesktopLyricsReceiver,
  createAnchoredPlaybackClock,
  type DesktopLyricsReceiverState,
} from "@/lyrics/desktopLyricsSync";
import {
  createDesktopLyricsSnapshotRecovery,
  registerDesktopLyricsListenersAtomically,
} from "@/lyrics/desktopLyricsTransport";
import { projectLyricFrame } from "@/lyrics/lyricFrame";
import { DEFAULT_DESKTOP_ACCENT } from "@/utils/themeTokens";

export interface DesktopLyricsBridgeState extends DesktopLyricsReceiverState {
  accentColor: string;
}

/**
 * 桌面歌词窗与主窗之间的连接状态。
 *   - connecting：已开始握手，尚未收到任何 Timeline Snapshot（首开默认态）；
 *   - ready：已收到主窗快照，可以渲染歌词；
 *   - retrying：握手超时或监听注册失败，正在后台重试（必须可见，不能只留日志）。
 */
export type DesktopLyricsConnectionStatus = "connecting" | "ready" | "retrying";

interface DesktopLyricsAppearancePayload {
  accentColor: string;
}

const REQUEST_SNAPSHOT_EVENT = "desktop-lyrics:request-snapshot";
const MAIN_WINDOW_LABEL = "main";
/** 首开超过该时长仍未收到快照 → 可见的「连接较慢」态（评审要求约 2.5s）。 */
const CONNECTING_SLOW_AFTER_MS = 2_500;
/** 传输静默判定：首包已用 burst 覆盖启动竞态，watchdog 作为慢链路兜底。 */
const TRANSPORT_STALE_AFTER_MS = 4_000;
const RETRY_EVERY_MS = 2_000;
/** 首包重试节奏：覆盖主窗监听注册晚于子窗请求的启动竞态。 */
const SNAPSHOT_BURST_RETRY_DELAYS_MS = [300, 900, 1_600, 2_400, 3_200] as const;
/** 监听注册失败后的重试退避（IPC/权限问题常是暂时的，不能注册失败就永久放弃）。 */
const LISTENER_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;
const LISTENER_RETRY_MAX_DELAY_MS = 8_000;
/**
 * 本地时钟投影节奏：33ms（≈30fps）。子窗的消费者（卡拉OK擦色）本来就按 50ms
 * 桶取样，60fps 的 rAF 只是把同一段 computed 白跑两倍；33ms 与 50ms 桶对齐后
 * 既不丢擦色精度，又把子窗的 JS/投影负载减半。
 */
const FRAME_INTERVAL_MS = 33;

export function useDesktopLyricsBridge() {
  const receiver = createDesktopLyricsReceiver();
  const anchoredClock = createAnchoredPlaybackClock();
  let accentColor = DEFAULT_DESKTOP_ACCENT;
  const state = shallowRef<DesktopLyricsBridgeState>({
    ...receiver.state,
    accentColor,
  });
  /** 连接态是 UI 关心的独立状态，不混进按协议推送的 receiver state。 */
  const connectionStatus = ref<DesktopLyricsConnectionStatus>("connecting");
  const connectionError = ref("");
  const localPositionMs = ref(0);
  const unlistens: UnlistenFn[] = [];
  let disposed = false;
  let frameRequest = 0;
  let lastFrameTickAt = 0;
  let recoveryStarted = false;
  let listenerRetryAttempt = 0;
  let listenerRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectingSlowTimer: ReturnType<typeof setTimeout> | undefined;
  let retryingLogged = false;
  let requestFailureLogged = false;

  function clearConnectingSlowTimer() {
    if (connectingSlowTimer) clearTimeout(connectingSlowTimer);
    connectingSlowTimer = undefined;
  }

  function markRetrying(reason = "") {
    // 一旦就绪不再回退：主窗常驻托盘，短暂静默由 recovery 后台修复，
    // 避免暂停/无事件时占位文案在「等待播放」与「正在重试」之间闪烁。
    if (disposed || connectionStatus.value === "ready") return;
    if (reason) connectionError.value = reason;
    connectionStatus.value = "retrying";
    if (!retryingLogged) {
      retryingLogged = true;
      console.warn(
        "[desktop-lyrics] 连接未就绪，正在重试：",
        reason || "等待主窗快照超时",
      );
    }
  }

  function markReady() {
    clearConnectingSlowTimer();
    connectionError.value = "";
    connectionStatus.value = "ready";
    requestFailureLogged = false;
  }

  function requestSnapshotOnce() {
    if (disposed) return;
    // 定向发送失败（窗口 label 路由异常等）时退回广播，首开握手不依赖单一路由。
    void emitTo(MAIN_WINDOW_LABEL, REQUEST_SNAPSHOT_EVENT).catch((error) => {
      if (!requestFailureLogged) {
        requestFailureLogged = true;
        console.error("[desktop-lyrics] 快照请求定向发送失败，改用广播", error);
      }
      void emit(REQUEST_SNAPSHOT_EVENT).catch((fallbackError) => {
        if (!requestFailureLogged) {
          requestFailureLogged = true;
          console.error("[desktop-lyrics] 快照请求广播失败", fallbackError);
        }
        markRetrying("桌面歌词无法联系主窗口，正在重试…");
      });
    });
  }

  const snapshotRecovery = createDesktopLyricsSnapshotRecovery(
    {
      now: () => Date.now(),
      request: () => requestSnapshotOnce(),
      schedule: (delayMs, task) => setTimeout(task, delayMs),
      cancel: (handle) => clearTimeout(handle),
    },
    {
      staleAfterMs: TRANSPORT_STALE_AFTER_MS,
      retryEveryMs: RETRY_EVERY_MS,
      burstRetryDelaysMs: SNAPSHOT_BURST_RETRY_DELAYS_MS,
      onRetry: () => markRetrying(),
    },
  );

  function publishReceiverState() {
    state.value = {
      ...receiver.state,
      accentColor,
    };
  }

  function shouldProjectRealtime() {
    return receiver.state.status === "ready" &&
      receiver.state.playing &&
      typeof document !== "undefined" &&
      document.visibilityState === "visible";
  }

  function stopFrameLoop() {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }

  function frameTick() {
    frameRequest = 0;
    if (!shouldProjectRealtime()) return;
    const now = performance.now();
    // rAF 仍负责对齐刷新节拍，但只在跨过 33ms 桶时重算一次位置。
    if (now - lastFrameTickAt >= FRAME_INTERVAL_MS) {
      lastFrameTickAt = now;
      localPositionMs.value = anchoredClock.positionAt(now);
    }
    frameRequest = requestAnimationFrame(frameTick);
  }

  function updateFrameLoop() {
    if (!shouldProjectRealtime()) {
      stopFrameLoop();
      return;
    }
    if (!frameRequest) {
      // 从暂停/隐藏恢复时立即补一帧，不等下一个 33ms 桶。
      lastFrameTickAt = 0;
      frameRequest = requestAnimationFrame(frameTick);
    }
  }

  function applyClockAnchor() {
    const receipt = {
      wallTimeMs: Date.now(),
      monotonicTimeMs: performance.now(),
    };
    const { needsRefresh } = anchoredClock.accept(receiver.state, receipt);
    localPositionMs.value = anchoredClock.positionAt(receipt.monotonicTimeMs);
    if (needsRefresh) snapshotRecovery.ensure(receiver.state.songId);
    updateFrameLoop();
  }

  const frame = computed(() =>
    projectLyricFrame(
      {
        lines: state.value.lines,
        tokensByLine: state.value.tokensByLine,
      },
      localPositionMs.value,
    )
  );

  function onClock(payload: DesktopLyricsClockAnchor) {
    if (disposed) return;
    const previousRevision = receiver.state.revision;
    receiver.receiveClock(payload);
    if (receiver.state.revision === previousRevision) return;
    snapshotRecovery.noteAlive(receiver.state.songId);
    publishReceiverState();
    applyClockAnchor();
    if (receiver.state.status === "syncing") {
      snapshotRecovery.ensure(receiver.state.songId);
    } else {
      snapshotRecovery.resolve();
    }
  }

  function onSnapshot(payload: DesktopLyricsTimelineSnapshot) {
    if (disposed) return;
    const previousRevision = receiver.state.revision;
    receiver.receiveSnapshot(payload);
    if (receiver.state.revision === previousRevision) return;
    snapshotRecovery.noteAlive(receiver.state.songId);
    snapshotRecovery.resolve();
    publishReceiverState();
    applyClockAnchor();
    markReady();
  }

  function onAppearance(payload: DesktopLyricsAppearancePayload) {
    if (disposed || typeof payload.accentColor !== "string" || !payload.accentColor) {
      return;
    }
    accentColor = payload.accentColor;
    publishReceiverState();
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible") {
      localPositionMs.value = anchoredClock.positionAt(performance.now());
      snapshotRecovery.ensure(receiver.state.songId);
    }
    updateFrameLoop();
  }

  /** 注册三个桥接监听；失败由调用方决定重试并展示可见状态。 */
  async function registerBridgeListeners(): Promise<boolean> {
    try {
      const stops = await registerDesktopLyricsListenersAtomically([
        () =>
          listen<DesktopLyricsTimelineSnapshot>(
            "desktop-lyrics:snapshot",
            (event) => onSnapshot(event.payload),
          ),
        () =>
          listen<DesktopLyricsClockAnchor>(
            "desktop-lyrics:clock",
            (event) => onClock(event.payload),
          ),
        () =>
          listen<DesktopLyricsAppearancePayload>(
            "desktop-lyrics:appearance",
            (event) => onAppearance(event.payload),
          ),
      ]);
      if (disposed) {
        stops.forEach((stop) => stop());
        return false;
      }
      unlistens.push(...stops);
      return true;
    } catch (e) {
      // 监听注册失败（IPC/权限问题）会让整条桌面歌词通道无声失效；
      // 不在这里 return 掉，改为带退避重试并让窗口显示「连接失败，正在重试…」。
      console.error("[desktop-lyrics] 监听注册失败，将重试", e);
      return false;
    }
  }

  function scheduleListenerRetry() {
    if (disposed) return;
    const index = Math.min(
      listenerRetryAttempt,
      LISTENER_RETRY_DELAYS_MS.length - 1,
    );
    const delayMs = Math.min(
      LISTENER_RETRY_DELAYS_MS[index] ?? LISTENER_RETRY_MAX_DELAY_MS,
      LISTENER_RETRY_MAX_DELAY_MS,
    );
    listenerRetryAttempt += 1;
    markRetrying("桌面歌词连接失败，正在重试…");
    listenerRetryTimer = setTimeout(() => {
      listenerRetryTimer = undefined;
      void retryBridgeListeners();
    }, delayMs);
  }

  async function retryBridgeListeners() {
    if (disposed) return;
    const registered = await registerBridgeListeners();
    if (disposed) return;
    if (!registered) {
      scheduleListenerRetry();
      return;
    }
    startSnapshotRecovery();
  }

  function startSnapshotRecovery() {
    if (disposed || recoveryStarted) return;
    recoveryStarted = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
    snapshotRecovery.start(receiver.state.songId);
  }

  onMounted(async () => {
    disposed = false;
    // 首开先展示「正在连接桌面歌词…」；2.5s 内没有快照就升级为可见的
    // 「连接较慢，正在重试…」。slow timer 覆盖「监听注册本身卡住」，
    // recovery 的 watchdog 覆盖「注册成功但主窗不回快照」。
    connectionStatus.value = "connecting";
    connectionError.value = "";
    retryingLogged = false;
    clearConnectingSlowTimer();
    connectingSlowTimer = setTimeout(() => {
      connectingSlowTimer = undefined;
      markRetrying();
    }, CONNECTING_SLOW_AFTER_MS);
    const registered = await registerBridgeListeners();
    if (disposed || !registered) {
      if (!disposed) scheduleListenerRetry();
      return;
    }
    startSnapshotRecovery();
  });

  onBeforeUnmount(() => {
    disposed = true;
    clearConnectingSlowTimer();
    if (listenerRetryTimer) clearTimeout(listenerRetryTimer);
    listenerRetryTimer = undefined;
    snapshotRecovery.dispose();
    stopFrameLoop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unlistens.forEach((stop) => stop());
    unlistens.length = 0;
  });

  return { state, frame, connectionStatus, connectionError };
}
