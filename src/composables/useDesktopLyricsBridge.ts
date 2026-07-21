import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
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

interface DesktopLyricsAppearancePayload {
  accentColor: string;
}

export function useDesktopLyricsBridge() {
  const receiver = createDesktopLyricsReceiver();
  const anchoredClock = createAnchoredPlaybackClock();
  let accentColor = DEFAULT_DESKTOP_ACCENT;
  const state = shallowRef<DesktopLyricsBridgeState>({
    ...receiver.state,
    accentColor,
  });
  const localPositionMs = ref(0);
  const unlistens: UnlistenFn[] = [];
  let disposed = false;
  let frameRequest = 0;

  function requestSnapshotOnce() {
    if (disposed) return;
    void emitTo("main", "desktop-lyrics:request-snapshot").catch(() => {});
  }

  const snapshotRecovery = createDesktopLyricsSnapshotRecovery({
    now: () => Date.now(),
    request: () => requestSnapshotOnce(),
    schedule: (delayMs, task) => setTimeout(task, delayMs),
    cancel: (handle) => clearTimeout(handle),
  });

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
    localPositionMs.value = anchoredClock.positionAt(performance.now());
    frameRequest = requestAnimationFrame(frameTick);
  }

  function updateFrameLoop() {
    if (!shouldProjectRealtime()) {
      stopFrameLoop();
      return;
    }
    if (!frameRequest) frameRequest = requestAnimationFrame(frameTick);
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

  onMounted(async () => {
    disposed = false;
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
      return;
    }
    unlistens.push(...stops);
    document.addEventListener("visibilitychange", onVisibilityChange);
    snapshotRecovery.start(receiver.state.songId);
  });

  onBeforeUnmount(() => {
    disposed = true;
    snapshotRecovery.dispose();
    stopFrameLoop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unlistens.forEach((stop) => stop());
    unlistens.length = 0;
  });

  return { state, frame };
}
