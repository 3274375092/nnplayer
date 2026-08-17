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
import type { PlayMode, Song } from "@/types/music";

const VOLUME_STORAGE_KEY = "nnplayer.volume";

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
  const engine = createPlaybackEngine({
    runtime: createHtmlAudioRuntime(),
    resolveSongUrl: (songId) => getSongUrl(songId).then((r) => r.url),
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
  const stopAuthEpochSubscription = subscribeAuthEpoch((epoch) =>
    engine.notifyAuthEpochChanged(epoch),
  );
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
