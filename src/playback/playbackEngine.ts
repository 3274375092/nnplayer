// Playback Engine：播放领域的深模块，Playback Position 的唯一生产者。
// 无框架纯 TS 状态机：队列/播放模式/历史、Media Generation 代际隔离、
// 歌曲 URL 缓存与 auth epoch 会话隔离、ended/error 自动切歌，全部在此。
// 媒体操作经 MediaRuntime seam 注入（生产 = htmlAudioRuntime，测试 = fake）；
// Tauri IPC 经 resolveSongUrl 函数注入；时钟经 now 注入以便假时钟测试。
// Vue 侧由 stores/player.ts 薄 adapter 镜像 getState() + subscribe()。

import type { PlayMode, Song } from "@/types/music";
import {
  sampleAuthoritativeMediaClock,
  type MediaClockSample,
} from "@/lyrics/desktopLyricsSync";
import type { MediaEvent, MediaHandle, MediaRuntime } from "./mediaRuntime";

export interface PlaybackState {
  /** 当前播放队列（不可变数组，每次变更整体替换） */
  queue: readonly Song[];
  /** 队列中当前歌曲的索引 */
  index: number;
  /** 播放模式 */
  playMode: PlayMode;
  /** 播放历史（最近 50 首，不可变数组） */
  history: readonly Song[];
  /** 当前播放的歌曲 id，没有则为 null */
  currentSongId: number | null;
  /** 是否正在播放 */
  playing: boolean;
  /** 是否正在缓冲 */
  loading: boolean;
  /** 当前时间（秒），低频镜像；逐帧消费者用 getMediaClockSample */
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

export interface PlaybackEngineOptions {
  runtime: MediaRuntime;
  /** 解析歌曲播放 URL（生产 = Tauri get_song_url IPC） */
  resolveSongUrl: (songId: number) => Promise<string | null>;
  /** 初始音量 0~1，持久化读写由装配层负责 */
  initialVolume?: number;
  /** 初始 auth epoch，之后经 notifyAuthEpochChanged 输入 */
  initialAuthEpoch?: number;
  /** 时钟，默认 Date.now；缓存 TTL 与 Clock Anchor 采样用 */
  now?: () => number;
}

export interface PlaybackEngine {
  getState(): Readonly<PlaybackState>;
  /** 任意状态变更后回调；listener 内用 getState() 读取最新快照 */
  subscribe(listener: () => void): () => void;
  getCurrentSong(): Song | null;
  /** 一次性读取同一 Media Generation 的歌曲身份、位置与离散播放状态。 */
  getMediaClockSample(): MediaClockSample;
  playList(songs: Song[], startIndex?: number): Promise<void>;
  playSong(song: Song): Promise<void>;
  togglePlay(): void;
  pause(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  togglePlayMode(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  removeFromQueue(absIdx: number): void;
  reorderQueue(from: number, to: number): void;
  clearQueue(): void;
  getNextUp(limit?: number): Song[];
  /** auth epoch 变化输入口；装配层接 subscribeAuthEpoch，测试直接调用 */
  notifyAuthEpochChanged(epoch: number): void;
  /** 销毁媒体、清空缓存与订阅 */
  destroy(): void;
}

const SONG_URL_CACHE_TTL_MS = 3 * 60 * 1000;
const SONG_URL_CACHE_LIMIT = 8;
const HISTORY_LIMIT = 50;

interface CachedSongUrl {
  url: string;
  expiresAt: number;
}

export function createPlaybackEngine(
  options: PlaybackEngineOptions,
): PlaybackEngine {
  const { runtime, resolveSongUrl: resolveSongUrlUpstream } = options;
  const now = options.now ?? Date.now;

  const initialVolume =
    typeof options.initialVolume === "number" &&
    Number.isFinite(options.initialVolume) &&
    options.initialVolume >= 0 &&
    options.initialVolume <= 1
      ? options.initialVolume
      : 0.8;

  const state: PlaybackState = {
    queue: [],
    index: -1,
    playMode: "loop-list",
    history: [],
    currentSongId: null,
    playing: false,
    loading: false,
    currentTime: 0,
    seekRevision: 0,
    duration: 0,
    volume: initialVolume,
    muted: initialVolume === 0,
  };

  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  // =============== Media Generation 管理 ===============

  // 最近一次装载请求的序号，用于取消过时的异步结果
  let playSeq = 0;
  let mediaGeneration = 0;
  let activeHandle: MediaHandle | null = null;
  let initialPlayHandle: MediaHandle | null = null;
  /** 用户是否仍希望当前媒体继续播放；暂停后的网络错误不得自动切歌。 */
  let playbackRequested = false;
  let wasPlayingBeforeSeek = false;
  let playFailCount = 0;

  function destroyActiveMedia() {
    playbackRequested = false;
    const handle = activeHandle;
    if (!handle) return;
    // 先让代际失效，再 destroy：销毁过程中的同步事件和已排队的
    // 迟到事件都会被代际检查丢弃，不能写入新状态。
    activeHandle = null;
    mediaGeneration += 1;
    if (initialPlayHandle === handle) initialPlayHandle = null;
    wasPlayingBeforeSeek = false;
    handle.destroy();
  }

  function createActiveMedia(src: string): MediaHandle {
    destroyActiveMedia();
    const generation = ++mediaGeneration;
    const handle = runtime.create(src, {
      volume: state.volume,
      muted: state.muted,
      onEvent: (event) => handleMediaEvent(handle, generation, event),
    });
    activeHandle = handle;
    return handle;
  }

  /** 读取底层媒体时钟；不经过 timeupdate 的低频镜像。 */
  function getMediaCurrentTime(): number {
    const currentTime = activeHandle?.currentTime;
    return typeof currentTime === "number" &&
      Number.isFinite(currentTime) &&
      currentTime >= 0
      ? currentTime
      : state.currentTime;
  }

  function syncCurrentTime(handle: MediaHandle) {
    if (activeHandle !== handle) return;
    state.currentTime = getMediaCurrentTime();
  }

  function handleMediaEvent(
    handle: MediaHandle,
    generation: number,
    event: MediaEvent,
  ) {
    // 代际检查：destroy 之后（无论 adapter 是否守规矩）迟到事件一律丢弃。
    if (activeHandle !== handle || mediaGeneration !== generation) return;

    switch (event.type) {
      case "play":
        if (!playbackRequested) break;
        // play 表示播放意图；真正开始输出由 playing 事件确认。
        state.loading = !handle.hasFutureData;
        break;
      case "playing":
        if (!playbackRequested) {
          handle.pause();
          return;
        }
        syncCurrentTime(handle);
        state.loading = false;
        state.playing = true;
        break;
      case "pause":
        syncCurrentTime(handle);
        playbackRequested = false;
        state.playing = false;
        state.loading = false;
        break;
      case "timeupdate":
        syncCurrentTime(handle);
        break;
      case "loadedmetadata":
      case "durationchange":
        state.duration = Number.isFinite(handle.duration)
          ? handle.duration
          : 0;
        syncCurrentTime(handle);
        break;
      case "waiting":
        syncCurrentTime(handle);
        if (!handle.paused && !handle.ended) {
          state.loading = true;
          state.playing = false;
        }
        break;
      case "stalled":
        syncCurrentTime(handle);
        if (!handle.paused && !handle.ended && !handle.hasFutureData) {
          state.loading = true;
          state.playing = false;
        }
        break;
      case "canplay":
        state.loading = false;
        break;
      case "seeking":
        syncCurrentTime(handle);
        state.seekRevision += 1;
        wasPlayingBeforeSeek = !handle.paused && !handle.ended;
        state.playing = false;
        state.loading = wasPlayingBeforeSeek;
        break;
      case "seeked": {
        syncCurrentTime(handle);
        const canContinue =
          wasPlayingBeforeSeek && !handle.paused && !handle.ended;
        state.playing = canContinue && handle.hasFutureData;
        state.loading = canContinue && !handle.hasFutureData;
        wasPlayingBeforeSeek = false;
        break;
      }
      case "ratechange":
        syncCurrentTime(handle);
        break;
      case "ended":
        syncCurrentTime(handle);
        playbackRequested = false;
        state.playing = false;
        state.loading = false;
        // 自动切歌是引擎自身的状态转换：单曲循环重播，否则推进。
        if (state.playMode === "loop-one") {
          void loadAndPlayCurrent();
        } else {
          void next();
        }
        break;
      case "error": {
        const shouldRecover =
          playbackRequested && initialPlayHandle !== handle;
        playbackRequested = false;
        invalidateSongUrl(state.currentSongId);
        state.loading = false;
        state.playing = false;
        // eslint-disable-next-line no-console
        console.error("[playback] 播放失败", event.error);
        // 当前 source 已经不可用。即使错误发生在暂停期间也必须销毁，
        // 否则下一次点击会永远 resume 同一个坏 URL。
        destroyActiveMedia();
        // 首次装载的 play() 错误由 loadAndPlay 的 Promise reject 处理。
        if (shouldRecover) {
          void recoverFromPlaybackFailure(new Error("播放过程中媒体流中断"));
        }
        break;
      }
    }
    notify();
  }

  // =============== 歌曲 URL 缓存与会话隔离 ===============

  /** 小容量 LRU：只覆盖当前队列附近，避免短期 URL 被长期持有。 */
  const songUrlCache = new Map<number, CachedSongUrl>();
  /** 同一歌曲的播放与预取共享一次 invoke。 */
  const songUrlRequests = new Map<number, Promise<string | null>>();
  let authEpoch = options.initialAuthEpoch ?? 0;

  function getCachedSongUrl(songId: number): string | null {
    const cached = songUrlCache.get(songId);
    if (!cached) return null;
    if (cached.expiresAt <= now()) {
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
    songUrlCache.set(songId, { url, expiresAt: now() + SONG_URL_CACHE_TTL_MS });
    while (songUrlCache.size > SONG_URL_CACHE_LIMIT) {
      const oldestSongId = songUrlCache.keys().next().value as
        | number
        | undefined;
      if (oldestSongId === undefined) break;
      songUrlCache.delete(oldestSongId);
    }
  }

  function invalidateSongUrl(songId: number | null) {
    if (songId !== null) songUrlCache.delete(songId);
  }

  async function resolveSongUrl(songId: number): Promise<string | null> {
    const requestAuthEpoch = authEpoch;
    const cached = getCachedSongUrl(songId);
    if (cached) return cached;

    const pending = songUrlRequests.get(songId);
    if (pending) return pending;

    const request = resolveSongUrlUpstream(songId)
      .then((url) => {
        // epoch 已切换时旧账号的结果不能回写当前缓存。
        if (requestAuthEpoch !== authEpoch) return null;
        if (url) cacheSongUrl(songId, url);
        return url;
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

  function prefetchNextSongUrl() {
    // 只在列表循环下预取确定候选；随机不可预测，单曲循环无需下一首。
    if (state.playMode !== "loop-list" || state.queue.length < 2) return;
    const nextIndex = (state.index + 1) % state.queue.length;
    const nextSong = state.queue[nextIndex];
    if (!nextSong || nextSong.id === getCurrentSong()?.id) return;
    prefetchSongUrl(nextSong.id);
  }

  function notifyAuthEpochChanged(epoch: number) {
    if (epoch === authEpoch) return;
    authEpoch = epoch;
    // 认证边界变化后，旧账号已装载的 source 与尚未完成的装载都不能
    // 被新账号继续 resume/提交状态。队列保留，用户可显式重新播放。
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
    notify();
  }

  // =============== 装载与播放 ===============

  /**
   * 加载并播放指定歌曲：解析 URL → 创建新 Media Generation → play()。
   * 返回 false 表示请求已被更新的装载/epoch 切换取代。
   */
  async function loadAndPlay(songId: number): Promise<boolean> {
    const seq = ++playSeq;
    const requestAuthEpoch = authEpoch;
    try {
      // 立即销毁旧代际，避免 UI 已切歌但仍播放上一首。
      // 新代际要等 URL 请求成功后才创建。
      state.playing = false;
      destroyActiveMedia();
      state.loading = true;
      state.currentSongId = songId;
      state.currentTime = 0;
      state.duration = 0;
      notify();

      const resolvedUrl = await resolveSongUrl(songId);
      if (seq !== playSeq || requestAuthEpoch !== authEpoch) {
        if (seq === playSeq && !activeHandle) {
          state.loading = false;
          notify();
        }
        return false;
      }
      if (!resolvedUrl) {
        throw new Error("该歌曲暂无可用播放源");
      }

      const handle = createActiveMedia(resolvedUrl);
      initialPlayHandle = handle;
      playbackRequested = true;
      try {
        await handle.play();
      } finally {
        if (initialPlayHandle === handle) initialPlayHandle = null;
      }
      if (seq !== playSeq || activeHandle !== handle) return false;
      state.loading = false;
      notify();
      return true;
    } catch (e) {
      if (seq !== playSeq) return false;
      invalidateSongUrl(songId);
      destroyActiveMedia();
      state.playing = false;
      state.loading = false;
      notify();
      throw e;
    }
  }

  async function recoverFromPlaybackFailure(error: unknown) {
    playFailCount++;
    if (playFailCount >= 3) {
      console.error("[playback] 连续 3 次播放失败，停止自动切换", error);
      playFailCount = 0;
      return;
    }
    console.error("[playback] 播放失败，自动跳到下一首", error);
    await next();
  }

  /** 播放当前索引对应的歌曲 */
  async function loadAndPlayCurrent() {
    const song = getCurrentSong();
    if (!song) return;
    try {
      const started = await loadAndPlay(song.id);
      if (!started || getCurrentSong()?.id !== song.id) return;
      pushHistory(song);
      playFailCount = 0;
      prefetchNextSongUrl();
      notify();
    } catch (e) {
      await recoverFromPlaybackFailure(e);
    }
  }

  /** 继续播放当前已装载的 source */
  async function resume() {
    const handle = activeHandle;
    if (!handle || !handle.hasSource()) return;
    playbackRequested = true;
    try {
      await handle.play();
    } catch (error) {
      if (activeHandle !== handle || !playbackRequested) return;
      playbackRequested = false;
      state.playing = false;
      state.loading = false;

      const errorName =
        error && typeof error === "object" && "name" in error
          ? String((error as { name: unknown }).name)
          : "";
      if (errorName === "NotAllowedError" || errorName === "AbortError") {
        // 用户手势限制或并发 pause/source 切换不代表媒体 URL 已损坏。
        notify();
        return;
      }

      invalidateSongUrl(state.currentSongId);
      destroyActiveMedia();
      notify();
      void recoverFromPlaybackFailure(error);
    }
  }

  /** 完全停止并清理当前媒体。 */
  function stopPlayback() {
    playSeq += 1;
    destroyActiveMedia();
    state.currentSongId = null;
    state.playing = false;
    state.loading = false;
    state.currentTime = 0;
    state.duration = 0;
  }

  // =============== 队列与历史 ===============

  function getCurrentSong(): Song | null {
    return state.index >= 0 && state.index < state.queue.length
      ? state.queue[state.index]
      : null;
  }

  function pushHistory(song: Song) {
    state.history = [song, ...state.history].slice(0, HISTORY_LIMIT);
  }

  function removeFromQueue(absIdx: number) {
    if (absIdx < 0 || absIdx >= state.queue.length) return;
    const removingCurrent = absIdx === state.index;
    state.queue = state.queue.filter((_, i) => i !== absIdx);
    // 修正 index：若移除项在当前之前，index-1。
    if (absIdx < state.index) {
      state.index -= 1;
    } else if (removingCurrent) {
      if (state.queue.length === 0) {
        state.index = -1;
        stopPlayback();
      } else {
        state.index = Math.min(absIdx, state.queue.length - 1);
        void loadAndPlayCurrent();
      }
    }
    if (!removingCurrent) prefetchNextSongUrl();
    notify();
  }

  function reorderQueue(from: number, to: number) {
    if (from === to) return;
    if (from < 0 || from >= state.queue.length) return;
    if (to < 0 || to > state.queue.length) return;
    const nextQueue = [...state.queue];
    const [item] = nextQueue.splice(from, 1);
    if (!item) return;
    nextQueue.splice(to > from ? to - 1 : to, 0, item);
    state.queue = nextQueue;
    // 修正 index
    if (from === state.index) {
      state.index = to > from ? to - 1 : to;
    } else if (from < state.index && to > state.index) {
      state.index -= 1;
    } else if (from > state.index && to <= state.index) {
      state.index += 1;
    }
    prefetchNextSongUrl();
    notify();
  }

  /** 清空“下一首”列表，保留当前歌曲和已播放部分。 */
  function clearQueue() {
    if (state.index >= 0 && state.index < state.queue.length) {
      state.queue = state.queue.slice(0, state.index + 1);
    } else {
      state.queue = [];
      state.index = -1;
      stopPlayback();
    }
    notify();
  }

  function getNextUp(limit = 100): Song[] {
    return state.queue.slice(state.index + 1, state.index + 1 + limit);
  }

  // =============== 公开命令 ===============

  async function playList(songs: Song[], startIndex = 0) {
    if (songs.length === 0) return;
    state.queue = [...songs];
    state.index = Math.max(0, Math.min(startIndex, songs.length - 1));
    notify();
    await loadAndPlayCurrent();
  }

  /** 播放单首歌曲（不替换队列，但加入当前索引的下一位） */
  async function playSong(song: Song) {
    const existIdx = state.queue.findIndex((s) => s.id === song.id);
    if (existIdx >= 0) {
      state.index = existIdx;
    } else {
      const insertAt = state.index + 1;
      const nextQueue = [...state.queue];
      nextQueue.splice(insertAt, 0, song);
      state.queue = nextQueue;
      state.index = insertAt;
    }
    notify();
    await loadAndPlayCurrent();
  }

  /** 播放/暂停；待加载请求被取消后再次播放时会重新取当前歌曲 URL。 */
  function togglePlay() {
    if (state.playing || state.loading) {
      pause();
      return;
    }
    const hasCurrentSource =
      getCurrentSong()?.id === state.currentSongId &&
      (activeHandle?.hasSource() ?? false);
    if (hasCurrentSource) {
      void resume();
    } else {
      void loadAndPlayCurrent();
    }
  }

  /** 暂停，同时取消尚未完成的取 URL/装载请求。 */
  function pause() {
    playSeq += 1;
    playbackRequested = false;
    const handle = activeHandle;
    if (handle) syncCurrentTime(handle);
    state.playing = false;
    state.loading = false;
    handle?.pause();
    notify();
  }

  /** 下一首 */
  async function next() {
    if (state.queue.length === 0) return;

    if (state.playMode === "shuffle") {
      // 随机模式下：若队列 >1，随机选一个不同的；否则保持
      if (state.queue.length > 1) {
        let nextIdx = state.index;
        while (nextIdx === state.index) {
          nextIdx = Math.floor(Math.random() * state.queue.length);
        }
        state.index = nextIdx;
      }
    } else if (state.queue.length > 1) {
      // 手动“下一首”不受单曲循环影响；单曲循环仅控制 ended 行为。
      state.index = (state.index + 1) % state.queue.length;
    } else {
      if (state.playMode === "loop-list") {
        await loadAndPlayCurrent();
      }
      return;
    }
    notify();
    await loadAndPlayCurrent();
  }

  /** 上一首 */
  async function prev() {
    if (state.queue.length === 0) return;

    // 若已播放 > 3 秒，则"上一首"=回到当前歌曲开头
    if (getMediaCurrentTime() > 3) {
      seek(0);
      return;
    }

    if (state.queue.length > 1) {
      state.index =
        (state.index - 1 + state.queue.length) % state.queue.length;
    } else {
      seek(0);
      return;
    }
    notify();
    await loadAndPlayCurrent();
  }

  function togglePlayMode() {
    const order: PlayMode[] = ["loop-list", "loop-one", "shuffle"];
    const cur = order.indexOf(state.playMode);
    state.playMode = order[(cur + 1) % order.length];
    prefetchNextSongUrl();
    notify();
  }

  /** 跳转到指定秒数 */
  function seek(seconds: number) {
    const handle = activeHandle;
    if (
      !handle ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(handle.duration)
    ) {
      return;
    }
    const target = Math.max(0, Math.min(seconds, handle.duration));
    handle.seekTo(target);
    // seeking/timeupdate 都是异步事件，拖动后先立即更新状态。
    state.currentTime = target;
    state.seekRevision += 1;
    notify();
  }

  /** 设置音量 0~1 */
  function setVolume(v: number) {
    const safe = Number.isFinite(v) ? v : 0.8;
    const clamped = Math.max(0, Math.min(1, safe));
    state.volume = clamped;
    state.muted = clamped === 0;
    activeHandle?.setVolume(clamped);
    activeHandle?.setMuted(state.muted);
    notify();
  }

  function toggleMute() {
    state.muted = !state.muted;
    activeHandle?.setMuted(state.muted);
    notify();
  }

  function getMediaClockSample(): MediaClockSample {
    return sampleAuthoritativeMediaClock(
      activeHandle,
      mediaGeneration,
      state,
      now(),
    );
  }

  function destroy() {
    destroyActiveMedia();
    songUrlCache.clear();
    songUrlRequests.clear();
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCurrentSong,
    getMediaClockSample,
    playList,
    playSong,
    togglePlay,
    pause,
    next,
    prev,
    togglePlayMode,
    seek,
    setVolume,
    toggleMute,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    getNextUp,
    notifyAuthEpochChanged,
    destroy,
  };
}
