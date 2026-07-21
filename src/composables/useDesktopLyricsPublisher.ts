import { onScopeDispose, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import type { MediaClockSample } from "@/composables/useAudioPlayer";
import type {
  DesktopLyricsClockAnchor,
  DesktopLyricsTimelineSnapshot,
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
  let subscribed = false;
  let subscriptionEpoch = 0;

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

  function buildTimelineSnapshot(): DesktopLyricsTimelineSnapshot | null {
    const clock = buildClockAnchor();
    const song = source.currentSong();
    return buildDesktopLyricsTimelineSnapshot(clock, {
      songId: song?.id ?? null,
      timelineSongId: source.timelineSongId(),
      songName: song?.name ?? "",
      artists: song?.artists ?? "",
      lines: source.lines(),
      tokensByLine: source.tokensByLine(),
    });
  }

  function stopReanchorTimer() {
    if (reanchorTimer) clearInterval(reanchorTimer);
    reanchorTimer = undefined;
  }

  function onTransportFailed(epoch: number) {
    if (epoch !== subscriptionEpoch) return;
    subscribed = false;
    subscriptionEpoch += 1;
    stopReanchorTimer();
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

  function sendSnapshot() {
    if (!isTauri() || !subscribed) return;
    const snapshot = buildTimelineSnapshot();
    if (!snapshot) return;
    const epoch = subscriptionEpoch;
    void emitTo(
      DESKTOP_LYRICS_LABEL,
      "desktop-lyrics:snapshot",
      snapshot,
    ).catch(() => onTransportFailed(epoch));
  }

  function sendAppearance() {
    if (!isTauri() || !subscribed) return;
    void emitTo(DESKTOP_LYRICS_LABEL, "desktop-lyrics:appearance", {
      accentColor: source.desktopAccent(),
    }).catch(() => {});
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
    sendSnapshot();
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
  });

  return { activate };
}
