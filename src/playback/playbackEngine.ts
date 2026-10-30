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

/** 播放链路失败阶段：装载（取 URL / 首次 play）、播放中流中断、切档重载。 */
export type PlaybackFailureStage = "load" | "stream" | "reload";

/**
 * 一次播放失败的事实通报（歌曲 + 原因 + 连续失败计数）。
 *
 * 引擎只提供事实与原始文本；面向用户的语言映射由 utils/appErrors 负责，
 * UI 消费后经 dismissPlaybackFailure / retryFailedPlayback 清除或重试。
 */
export interface PlaybackFailure {
  /** 自增序号：同一歌曲重复失败时 UI 据此识别是一次新事件。 */
  revision: number;
  songId: number;
  songName: string;
  stage: PlaybackFailureStage;
  /** 后端错误类别（AppError.kind）或引擎内部类别（NoSource / Media）；未知为 null。 */
  kind: string | null;
  /** 原始技术文本（可能为空，例如媒体元素只给数字 code）。 */
  message: string;
  /** 本次连续失败计数（从 1 起）。 */
  failCount: number;
  /** 是否因连续失败达到上限而停止自动切换。 */
  stopped: boolean;
  /** 连续失败涉及的歌曲名（按发生顺序；仅在 stopped 汇总时使用）。 */
  recentSongNames: readonly string[];
  /** 失败前用户是否有播放意图；重载失败重试时用于恢复播放/暂停意图。 */
  wasPlaying: boolean;
}

/** 暂无可用播放源（URL 解析成功但上游返回空）的引擎内部分类。 */
const NO_SOURCE_KIND = "NoSource";

class NoPlayableSourceError extends Error {
  readonly kind = NO_SOURCE_KIND;

  constructor() {
    super("该歌曲暂无可用播放源");
    this.name = "NoPlayableSourceError";
  }
}

/** HTMLMediaElement MediaError.code → 可读原文（媒体元素本身不给 message）。 */
const MEDIA_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  1: "媒体加载被中止（MEDIA_ERR_ABORTED）",
  2: "媒体网络错误（MEDIA_ERR_NETWORK）",
  3: "媒体解码失败（MEDIA_ERR_DECODE）",
  4: "播放源不可用或格式不受支持（MEDIA_ERR_SRC_NOT_SUPPORTED）",
};

/** 从任意错误对象里提取 kind / message，供 UI 映射；不抛错。 */
function readFailureCause(error: unknown): {
  kind: string | null;
  message: string;
} {
  if (typeof error === "string") {
    return { kind: null, message: error };
  }
  if (error && typeof error === "object") {
    const candidate = error as {
      kind?: unknown;
      message?: unknown;
      code?: unknown;
    };
    const kind =
      typeof candidate.kind === "string" && candidate.kind.trim()
        ? candidate.kind
        : null;
    const message =
      typeof candidate.message === "string" ? candidate.message.trim() : "";
    if (kind !== null) return { kind, message };
    if (message) return { kind: null, message };
    if (typeof candidate.code === "number") {
      return {
        kind: "Media",
        message:
          MEDIA_ERROR_MESSAGES[candidate.code] ??
          `媒体错误（代码 ${candidate.code}）`,
      };
    }
    if (error instanceof Error) {
      return { kind: null, message: error.message.trim() };
    }
    return { kind: null, message: "" };
  }
  return {
    kind: null,
    message: error === null || error === undefined ? "" : String(error),
  };
}

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
  /** 最近一次播放失败的通报；null 表示没有未处理的失败。 */
  lastPlaybackFailure: PlaybackFailure | null;
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
  /** 取 URL 的上游参数（音质档位）变化输入口；清缓存，不影响当前媒体 */
  invalidateSongUrlCache(): void;
  /** 按当前队列索引重载当前已装载歌曲，保留播放/暂停意图；
   *  无已装载媒体（currentSongId 为 null）时 no-op；失败不自动切歌。 */
  reloadCurrent(): void;
  /** 重试最近一次失败的播放：装载/流中断失败重播失败歌曲，切档重载失败按原意图重载。 */
  retryFailedPlayback(): Promise<void>;
  /** 清除最近一次播放失败通报（用户关闭提示）；不清空连续失败计数。 */
  dismissPlaybackFailure(): void;
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
    lastPlaybackFailure: null,
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
  /** 连续失败涉及的歌曲（成功播放后清空），用于停止自动切换时的汇总提示。 */
  let failStreakSongs: Song[] = [];
  /** 失败通报序号；同一首歌重复失败也能被 UI 识别为新事件。 */
  let failureRevision = 0;

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

  /** 记录一次播放失败并通知订阅者；调用方负责决定是否自动切歌。 */
  function recordPlaybackFailure(
    stage: PlaybackFailureStage,
    error: unknown,
    details: {
      failCount: number;
      stopped: boolean;
      wasPlaying: boolean;
      recentSongNames: readonly string[];
    },
  ) {
    const song = getCurrentSong();
    const songId = song?.id ?? state.currentSongId;
    if (songId === null) return;
    const cause = readFailureCause(error);
    state.lastPlaybackFailure = {
      revision: ++failureRevision,
      songId,
      songName: song?.name ?? `歌曲 ${songId}`,
      stage,
      kind: cause.kind,
      message: cause.message,
      failCount: details.failCount,
      stopped: details.stopped,
      recentSongNames: details.recentSongNames,
      wasPlaying: details.wasPlaying,
    };
    notify();
  }

  /**
   * 用户意图的播放成功开始后，清除上一首遗留的失败通报。
   *
   * 只由显式播放路径（点播/切歌/播放、切档重载、点暂停条继续播放）调用；
   * 失败链内部的自动跳歌不调用，否则「播放失败」通报会在自动跳到下一首
   * 成功时立刻消失，失败就又被静默吞掉了。
   */
  function clearStalePlaybackFailure() {
    if (state.lastPlaybackFailure === null) return;
    state.lastPlaybackFailure = null;
    notify();
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
        const wasInitialLoad = initialPlayHandle === handle;
        const shouldRecover = playbackRequested && !wasInitialLoad;
        playbackRequested = false;
        invalidateSongUrl(state.currentSongId);
        state.loading = false;
        state.playing = false;
        // eslint-disable-next-line no-console
        console.error("[playback] 播放失败", event.error);
        // 当前 source 已经不可用。即使错误发生在暂停期间也必须销毁，
        // 否则下一次点击会永远 resume 同一个坏 URL。
        destroyActiveMedia();
        // 首次装载的 play() 错误由 loadAndPlay 的 Promise reject 处理，统一在
        // 那里通报，避免同一次失败产生两条记录。
        if (shouldRecover) {
          void recoverFromPlaybackFailure(
            new Error("播放过程中媒体流中断"),
            "stream",
          );
        } else if (!wasInitialLoad) {
          // 暂停期间或无播放意图时发现坏 source：不自动切歌，但失败必须可见。
          recordPlaybackFailure(
            "stream",
            event.error ?? new Error("播放过程中媒体流中断"),
            {
              failCount: playFailCount,
              stopped: false,
              wasPlaying: false,
              recentSongNames: failStreakSongs.map((song) => song.name),
            },
          );
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
  /** 音质等取 URL 上游参数变化时递增：在途旧请求的结果不得回写新缓存。 */
  let urlEpoch = 0;

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
    const requestUrlEpoch = urlEpoch;
    const cached = getCachedSongUrl(songId);
    if (cached) return cached;

    const pending = songUrlRequests.get(songId);
    if (pending) return pending;

    const request = resolveSongUrlUpstream(songId)
      .then((url) => {
        // epoch 已切换时旧账号的结果不能回写当前缓存。
        if (requestAuthEpoch !== authEpoch) return null;
        // 取参代际（音质等）已切换时，在途旧请求同样不能回写新缓存。
        if (requestUrlEpoch !== urlEpoch) return null;
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
    // 旧账号的播放失败通报不能带到新会话。
    state.lastPlaybackFailure = null;
    playFailCount = 0;
    failStreakSongs = [];
    notify();
  }

  /** 取 URL 的上游参数（音质档位）变化后调用：清空缓存与在途合并表，
   *  之后的 resolveSongUrl 一律重新请求。不动当前媒体与 auth epoch。 */
  function invalidateSongUrlCache() {
    urlEpoch += 1;
    songUrlCache.clear();
    songUrlRequests.clear();
  }

  /** 按当前队列索引重载当前已装载歌曲（切音质等场景）。
   *  保留播放/暂停意图：按切换前的意图决定是否 play()。
   *  无已装载媒体时 no-op；失败不改队列/索引、不自动切歌，但会通报给 UI。 */
  function reloadCurrent() {
    if (!getCurrentSong() || state.currentSongId === null) return;
    // playbackRequested 已在 loadAndPlay 里于 await 之前记录本次装载的播放意图，
    // 这里不能再把 state.loading 当作意图：暂停态切档重载在取 URL 期间同样会
    // 置 loading=true，二次切档会被误判成“继续播放”而自动出声。
    const autoplay = playbackRequested || state.playing;
    void reloadCurrentSong(autoplay, true);
  }

  async function reloadCurrentSong(
    autoplay: boolean,
    clearFailureOnSuccess = false,
  ) {
    const song = getCurrentSong();
    if (!song) return;
    try {
      const started = await loadAndPlay(song.id, autoplay, clearFailureOnSuccess);
      if (!started || getCurrentSong()?.id !== song.id) return;
      playFailCount = 0;
      failStreakSongs = [];
      prefetchNextSongUrl();
      notify();
    } catch (e) {
      // 切音质等重载不是播放命令：失败不进入自动切歌，也不写播放历史。
      // 但媒体已被销毁、播放会停在这里，必须把失败通报给 UI。
      // eslint-disable-next-line no-console
      console.error("[playback] 重载当前歌曲失败，队列与当前索引保持不变", e);
      recordPlaybackFailure("reload", e, {
        failCount: 0,
        stopped: false,
        wasPlaying: autoplay,
        recentSongNames: [],
      });
    }
  }

  // =============== 装载与播放 ===============

  /**
   * 加载指定歌曲：解析 URL → 创建新 Media Generation →（autoplay 时）play()。
   * autoplay=false 时只装载媒体并保持暂停，供切换音质等场景保留暂停意图。
   * clearFailureOnSuccess=true 表示这是用户显式发起的播放：成功开始播放后
   * 清除上一首遗留的失败通报；失败链内部的自动切歌不传 true，避免把失败
   * 通报吞掉。
   * 返回 false 表示请求已被更新的装载/epoch 切换取代。
   */
  async function loadAndPlay(
    songId: number,
    autoplay = true,
    clearFailureOnSuccess = false,
  ): Promise<boolean> {
    const seq = ++playSeq;
    const requestAuthEpoch = authEpoch;
    try {
      // 立即销毁旧代际，避免 UI 已切歌但仍播放上一首。
      // 新代际要等 URL 请求成功后才创建。
      state.playing = false;
      destroyActiveMedia();
      // destroyActiveMedia 会把 playbackRequested 清空；在 await 之前就记录
      // 本次装载的播放意图，供 reloadCurrent / togglePlay 在取 URL 期间区分
      // “有播放意图的装载”与“暂停态切档重载”。此时还没有媒体句柄，
      // 不会产生任何事件，提前置位是安全的。
      playbackRequested = autoplay;
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
        throw new NoPlayableSourceError();
      }

      const handle = createActiveMedia(resolvedUrl);
      if (!autoplay) {
        if (seq !== playSeq || activeHandle !== handle) return false;
        state.loading = false;
        notify();
        return true;
      }
      initialPlayHandle = handle;
      playbackRequested = true;
      try {
        await handle.play();
      } finally {
        if (initialPlayHandle === handle) initialPlayHandle = null;
      }
      if (seq !== playSeq || activeHandle !== handle) return false;
      state.loading = false;
      if (clearFailureOnSuccess) clearStalePlaybackFailure();
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

  async function recoverFromPlaybackFailure(
    error: unknown,
    stage: Extract<PlaybackFailureStage, "load" | "stream">,
  ) {
    playFailCount += 1;
    const failedSong = getCurrentSong();
    if (failedSong) failStreakSongs = [...failStreakSongs, failedSong];
    const recentSongNames = failStreakSongs.map((song) => song.name);
    if (playFailCount >= 3) {
      console.error("[playback] 连续 3 次播放失败，停止自动切换", error);
      // 停止自动切换也必须把原因与歌曲汇总给 UI，不能只在控制台里结束。
      recordPlaybackFailure(stage, error, {
        failCount: playFailCount,
        stopped: true,
        wasPlaying: true,
        recentSongNames,
      });
      playFailCount = 0;
      failStreakSongs = [];
      return;
    }
    console.error("[playback] 播放失败，自动跳到下一首", error);
    recordPlaybackFailure(stage, error, {
      failCount: playFailCount,
      stopped: false,
      wasPlaying: true,
      recentSongNames,
    });
    // 失败链内部的自动切歌：成功也不得清除刚记录的失败通报。
    await next(true);
  }

  /** 播放当前索引对应的歌曲。
   *  clearFailureOnSuccess=true 表示用户显式发起的播放，成功后清旧失败通报。 */
  async function loadAndPlayCurrent(clearFailureOnSuccess = false) {
    const song = getCurrentSong();
    if (!song) return;
    try {
      const started = await loadAndPlay(
        song.id,
        true,
        clearFailureOnSuccess,
      );
      if (!started || getCurrentSong()?.id !== song.id) return;
      pushHistory(song);
      playFailCount = 0;
      failStreakSongs = [];
      prefetchNextSongUrl();
      notify();
    } catch (e) {
      await recoverFromPlaybackFailure(e, "load");
    }
  }

  /** 继续播放当前已装载的 source。
   *  clearFailureOnSuccess=true 表示用户显式点播放/继续，成功后清旧失败通报。 */
  async function resume(clearFailureOnSuccess = false) {
    const handle = activeHandle;
    if (!handle || !handle.hasSource()) return;
    playbackRequested = true;
    try {
      await handle.play();
      // 期间被 pause/新装载取代则不结算本次「成功开始播放」。
      if (activeHandle !== handle || !playbackRequested) return;
      if (clearFailureOnSuccess) clearStalePlaybackFailure();
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
      void recoverFromPlaybackFailure(error, "stream");
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
    // 队列已结束/清空时，之前那首歌的失败通报不再有意义。
    state.lastPlaybackFailure = null;
  }

  /** 重试最近一次失败的播放：装载/流中断失败重播失败歌曲，切档重载按原意图重载。 */
  async function retryFailedPlayback() {
    const failure = state.lastPlaybackFailure;
    if (!failure) return;
    // 失败歌曲仍是当前已装载媒体（切档失败后未换歌）：按失败前的播放/暂停意图重载。
    const sameSongStillCurrent =
      failure.songId === state.currentSongId &&
      getCurrentSong()?.id === failure.songId;
    if (failure.stage === "reload" && sameSongStillCurrent) {
      state.lastPlaybackFailure = null;
      playFailCount = 0;
      failStreakSongs = [];
      notify();
      await reloadCurrentSong(failure.wasPlaying);
      return;
    }
    // 其它情况（含切档失败后用户已切到别的歌，或装载/流中断失败后自动跳走）
    // 都必须重试「失败歌曲」本身，不能把当前恰好装载的另一首歌当成重试目标。
    const index = state.queue.findIndex((song) => song.id === failure.songId);
    if (index < 0) {
      // 失败歌曲已不在队列：保留通报（用户仍能看到原因并手动关闭），不擅自播放别的歌。
      return;
    }
    // 重试是一次新的尝试：先清旧通报，失败会生成带新 revision 的通报。
    state.lastPlaybackFailure = null;
    playFailCount = 0;
    failStreakSongs = [];
    state.index = index;
    notify();
    await loadAndPlayCurrent();
  }

  /** 清除播放失败通报（用户关闭提示）；不清空连续失败计数。 */
  function dismissPlaybackFailure() {
    if (state.lastPlaybackFailure === null) return;
    state.lastPlaybackFailure = null;
    notify();
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
        // 删除当前曲后继续播下一首是用户操作的直接结果，按用户意图处理。
        void loadAndPlayCurrent(true);
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
    await loadAndPlayCurrent(true);
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
    await loadAndPlayCurrent(true);
  }

  /** 播放/暂停；待加载请求被取消后再次播放时会重新取当前歌曲 URL。 */
  function togglePlay() {
    // loading 且无播放意图只出现在“暂停态切档重载”的取 URL 窗口：这时的
    // 点击语义是开始播放，不能被当成暂停/取消装载。
    if (state.loading && !playbackRequested) {
      if (getCurrentSong()?.id === state.currentSongId) {
        // 复用同一首歌在途的 URL 请求；不写播放历史、不改队列索引。
        void reloadCurrentSong(true, true);
      } else {
        void loadAndPlayCurrent(true);
      }
      return;
    }
    if (state.playing || state.loading) {
      pause();
      return;
    }
    const hasCurrentSource =
      getCurrentSong()?.id === state.currentSongId &&
      (activeHandle?.hasSource() ?? false);
    if (hasCurrentSource) {
      void resume(true);
    } else {
      void loadAndPlayCurrent(true);
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

  /** 下一首。
   *  autoRecovery=true 仅由失败恢复链内部使用：成功后不得清掉失败通报。 */
  async function next(autoRecovery = false) {
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
        await loadAndPlayCurrent(!autoRecovery);
      }
      return;
    }
    notify();
    await loadAndPlayCurrent(!autoRecovery);
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
    await loadAndPlayCurrent(true);
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
    // 取消所有尚未完成的装载，避免 destroy 之后仍创建/启动新代际媒体。
    playSeq += 1;
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
    invalidateSongUrlCache,
    reloadCurrent,
    retryFailedPlayback,
    dismissPlaybackFailure,
    destroy,
  };
}
