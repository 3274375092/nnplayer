// useAudioPlayer：封装 HTML5 <audio> 的全部操作。
// 设计要点：
//   1. 每个播放源使用独立 audio 代际，隔离旧曲迟到的媒体事件
//   2. 暴露 reactive 状态（当前时间、总时长、播放中、缓冲中）
//   3. 提供 play/pause/seek/setVolume 等命令式方法
//   4. 与 Pinia player store 解耦：store 负责状态，composable 负责 DOM 操作
//   5. 阶段5：playSong(songId, song?) — 若传 song 则同步 MediaSession metadata

import { onScopeDispose, reactive, readonly, watch } from "vue";
import type { Song } from "@/types/music";
import { getAuthEpoch, subscribeAuthEpoch } from "@/services/authEpoch";
import { sampleAuthoritativeMediaClock } from "@/lyrics/desktopLyricsSync";
import { getSongUrl } from "./useNcmApi";

export interface AudioState {
  /** 当前播放的歌曲 id，没有则为 null */
  currentSongId: number | null;
  /** 是否正在播放 */
  playing: boolean;
  /** 是否正在缓冲 */
  loading: boolean;
  /** 当前时间（秒） */
  currentTime: number;
  /** 每次 seek 递增，供需要立即同步的消费者识别离散跳转 */
  seekRevision: number;
  /** 总时长（秒） */
  duration: number;
  /** 当前音量 0~1 */
  volume: number;
  /** 静音 */
  muted: boolean;
}

export interface MediaClockSample {
  /** 当前媒体代际；切换或销毁活动 audio 时变化。 */
  mediaGeneration: number;
  /** 与该媒体代际绑定的歌曲，而不是队列当前选中项。 */
  songId: number | null;
  positionMs: number;
  playbackRate: number;
  playing: boolean;
  loading: boolean;
  seekRevision: number;
  sampledAt: number;
}

const SONG_URL_CACHE_TTL_MS = 3 * 60 * 1000;
const SONG_URL_CACHE_LIMIT = 8;

interface CachedSongUrl {
  url: string;
  expiresAt: number;
}

/**
 * 创建并管理全局唯一的活动 <audio> 代际。
 * 返回 reactive 状态 + 操作方法。
 */
export function useAudioPlayer() {
  let initialVolume = 0.8;
  try {
    const stored = Number(localStorage.getItem("nnplayer.volume") ?? "0.8");
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) {
      initialVolume = stored;
    }
  } catch {
    // localStorage 不可用时沿用默认音量
  }

  const state = reactive<AudioState>({
    currentSongId: null,
    playing: false,
    loading: false,
    currentTime: 0,
    seekRevision: 0,
    duration: 0,
    volume: initialVolume,
    muted: initialVolume === 0,
  });

  // 最近一次 playSong 请求的序号，用于取消过时的异步结果
  let playSeq = 0;
  let activeMediaGeneration = 0;
  let audio: HTMLAudioElement | null = null;
  let detachMediaListeners: (() => void) | null = null;
  let initialPlayElement: HTMLAudioElement | null = null;
  /** 用户是否仍希望当前媒体继续播放；暂停后的网络错误不得自动切歌。 */
  let playbackRequested = false;
  /** 不随 audio 代际替换，store 始终监听这个稳定的事件总线。 */
  const eventTarget = new EventTarget();
  /** 小容量 LRU：只覆盖当前队列附近，避免短期 URL 被长期持有。 */
  const songUrlCache = new Map<number, CachedSongUrl>();
  /** 同一歌曲的播放与预取共享一次 invoke。 */
  const songUrlRequests = new Map<number, Promise<string | null>>();
  let songUrlAuthEpoch = getAuthEpoch();

  const stopAuthEpochSubscription = subscribeAuthEpoch((nextEpoch) => {
    if (nextEpoch === songUrlAuthEpoch) return;
    songUrlAuthEpoch = nextEpoch;
    // 认证边界变化后，旧账号已装载的 source 与尚未完成的 playSong 都不能
    // 被新账号继续 resume/提交状态。队列仍由 store 保留，用户可显式重新播放。
    playSeq += 1;
    songUrlCache.clear();
    // 无法取消已经进入 Tauri 的 invoke，但清空映射后新会话不会复用它；
    // resolveSongUrl 还会校验 epoch，旧结果也不能回写当前缓存。
    songUrlRequests.clear();
    destroyActiveMedia();
    state.currentSongId = null;
    state.playing = false;
    state.loading = false;
    state.currentTime = 0;
    state.duration = 0;
    state.seekRevision += 1;
    syncMediaSession(null);
  });

  function getCachedSongUrl(songId: number): string | null {
    const cached = songUrlCache.get(songId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      songUrlCache.delete(songId);
      return null;
    }
    // Map 的插入顺序作为 LRU 顺序，命中后移到末尾。
    songUrlCache.delete(songId);
    songUrlCache.set(songId, cached);
    return cached.url;
  }

  function cacheSongUrl(songId: number, url: string) {
    songUrlCache.delete(songId);
    songUrlCache.set(songId, {
      url,
      expiresAt: Date.now() + SONG_URL_CACHE_TTL_MS,
    });
    while (songUrlCache.size > SONG_URL_CACHE_LIMIT) {
      const oldestSongId = songUrlCache.keys().next().value as number | undefined;
      if (oldestSongId === undefined) break;
      songUrlCache.delete(oldestSongId);
    }
  }

  function invalidateSongUrl(songId: number | null) {
    if (songId !== null) songUrlCache.delete(songId);
  }

  async function resolveSongUrl(songId: number): Promise<string | null> {
    const requestAuthEpoch = songUrlAuthEpoch;
    const cached = getCachedSongUrl(songId);
    if (cached) return cached;

    const pending = songUrlRequests.get(songId);
    if (pending) return pending;

    const request = getSongUrl(songId)
      .then((result) => {
        if (requestAuthEpoch !== songUrlAuthEpoch) return null;
        if (result.url) cacheSongUrl(songId, result.url);
        return result.url;
      })
      .finally(() => {
        if (songUrlRequests.get(songId) === request) {
          songUrlRequests.delete(songId);
        }
      });
    songUrlRequests.set(songId, request);
    return request;
  }

  function prefetchSongUrl(songId: number) {
    if (!Number.isSafeInteger(songId) || songId <= 0) return;
    void resolveSongUrl(songId).catch(() => {
      // 预取失败不影响当前播放；真正切歌时会正常重试。
    });
  }

  // =============== MediaSession 集成（阶段5） ===============
  //
  // 系统媒体键（Windows 11 / macOS / Android / iOS）会触发 MediaSession 的 action
  // 我们注册 play/pause/seekto/previoustrack/nexttrack 回调到 player store。
  //
  // 注意：MediaSession action handler 必须在每次切歌时重新 setActionHandler，
  // 因为浏览器某些实现会丢弃旧的 handler。

  function syncMediaSession(song: Song | null) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (song) {
      const artwork = song.picUrl
        ? [{ src: song.picUrl, sizes: "512x512" as const }]
        : [];
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.name,
          artist: song.artists,
          album: song.album,
          artwork,
        });
      } catch {
        // 某些 WebView 不支持 MediaMetadata，忽略
      }
    } else {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        /* ignore */
      }
    }
  }

  function installMediaSessionHandlers() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    // 通过自定义事件桥接到 player store（避免循环引用 store → composable → store）
    ms.setActionHandler("play", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:play"));
    });
    ms.setActionHandler("pause", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:pause"));
    });
    ms.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        window.dispatchEvent(
          new CustomEvent("nnplayer:media:seek", { detail: details.seekTime }),
        );
      }
    });
    ms.setActionHandler("previoustrack", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:prev"));
    });
    ms.setActionHandler("nexttrack", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:next"));
    });
  }

  // 在文件加载时统一安装一次
  installMediaSessionHandlers();

  // 状态 → MediaSession.playbackState
  const stopPlaybackStateWatch = watch(
    () => state.playing,
    (p) => {
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        try {
          navigator.mediaSession.playbackState = p ? "playing" : "paused";
        } catch {
          /* ignore */
        }
      }
    },
  );

  // =============== 事件监听 ===============

  /**
   * 读取底层媒体时钟。这个 getter 不经过 timeupdate 的低频状态镜像，
   * 歌词等逐帧场景可以在 requestAnimationFrame 中直接调用。
   */
  function getMediaCurrentTime(): number {
    const currentTime = audio?.currentTime;
    return typeof currentTime === "number" &&
      Number.isFinite(currentTime) &&
      currentTime >= 0
      ? currentTime
      : state.currentTime;
  }

  /** 一次性读取同一媒体代际的歌曲身份、位置与离散播放状态。 */
  function getMediaClockSample(): MediaClockSample {
    return sampleAuthoritativeMediaClock(
      audio,
      activeMediaGeneration,
      state,
      Date.now(),
    );
  }

  function hasSource(): boolean {
    return Boolean(audio?.getAttribute("src"));
  }

  function syncCurrentTime(element: HTMLAudioElement) {
    if (audio !== element) return;
    state.currentTime = getMediaCurrentTime();
  }

  function syncMediaSessionPosition(element: HTMLAudioElement) {
    if (audio !== element) return;
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !("setPositionState" in navigator.mediaSession)
    ) {
      return;
    }
    try {
      if (Number.isFinite(element.duration) && element.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: element.duration,
          playbackRate:
            Number.isFinite(element.playbackRate) && element.playbackRate > 0
              ? element.playbackRate
              : 1,
          position: Math.max(
            0,
            Math.min(element.currentTime, element.duration),
          ),
        });
      }
    } catch {
      /* ignore */
    }
  }

  function bindMediaListeners(
    element: HTMLAudioElement,
    generation: number,
  ): () => void {
    const isActiveGeneration = () =>
      audio === element && activeMediaGeneration === generation;
    let wasPlayingBeforeSeek = false;

    const onPlay = () => {
      if (!isActiveGeneration()) return;
      if (!playbackRequested) return;
      // play 表示播放意图；真正开始输出由 playing 事件确认。
      state.loading =
        element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    };
    const onPlaying = () => {
      if (!isActiveGeneration()) return;
      if (!playbackRequested) {
        element.pause();
        return;
      }
      syncCurrentTime(element);
      state.loading = false;
      state.playing = true;
    };
    const onPause = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      playbackRequested = false;
      state.playing = false;
      state.loading = false;
    };
    const onTimeUpdate = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      // 同步 MediaSession position state（部分平台会用来显示进度条）
      syncMediaSessionPosition(element);
    };
    const onLoadedMetadata = () => {
      if (!isActiveGeneration()) return;
      state.duration = Number.isFinite(element.duration)
        ? element.duration
        : 0;
      syncCurrentTime(element);
      syncMediaSessionPosition(element);
    };
    const onDurationChange = () => {
      if (!isActiveGeneration()) return;
      state.duration = Number.isFinite(element.duration)
        ? element.duration
        : 0;
      syncMediaSessionPosition(element);
    };
    const onWaiting = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      if (!element.paused && !element.ended) {
        state.loading = true;
        state.playing = false;
      }
    };
    const onStalled = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      if (
        !element.paused &&
        !element.ended &&
        element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        state.loading = true;
        state.playing = false;
      }
    };
    const onCanPlay = () => {
      if (!isActiveGeneration()) return;
      state.loading = false;
    };
    const onSeeking = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      state.seekRevision += 1;
      wasPlayingBeforeSeek = !element.paused && !element.ended;
      state.playing = false;
      state.loading = wasPlayingBeforeSeek;
    };
    const onSeeked = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      const canContinue =
        wasPlayingBeforeSeek && !element.paused && !element.ended;
      const hasFutureData =
        element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
      state.playing = canContinue && hasFutureData;
      state.loading = canContinue && !hasFutureData;
      wasPlayingBeforeSeek = false;
      syncMediaSessionPosition(element);
    };
    const onRateChange = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      syncMediaSessionPosition(element);
    };
    const onEnded = () => {
      if (!isActiveGeneration()) return;
      syncCurrentTime(element);
      playbackRequested = false;
      state.playing = false;
      state.loading = false;
      eventTarget.dispatchEvent(new CustomEvent("nnplayer:ended"));
    };
    const onError = () => {
      if (!isActiveGeneration()) return;
      const shouldRecover =
        playbackRequested && initialPlayElement !== element;
      const mediaError = element.error;
      playbackRequested = false;
      invalidateSongUrl(state.currentSongId);
      state.loading = false;
      state.playing = false;
      // eslint-disable-next-line no-console
      console.error("[audio] 播放失败", mediaError);
      // 当前 source 已经不可用。即使错误发生在暂停期间也必须销毁，
      // 否则下一次点击会永远 resume 同一个坏 URL。
      destroyActiveMedia();
      // playSong 中首次 play() 的错误由 Promise reject 处理。
      if (shouldRecover) {
        eventTarget.dispatchEvent(new CustomEvent("nnplayer:error"));
      }
    };

    element.addEventListener("play", onPlay);
    element.addEventListener("playing", onPlaying);
    element.addEventListener("pause", onPause);
    element.addEventListener("timeupdate", onTimeUpdate);
    element.addEventListener("loadedmetadata", onLoadedMetadata);
    element.addEventListener("durationchange", onDurationChange);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("stalled", onStalled);
    element.addEventListener("canplay", onCanPlay);
    element.addEventListener("seeking", onSeeking);
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("ratechange", onRateChange);
    element.addEventListener("ended", onEnded);
    element.addEventListener("error", onError);

    return () => {
      element.removeEventListener("play", onPlay);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("loadedmetadata", onLoadedMetadata);
      element.removeEventListener("durationchange", onDurationChange);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("stalled", onStalled);
      element.removeEventListener("canplay", onCanPlay);
      element.removeEventListener("seeking", onSeeking);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("ratechange", onRateChange);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
    };
  }

  function destroyActiveMedia() {
    playbackRequested = false;
    const element = audio;
    if (!element) return;

    // 先让代际失效并解绑事件，再 pause/load，保证销毁过程中的
    // 同步事件和已排队的迟到事件都不能写入新状态。
    audio = null;
    activeMediaGeneration += 1;
    detachMediaListeners?.();
    detachMediaListeners = null;
    if (initialPlayElement === element) initialPlayElement = null;

    element.pause();
    element.removeAttribute("src");
    element.load();
    element.remove();
  }

  function createActiveMedia(src: string): HTMLAudioElement {
    destroyActiveMedia();

    const element = new Audio();
    element.preload = "auto";
    element.volume = state.volume;
    element.muted = state.muted;

    const generation = ++activeMediaGeneration;
    audio = element;
    detachMediaListeners = bindMediaListeners(element, generation);
    // 不显示节点，但保留在 DOM 中以兼容部分 WebView。
    document.body.appendChild(element);
    element.src = src;
    return element;
  }

  // =============== 命令式方法 ===============

  /**
   * 加载并播放指定歌曲。
   * 1. 先调用 Rust get_song_url 拿到真实 url
   * 2. 设置 audio.src 并 play()
   * 3. 阶段5：若有 song 元信息则同步 MediaSession metadata
   */
  async function playSong(songId: number, song?: Song): Promise<boolean> {
    const seq = ++playSeq;
    const requestAuthEpoch = songUrlAuthEpoch;
    try {
      // 立即销毁旧代际，避免 UI 已切歌但仍播放上一首。
      // 新代际要等 URL 请求成功后才创建。
      state.playing = false;
      destroyActiveMedia();
      state.loading = true;
      state.currentSongId = songId;
      state.currentTime = 0;
      state.duration = 0;

      const resolvedUrl = await resolveSongUrl(songId);
      if (seq !== playSeq || requestAuthEpoch !== songUrlAuthEpoch) {
        if (seq === playSeq && !audio) state.loading = false;
        return false;
      }
      if (!resolvedUrl) {
        throw new Error("该歌曲暂无可用播放源");
      }

      const element = createActiveMedia(resolvedUrl);
      if (song) {
        syncMediaSession(song);
      }
      initialPlayElement = element;
      playbackRequested = true;
      try {
        await element.play();
      } finally {
        if (initialPlayElement === element) initialPlayElement = null;
      }
      if (seq !== playSeq || audio !== element) return false;
      state.loading = false;
      return true;
    } catch (e) {
      if (seq !== playSeq) return false;
      invalidateSongUrl(songId);
      destroyActiveMedia();
      state.playing = false;
      state.loading = false;
      throw e;
    }
  }

  /** 暂停，同时取消尚未完成的取 URL/播放请求。 */
  function pause() {
    playSeq += 1;
    playbackRequested = false;
    const element = audio;
    if (element) syncCurrentTime(element);
    state.playing = false;
    state.loading = false;
    element?.pause();
  }

  /** 完全停止并清理当前媒体。 */
  function stop() {
    playSeq += 1;
    destroyActiveMedia();
    state.currentSongId = null;
    state.playing = false;
    state.loading = false;
    state.currentTime = 0;
    state.duration = 0;
    syncMediaSession(null);
  }

  /** 继续播放 */
  async function resume() {
    const element = audio;
    if (!element || !hasSource()) return;
    playbackRequested = true;
    try {
      await element.play();
    } catch (error) {
      if (audio !== element || !playbackRequested) return;
      playbackRequested = false;
      state.playing = false;
      state.loading = false;

      const errorName =
        error && typeof error === "object" && "name" in error
          ? String((error as { name: unknown }).name)
          : "";
      if (errorName === "NotAllowedError" || errorName === "AbortError") {
        // 用户手势限制或并发 pause/source 切换不代表媒体 URL 已损坏。
        return;
      }

      invalidateSongUrl(state.currentSongId);
      destroyActiveMedia();
      eventTarget.dispatchEvent(new CustomEvent("nnplayer:error"));
    }
  }

  /** 切换播放/暂停 */
  function toggle() {
    if (state.playing || state.loading) {
      pause();
    } else {
      void resume();
    }
  }

  /** 跳转到指定秒数 */
  function seek(seconds: number) {
    const element = audio;
    if (
      !element ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(element.duration)
    ) {
      return;
    }
    const target = Math.max(0, Math.min(seconds, element.duration));
    element.currentTime = target;
    // seeking/timeupdate 都是异步事件，拖动后先立即更新 UI 状态。
    state.currentTime = target;
    state.seekRevision += 1;
    syncMediaSessionPosition(element);
  }

  /** 设置音量 0~1 */
  function setVolume(v: number) {
    const safe = Number.isFinite(v) ? v : 0.8;
    const clamped = Math.max(0, Math.min(1, safe));
    state.volume = clamped;
    state.muted = clamped === 0;
    if (audio) {
      audio.volume = clamped;
      audio.muted = state.muted;
    }
    try {
      localStorage.setItem("nnplayer.volume", String(clamped));
    } catch {
      // localStorage 不可用不应中断播放控制
    }
  }

  /** 切换静音 */
  function toggleMute() {
    state.muted = !state.muted;
    if (audio) audio.muted = state.muted;
  }

  // =============== 清理 ===============

  onScopeDispose(() => {
    stopPlaybackStateWatch();
    stopAuthEpochSubscription();
    destroyActiveMedia();
    songUrlCache.clear();
    songUrlRequests.clear();
  });

  return {
    state: readonly(state),
    playSong,
    pause,
    stop,
    resume,
    toggle,
    seek,
    setVolume,
    toggleMute,
    getMediaClockSample,
    prefetchSongUrl,
    hasSource,
    eventTarget,
  };
}
