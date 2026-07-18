// 桌面歌词窗口订阅桥：完整时间轴快照与轻量媒体时钟使用独立通道。
// 必须先注册两个监听器再请求快照，避免窗口打开时丢失首包。

import { onBeforeUnmount, onMounted, ref } from "vue";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DesktopLyricsClockPayload,
  DesktopLyricsSnapshotPayload,
  KaraokeToken,
} from "@/composables/useLyric";
import type { LyricLine } from "@/utils/lrcParser";

export interface DesktopLyricsBridgeState {
  sessionId: string;
  sessionStartedAt: number;
  songId: number | null;
  /** 最近应用的任意通道序号，仅用于触发子窗重锚。 */
  sequence: number;
  songName: string;
  artists: string;
  lines: LyricLine[];
  tokensByLine: KaraokeToken[][];
  accentColor: string;
  positionMs: number;
  sampledAt: number;
  playing: boolean;
  playbackRate: number;
  seekRevision: number;
}

function createEmptyState(): DesktopLyricsBridgeState {
  return {
    sessionId: "",
    sessionStartedAt: 0,
    songId: null,
    sequence: -1,
    songName: "",
    artists: "",
    lines: [],
    tokensByLine: [],
    accentColor: "#E85D3A",
    positionMs: 0,
    sampledAt: 0,
    playing: false,
    playbackRate: 1,
    seekRevision: 0,
  };
}

type SessionPacket = Pick<
  DesktopLyricsClockPayload,
  "sessionId" | "sessionStartedAt" | "songId" | "sequence"
>;

export function useDesktopLyricsBridge() {
  const state = ref<DesktopLyricsBridgeState>(createEmptyState());
  const unlistens: UnlistenFn[] = [];
  const snapshotTimers: Array<ReturnType<typeof setTimeout>> = [];
  let disposed = false;
  let lastSessionStartedAt = 0;
  let lastSessionId = "";
  let lastClockSequence = -1;
  let lastSnapshotSequence = -1;
  let snapshotSongId: number | null | undefined;
  let pendingSnapshotSongId: number | null | undefined;

  function clearSnapshotTimers() {
    snapshotTimers.forEach((timer) => clearTimeout(timer));
    snapshotTimers.length = 0;
    pendingSnapshotSongId = undefined;
  }

  function requestSnapshot() {
    if (disposed) return;
    void emitTo("main", "desktop-lyrics:request-snapshot").catch(() => {});
  }

  function scheduleSnapshotRequest(songId: number | null) {
    if (pendingSnapshotSongId === songId && snapshotTimers.length > 0) return;
    clearSnapshotTimers();
    pendingSnapshotSongId = songId;
    requestSnapshot();
    for (const delay of [500, 1500]) {
      snapshotTimers.push(setTimeout(requestSnapshot, delay));
    }
  }

  /** 校验会话并在主窗重载后原子重置两个通道的序号。 */
  function acceptSession(payload: SessionPacket): boolean {
    if (
      typeof payload.sessionId !== "string" ||
      payload.sessionId.length === 0 ||
      !Number.isFinite(payload.sessionStartedAt) ||
      payload.sessionStartedAt < lastSessionStartedAt ||
      !Number.isSafeInteger(payload.sequence)
    ) {
      return false;
    }

    if (
      payload.sessionStartedAt > lastSessionStartedAt ||
      payload.sessionId !== lastSessionId
    ) {
      lastSessionStartedAt = payload.sessionStartedAt;
      lastSessionId = payload.sessionId;
      lastClockSequence = -1;
      lastSnapshotSequence = -1;
      snapshotSongId = undefined;
      state.value = {
        ...createEmptyState(),
        sessionId: payload.sessionId,
        sessionStartedAt: payload.sessionStartedAt,
      };
    }
    return true;
  }

  function normalizedClock(payload: DesktopLyricsClockPayload) {
    return {
      positionMs: Number.isFinite(payload.positionMs)
        ? Math.max(0, payload.positionMs)
        : 0,
      sampledAt: Number.isFinite(payload.sampledAt) && payload.sampledAt > 0
        ? payload.sampledAt
        : Date.now(),
      playbackRate:
        Number.isFinite(payload.playbackRate) && payload.playbackRate > 0
          ? payload.playbackRate
          : 1,
      seekRevision: Number.isSafeInteger(payload.seekRevision)
        ? Math.max(0, payload.seekRevision)
        : 0,
      playing: payload.playing === true,
    };
  }

  function onClock(payload: DesktopLyricsClockPayload) {
    if (disposed || !acceptSession(payload)) return;
    if (payload.sequence <= lastClockSequence) return;

    const songChanged = payload.songId !== state.value.songId;
    lastClockSequence = payload.sequence;
    state.value = {
      ...state.value,
      ...(songChanged && snapshotSongId !== payload.songId
        ? {
            songName: "",
            artists: "",
            lines: [],
            tokensByLine: [],
            accentColor: "#E85D3A",
          }
        : {}),
      sessionId: payload.sessionId,
      sessionStartedAt: payload.sessionStartedAt,
      songId: payload.songId,
      sequence: Math.max(state.value.sequence, payload.sequence),
      ...normalizedClock(payload),
    };

    // 若先收到新歌时钟而快照仍在路上，主动补拉，避免时间轴永久为空。
    if (snapshotSongId !== payload.songId) {
      scheduleSnapshotRequest(payload.songId);
    }
  }

  function onSnapshot(payload: DesktopLyricsSnapshotPayload) {
    if (disposed || !acceptSession(payload)) return;
    if (payload.sequence <= lastSnapshotSequence) return;

    // 新歌时钟已经到达时，迟到的上一首歌快照不能覆盖当前时间轴。
    if (
      payload.songId !== state.value.songId &&
      payload.sequence < lastClockSequence
    ) {
      return;
    }

    lastSnapshotSequence = payload.sequence;
    snapshotSongId = payload.songId;
    clearSnapshotTimers();

    const snapshotHasNewestClock = payload.sequence > lastClockSequence;
    if (snapshotHasNewestClock) lastClockSequence = payload.sequence;
    state.value = {
      ...state.value,
      sessionId: payload.sessionId,
      sessionStartedAt: payload.sessionStartedAt,
      songId: payload.songId,
      sequence: Math.max(state.value.sequence, payload.sequence),
      songName: typeof payload.songName === "string" ? payload.songName : "",
      artists: typeof payload.artists === "string" ? payload.artists : "",
      lines: Array.isArray(payload.lines) ? payload.lines : [],
      tokensByLine: Array.isArray(payload.tokensByLine)
        ? payload.tokensByLine
        : [],
      accentColor:
        typeof payload.accentColor === "string" && payload.accentColor
          ? payload.accentColor
          : "#E85D3A",
      ...(snapshotHasNewestClock ? normalizedClock(payload) : {}),
    };
  }

  onMounted(async () => {
    disposed = false;
    const stops = await Promise.all([
      listen<DesktopLyricsSnapshotPayload>(
        "desktop-lyrics:snapshot",
        (event) => onSnapshot(event.payload),
      ),
      listen<DesktopLyricsClockPayload>(
        "desktop-lyrics:clock",
        (event) => onClock(event.payload),
      ),
    ]);
    if (disposed) {
      stops.forEach((stop) => stop());
      return;
    }
    unlistens.push(...stops);
    scheduleSnapshotRequest(state.value.songId);
  });

  onBeforeUnmount(() => {
    disposed = true;
    clearSnapshotTimers();
    unlistens.forEach((stop) => stop());
    unlistens.length = 0;
  });

  return { state };
}
