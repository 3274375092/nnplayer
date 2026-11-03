import { onScopeDispose, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import type {
  DesktopLyricsClockAnchor,
  DesktopLyricsTimelineSnapshot,
  MediaClockSample,
} from "@/lyrics/desktopLyricsSync";
import {
  buildDesktopLyricsTimelineSnapshot,
  computeNextLyricSessionGeneration,
} from "@/lyrics/desktopLyricsSync";
import type { KaraokeToken } from "@/lyrics/lyricFrame";
import type { Song } from "@/types/music";
import type { LyricLine } from "@/utils/lrcParser";

const DESKTOP_LYRICS_LABEL = "desktop-lyrics";
const CLOCK_REANCHOR_INTERVAL_MS = 1000;
const SESSION_GENERATION_STORAGE_KEY = "nnplayer.lyricSessionGeneration";
/** 歌词时间轴未就绪（切歌/加载中）时，快照握手的最长自愈间隔与次数。 */
const SNAPSHOT_RETRY_INTERVAL_MS = 400;
const SNAPSHOT_RETRY_MAX_ATTEMPTS = 25;

/**
 * 上一次成功发出的时间轴内容（不含时钟字段）。
 * 用途：切歌/媒体 id 变化会让 watcher 反复触发，但歌词时间轴可能还是同一份
 * 已发送的数组（例如握手重试计时器在快照刚发完后才触发）——完整快照的
 * lines + tokensByLine 序列化后 40–75 KB，重复发送只是把同一份数组再拷一遍。
 */
interface SentTimelineIdentity {
  songId: number | null;
  songName: string;
  artists: string;
  lines: DesktopLyricsTimelineSnapshot["lines"];
  tokensByLine: DesktopLyricsTimelineSnapshot["tokensByLine"];
}

interface DesktopLyricsPublisherSource {
  currentSong: () => Song | null;
  timelineSongId: () => number | null;
  lines: () => readonly LyricLine[];
  tokensByLine: () => readonly (readonly KaraokeToken[])[];
  desktopAccent: () => string;
  clockSample: () => MediaClockSample;
  mediaSongId: () => number | null;
  playing: () => boolean;
  loading: () => boolean;
  seekRevision: () => number;
  playbackRate: () => number;
}

function nextLyricSessionGeneration(): number {
  const scope = globalThis as typeof globalThis & {
    __nnplayerLyricSessionGeneration?: number;
  };
  const storedCandidates: unknown[] = [scope.__nnplayerLyricSessionGeneration];
  try {
    storedCandidates.push(
      Number(sessionStorage.getItem(SESSION_GENERATION_STORAGE_KEY)),
    );
  } catch {
    // Epoch floor below still lets a reloaded realm supersede the old session.
  }
  try {
    storedCandidates.push(
      Number(localStorage.getItem(SESSION_GENERATION_STORAGE_KEY)),
    );
  } catch {
    // Some WebView privacy modes expose neither storage implementation.
  }
  const timeOrigin = typeof performance !== "undefined" &&
      Number.isSafeInteger(Math.floor(performance.timeOrigin))
    ? Math.floor(performance.timeOrigin)
    : 0;
  const next = computeNextLyricSessionGeneration(
    storedCandidates,
    Math.max(Date.now(), timeOrigin),
  );
  scope.__nnplayerLyricSessionGeneration = next;
  try {
    sessionStorage.setItem(SESSION_GENERATION_STORAGE_KEY, String(next));
  } catch {
    // Realm state and epoch floor remain available when storage is blocked.
  }
  try {
    localStorage.setItem(SESSION_GENERATION_STORAGE_KEY, String(next));
  } catch {
    // Best-effort fallback for full reloads when sessionStorage is blocked.
  }
  return next;
}

export function useDesktopLyricsPublisher(
  source: DesktopLyricsPublisherSource,
) {
  const sessionGeneration = nextLyricSessionGeneration();
  const sessionId = globalThis.crypto?.randomUUID?.() ??
    `${sessionGeneration}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  let timelineRevision = 0;
  let reanchorTimer: ReturnType<typeof setInterval> | undefined;
  let snapshotRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotRetryAttempts = 0;
  let subscribed = false;
  let subscriptionEpoch = 0;
  let lastSentTimeline: SentTimelineIdentity | null = null;

  function buildClockAnchor(): DesktopLyricsClockAnchor {
    const sample = source.clockSample();
    return {
      sessionId,
      sessionGeneration,
      songId: sample.songId,
      sequence: ++sequence,
      timelineRevision,
      mediaGeneration: sample.mediaGeneration,
      positionMs: sample.positionMs,
      sampledAt: sample.sampledAt,
      playbackRate: sample.playbackRate,
      seekRevision: sample.seekRevision,
      playing: sample.playing,
    };
  }

  function currentTimelineIdentity(): SentTimelineIdentity {
    const song = source.currentSong();
    return {
      songId: song?.id ?? null,
      songName: song?.name ?? "",
      artists: song?.artists ?? "",
      lines: source.lines(),
      tokensByLine: source.tokensByLine(),
    };
  }

  /** 时间轴整表替换时引用才会变；引用相同即快照内容与上次发送完全一致。 */
  function isDuplicateTimeline(identity: SentTimelineIdentity): boolean {
    const previous = lastSentTimeline;
    return previous !== null &&
      previous.songId === identity.songId &&
      previous.songName === identity.songName &&
      previous.artists === identity.artists &&
      previous.lines === identity.lines &&
      previous.tokensByLine === identity.tokensByLine;
  }

  function buildTimelineSnapshot(): DesktopLyricsTimelineSnapshot | null {
    const clock = buildClockAnchor();
    const timeline = currentTimelineIdentity();
    return buildDesktopLyricsTimelineSnapshot(clock, {
      songId: timeline.songId,
      timelineSongId: source.timelineSongId(),
      songName: timeline.songName,
      artists: timeline.artists,
      lines: timeline.lines,
      tokensByLine: timeline.tokensByLine,
    });
  }

  function stopReanchorTimer() {
    if (reanchorTimer) clearInterval(reanchorTimer);
    reanchorTimer = undefined;
  }

  function clearSnapshotRetry() {
    if (snapshotRetryTimer) clearTimeout(snapshotRetryTimer);
    snapshotRetryTimer = undefined;
    snapshotRetryAttempts = 0;
  }

  function scheduleSnapshotRetry() {
    if (snapshotRetryTimer || !subscribed || !isTauri()) return;
    if (snapshotRetryAttempts >= SNAPSHOT_RETRY_MAX_ATTEMPTS) {
      console.warn(
        "[desktop-lyrics] 快照握手重试耗尽：歌词时间轴仍未就绪",
      );
      return;
    }
    snapshotRetryAttempts += 1;
    snapshotRetryTimer = setTimeout(() => {
      snapshotRetryTimer = undefined;
      sendSnapshot();
    }, SNAPSHOT_RETRY_INTERVAL_MS);
  }

  function onTransportFailed(epoch: number) {
    if (epoch !== subscriptionEpoch) return;
    subscribed = false;
    subscriptionEpoch += 1;
    // 发送失败后不能把这份内容当成“子窗已收到”：下次重试必须真的重发。
    lastSentTimeline = null;
    stopReanchorTimer();
    clearSnapshotRetry();
  }

  function sendClock() {
    if (!isTauri() || !subscribed) return;
    const epoch = subscriptionEpoch;
    void emitTo(
      DESKTOP_LYRICS_LABEL,
      "desktop-lyrics:clock",
      buildClockAnchor(),
    ).catch(() => onTransportFailed(epoch));
  }

  /**
   * 发送完整时间轴快照。
   * force=false 时若时间轴内容与上次成功发送的完全相同，直接视为已满足：
   * 这是 watcher 因歌曲/媒体 id 变化、或握手重试计时器在快照刚发完后触发造成
   * 的重复发送，再发一次只会把同一份 40–75 KB 数组重新序列化。
   * 桌面歌词窗的 burst 重试 / 快照请求走 activate(force=true)——那是真的没收到，
   * 必须重发。
   */
  function sendSnapshot(options: { force?: boolean } = {}) {
    if (!isTauri() || !subscribed) return;
    const identity = currentTimelineIdentity();
    if (!options.force && isDuplicateTimeline(identity)) {
      clearSnapshotRetry();
      return;
    }
    const snapshot = buildTimelineSnapshot();
    if (!snapshot) {
      // 已订阅但时间轴尚未就绪（刚切歌、歌词还在加载）：不能静默丢弃，
      // 否则桌面歌词窗只能等下一次请求，出现数秒的「等待播放」。
      scheduleSnapshotRetry();
      return;
    }
    clearSnapshotRetry();
    const epoch = subscriptionEpoch;
    // 先按“已发送”记录；发送失败时 onTransportFailed 会清空，避免误跳过重发。
    lastSentTimeline = identity;
    void emitTo(
      DESKTOP_LYRICS_LABEL,
      "desktop-lyrics:snapshot",
      snapshot,
    ).catch((e) => {
      console.warn("[desktop-lyrics] 快照发送失败，标记传输失效待重连", e);
      onTransportFailed(epoch);
    });
  }

  function sendAppearance() {
    if (!isTauri() || !subscribed) return;
    void emitTo(DESKTOP_LYRICS_LABEL, "desktop-lyrics:appearance", {
      accentColor: source.desktopAccent(),
    }).catch((e) => {
      // 只影响主题色同步，且不在重试路径上（仅在 activate 与色调变化时发送），
      // 低频失败值得留痕。
      console.warn("[desktop-lyrics] appearance 发送失败", e);
    });
  }

  function updateReanchorTimer() {
    stopReanchorTimer();
    const sample = source.clockSample();
    if (!isTauri() || !subscribed || !sample.playing || sample.loading) return;
    reanchorTimer = setInterval(sendClock, CLOCK_REANCHOR_INTERVAL_MS);
  }

  function activate() {
    if (!isTauri()) return;
    subscribed = true;
    subscriptionEpoch += 1;
    // 每次握手请求都视为一次新的订阅机会：清掉上一轮的重试计数。
    clearSnapshotRetry();
    // 握手是显式请求：即使内容与上次相同也必须重发（子窗可能刚重载/丢包）。
    sendSnapshot({ force: true });
    sendAppearance();
    updateReanchorTimer();
  }

  watch(
    [
      () => source.currentSong()?.id ?? null,
      source.mediaSongId,
      source.playing,
      source.loading,
      source.seekRevision,
    ],
    () => {
      updateReanchorTimer();
      sendClock();
    },
    { flush: "sync" },
  );
  watch(source.playbackRate, () => sendClock());
  watch(
    [
      () => source.currentSong()?.id ?? null,
      source.mediaSongId,
      source.timelineSongId,
      source.lines,
      source.tokensByLine,
    ],
    () => {
      // 只在歌词时间轴本身变化时推进 revision：仅歌曲/媒体 id 变化而歌词行
      // 仍是同一份已发送数组时，完整快照是重复的，跳过（否则子窗的 clock
      // 锚点 revision 与快照失配，会白清空一次歌词）。
      if (isDuplicateTimeline(currentTimelineIdentity())) return;
      timelineRevision += 1;
      sendSnapshot();
    },
    { flush: "post" },
  );
  watch(source.desktopAccent, () => sendAppearance(), { flush: "post" });

  onScopeDispose(() => {
    subscribed = false;
    subscriptionEpoch += 1;
    stopReanchorTimer();
    clearSnapshotRetry();
  });

  return { activate };
}
