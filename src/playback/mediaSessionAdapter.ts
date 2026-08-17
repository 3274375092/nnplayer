// MediaSession 装配 adapter：系统媒体键 ⇄ Playback Engine。
// 入向 action 直接调引擎的公开 interface（与 UI 按钮走同一条路径）；
// 出向订阅引擎状态，写 metadata / playbackState / positionState。
// 引擎核心因此零 navigator 依赖。

import type { Song } from "@/types/music";
import type { PlaybackEngine } from "./playbackEngine";

export function attachMediaSession(engine: PlaybackEngine): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => {};
  }
  const ms = navigator.mediaSession;

  // =============== 入向：系统媒体键 → 引擎命令 ===============

  ms.setActionHandler("play", () => {
    const s = engine.getState();
    if (!s.playing && !s.loading) engine.togglePlay();
  });
  ms.setActionHandler("pause", () => {
    const s = engine.getState();
    if (s.playing || s.loading) engine.pause();
  });
  ms.setActionHandler("seekto", (details) => {
    if (typeof details.seekTime === "number") {
      engine.seek(details.seekTime);
    }
  });
  ms.setActionHandler("previoustrack", () => {
    void engine.prev();
  });
  ms.setActionHandler("nexttrack", () => {
    void engine.next();
  });

  // =============== 出向：引擎状态 → 系统媒体面板 ===============

  let metadataSongId: number | null = null;
  let lastPlaying: boolean | null = null;

  /** 只有当前歌曲与已装载的 currentSongId 一致时才展示 metadata；
   *  epoch 切换等场景 currentSongId 置空，面板随之清空。 */
  function metadataSong(): Song | null {
    const s = engine.getState();
    const song =
      s.index >= 0 && s.index < s.queue.length ? s.queue[s.index] : null;
    return song && song.id === s.currentSongId ? song : null;
  }

  function syncMetadata() {
    const song = metadataSong();
    const songId = song?.id ?? null;
    if (songId === metadataSongId) return;
    metadataSongId = songId;
    try {
      ms.metadata = song
        ? new MediaMetadata({
            title: song.name,
            artist: song.artists,
            album: song.album,
            artwork: song.picUrl
              ? [{ src: song.picUrl, sizes: "512x512" as const }]
              : [],
          })
        : null;
    } catch {
      // 某些 WebView 不支持 MediaMetadata，忽略
    }
  }

  function syncPlaybackState() {
    const playing = engine.getState().playing;
    if (playing === lastPlaying) return;
    lastPlaying = playing;
    try {
      ms.playbackState = playing ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }

  function syncPositionState() {
    if (!("setPositionState" in ms)) return;
    const s = engine.getState();
    if (!Number.isFinite(s.duration) || s.duration <= 0) return;
    try {
      ms.setPositionState({
        duration: s.duration,
        playbackRate: engine.getMediaClockSample().playbackRate,
        position: Math.max(0, Math.min(s.currentTime, s.duration)),
      });
    } catch {
      /* ignore */
    }
  }

  const sync = () => {
    syncMetadata();
    syncPlaybackState();
    syncPositionState();
  };
  sync();
  const unsubscribe = engine.subscribe(sync);

  return () => {
    unsubscribe();
    const actions: MediaSessionAction[] = [
      "play",
      "pause",
      "seekto",
      "previoustrack",
      "nexttrack",
    ];
    for (const action of actions) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
  };
}
