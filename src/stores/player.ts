// 播放器 Pinia Store：Playback Engine 的薄 Vue adapter。
// 全部播放行为（队列/播放模式/Media Generation/URL 缓存/自动切歌）都在
// src/playback/playbackEngine.ts；这里只负责装配——注入 HTMLAudio runtime、
// Tauri IPC 解析、auth epoch 订阅、MediaSession、音量持久化——并把
// 引擎状态镜像成 Pinia reactivity，对外 interface 与旧版保持一致。

import { defineStore } from "pinia";
import {
  computed,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  shallowRef,
} from "vue";

import { createPlaybackEngine } from "@/playback/playbackEngine";
import { createHtmlAudioRuntime } from "@/playback/htmlAudioRuntime";
import { attachMediaSession } from "@/playback/mediaSessionAdapter";
import { getAuthEpoch, subscribeAuthEpoch } from "@/services/authEpoch";
import { getSongUrl } from "@/composables/useNcmApi";
import {
  readStoredAudioQuality,
  writeStoredAudioQuality,
} from "@/utils/audioQuality";
import type { AudioQuality, PlayMode, Song } from "@/types/music";

const VOLUME_STORAGE_KEY = "nnplayer.volume";
/** 实际音质信息记录容量：覆盖队列附近即可，与引擎 URL 缓存同量级。 */
const RESOLVED_AUDIO_LIMIT = 16;

/** 一次播放地址解析带回的实际下发信息（按歌曲分键记录）。 */
interface ResolvedAudioInfo {
  /** 实际下发码率（bps）；0 表示未知 */
  bitrate: number;
  /** 实际下发档位；null 表示未知 */
  actualLevel: AudioQuality | null;
}

function readStoredVolume(): number {
  try {
    const stored = Number(localStorage.getItem(VOLUME_STORAGE_KEY) ?? "0.8");
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) {
      return stored;
    }
  } catch {
    // localStorage 不可用时沿用默认音量
  }
  return 0.8;
}

export const usePlayerStore = defineStore("player", () => {
  /** 音质档位在引擎外持有：resolver 每次调用时实时读取。 */
  const quality = ref<AudioQuality>(readStoredAudioQuality());
  /** 音质变更代际（非响应式）：A→B→A 时档位字符串会回到旧值，只有代际能
   *  识别被取代的旧请求，防止其晚到的实际信息覆盖新一代结果。 */
  let qualityRevision = 0;
  /** 每首歌最近一次成功解析携带的实际下发档位与码率，按 songId 记录。
   *  必须按歌曲分键：引擎会预取下一首的 URL，下一首播放时可能直接命中
   *  URL 缓存、不再经过上游 resolver，靠预取时写入的条目才能拿到实际信息。 */
  const resolvedAudioInfo = shallowRef<ReadonlyMap<number, ResolvedAudioInfo>>(
    new Map(),
  );

  function recordResolvedAudio(songId: number, info: ResolvedAudioInfo) {
    const next = new Map(resolvedAudioInfo.value);
    // Map 插入顺序作 LRU 顺序，写入前先删除使命中条目移到末尾。
    next.delete(songId);
    next.set(songId, info);
    while (next.size > RESOLVED_AUDIO_LIMIT) {
      const oldest = next.keys().next().value;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
    resolvedAudioInfo.value = next;
  }

  const engine = createPlaybackEngine({
    runtime: createHtmlAudioRuntime(),
    resolveSongUrl: (songId) => {
      const requestedQuality = quality.value;
      // A→B→A 切档时仅比较档位字符串会把旧请求误判为当前请求，须记录代际。
      const requestedRevision = qualityRevision;
      const requestedAuthEpoch = getAuthEpoch();
      return getSongUrl(songId, requestedQuality).then((r) => {
        // 切档（含切回旧档）/换号后在途的旧请求晚到时，其实际档位与码率
        // 属于已被取代的请求或旧账号，不得写入。
        if (
          requestedRevision === qualityRevision &&
          requestedAuthEpoch === getAuthEpoch()
        ) {
          recordResolvedAudio(songId, {
            bitrate: r.bitrate,
            actualLevel: r.actualLevel ?? null,
          });
        }
        return r.url;
      });
    },
    initialVolume: readStoredVolume(),
    initialAuthEpoch: getAuthEpoch(),
  });

  // =============== 状态镜像 ===============

  const initial = engine.getState();
  /** 引擎的队列/历史是不可变数组：整体替换，引用比较即可判定变更。 */
  const queue = shallowRef<readonly Song[]>(initial.queue);
  const index = ref(initial.index);
  const playMode = ref<PlayMode>(initial.playMode);
  const history = shallowRef<readonly Song[]>(initial.history);

  const audioState = reactive({
    currentSongId: initial.currentSongId,
    playing: initial.playing,
    loading: initial.loading,
    currentTime: initial.currentTime,
    seekRevision: initial.seekRevision,
    duration: initial.duration,
    volume: initial.volume,
    muted: initial.muted,
  });

  let persistedVolume = initial.volume;

  function syncFromEngine() {
    const s = engine.getState();
    if (queue.value !== s.queue) queue.value = s.queue;
    if (history.value !== s.history) history.value = s.history;
    index.value = s.index;
    playMode.value = s.playMode;
    audioState.currentSongId = s.currentSongId;
    audioState.playing = s.playing;
    audioState.loading = s.loading;
    audioState.currentTime = s.currentTime;
    audioState.seekRevision = s.seekRevision;
    audioState.duration = s.duration;
    audioState.volume = s.volume;
    audioState.muted = s.muted;
    // 音量持久化是壳层关心点，引擎只产出状态。
    if (s.volume !== persistedVolume) {
      persistedVolume = s.volume;
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(s.volume));
      } catch {
        // localStorage 不可用不应中断播放控制
      }
    }
  }

  const unsubscribeEngine = engine.subscribe(syncFromEngine);
  const stopAuthEpochSubscription = subscribeAuthEpoch((epoch) => {
    // 账号切换后同首歌的可用档位与码率随权益变化，旧记录一律作废。
    resolvedAudioInfo.value = new Map();
    engine.notifyAuthEpochChanged(epoch);
  });
  const detachMediaSession = attachMediaSession(engine);

  // =============== 计算属性 ===============

  const currentSong = computed<Song | null>(() => {
    return index.value >= 0 && index.value < queue.value.length
      ? queue.value[index.value]
      : null;
  });

  const hasNext = computed(() => {
    return index.value >= 0 && queue.value.length > 1;
  });

  const hasPrev = computed(() => index.value >= 0 && queue.value.length > 1);

  /** 当前已装载媒体的解析结果；尚未解析或已切换媒体时为 null。
   *  以 audioState.currentSongId 为键（而不是队列 index）：切歌瞬间 index
   *  可能已前进但新媒体尚未装载，不能把下一首的预取信息当成当前实际音质。 */
  const activeAudioInfo = computed<ResolvedAudioInfo | null>(() => {
    const songId = audioState.currentSongId;
    if (songId === null) return null;
    return resolvedAudioInfo.value.get(songId) ?? null;
  });

  /** 当前媒体的实际下发码率（bps）；未知时为 null。 */
  const activeBitrate = computed<number | null>(() => {
    const bitrate = activeAudioInfo.value?.bitrate;
    return typeof bitrate === "number" && bitrate > 0 ? bitrate : null;
  });

  /** 当前媒体的实际下发档位；上游未返回/无法识别时为 null。 */
  const activeQuality = computed<AudioQuality | null>(
    () => activeAudioInfo.value?.actualLevel ?? null,
  );

  /** 当前媒体是否已经完成播放地址解析（无论档位/码率是否已知）。 */
  const activeAudioResolved = computed(() => activeAudioInfo.value !== null);

  /** 切换音质：持久化 → 作废旧实际音质记录与 URL 缓存 → 当前曲按新档位立即重载。 */
  function setQuality(next: AudioQuality) {
    // 同值早退：未真正切档，不得推进代际，也不得重载当前曲。
    if (next === quality.value) return;
    qualityRevision += 1;
    quality.value = next;
    writeStoredAudioQuality(next);
    resolvedAudioInfo.value = new Map();
    engine.invalidateSongUrlCache();
    engine.reloadCurrent();
  }

  onScopeDispose(() => {
    unsubscribeEngine();
    stopAuthEpochSubscription();
    detachMediaSession();
    engine.destroy();
  });

  return {
    // 状态
    queue,
    index,
    playMode,
    history,
    currentSong,
    hasNext,
    hasPrev,
    // 音质：quality 为所选请求档位，active* 为当前媒体实际下发信息
    quality,
    activeQuality,
    activeBitrate,
    activeAudioResolved,
    setQuality,
    // 转发引擎
    audioState: readonly(audioState),
    getMediaClockSample: engine.getMediaClockSample,
    togglePlay: engine.togglePlay,
    seek: engine.seek,
    setVolume: engine.setVolume,
    toggleMute: engine.toggleMute,
    // 队列操作
    playList: engine.playList,
    playSong: engine.playSong,
    next: engine.next,
    prev: engine.prev,
    togglePlayMode: engine.togglePlayMode,
    removeFromQueue: engine.removeFromQueue,
    reorderQueue: engine.reorderQueue,
    clearQueue: engine.clearQueue,
    getNextUp: engine.getNextUp,
  };
});
