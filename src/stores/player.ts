// 播放器 Pinia Store。
// 职责：管理播放队列、当前歌曲、播放模式、上下首逻辑。
// 不直接操作 audio DOM（交给 useAudioPlayer），只持有业务状态。

import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";

import { useAudioPlayer } from "@/composables/useAudioPlayer";
import type { PlayMode, Song } from "@/types/music";

export const usePlayerStore = defineStore("player", () => {
  // 单例 audio 控制器，整个应用共享一个 audio 元素
  const controller = useAudioPlayer();

  // =============== 状态 ===============

  /** 当前播放队列 */
  const queue = ref<Song[]>([]);
  /** 队列中当前歌曲的索引 */
  const index = ref<number>(-1);
  /** 播放模式 */
  const playMode = ref<PlayMode>("loop-list");

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

  // =============== 队列管理（阶段4） ===============

  /** 播放历史（最近 50 首），playCurrent 成功时 push */
  const history = ref<Song[]>([]);

  /** 移除队列中某项（absIdx 是绝对索引，含已播过的） */
  function removeFromQueue(absIdx: number) {
    if (absIdx < 0 || absIdx >= queue.value.length) return;
    const removingCurrent = absIdx === index.value;
    queue.value.splice(absIdx, 1);
    // 修正 index：若移除项在当前之前，index-1。
    if (absIdx < index.value) {
      index.value -= 1;
    } else if (removingCurrent) {
      if (queue.value.length === 0) {
        index.value = -1;
        controller.stop();
      } else {
        index.value = Math.min(absIdx, queue.value.length - 1);
        void playCurrent();
      }
    }
    if (!removingCurrent) prefetchNextSongUrl();
  }

  /** 拖拽重排队列 [from, to)（abs 索引） */
  function reorderQueue(from: number, to: number) {
    if (from === to) return;
    if (from < 0 || from >= queue.value.length) return;
    if (to < 0 || to > queue.value.length) return;
    const [item] = queue.value.splice(from, 1);
    if (!item) return;
    queue.value.splice(to > from ? to - 1 : to, 0, item);
    // 修正 index
    if (from === index.value) {
      index.value = to > from ? to - 1 : to;
    } else if (from < index.value && to > index.value) {
      index.value -= 1;
    } else if (from > index.value && to <= index.value) {
      index.value += 1;
    }
    prefetchNextSongUrl();
  }

  /** 清空“下一首”列表，保留当前歌曲和已播放部分。 */
  function clearQueue() {
    if (index.value >= 0 && index.value < queue.value.length) {
      queue.value.splice(index.value + 1);
    } else {
      queue.value = [];
      index.value = -1;
      controller.stop();
    }
  }

  /** 队列中"下一首"列表（index 之后），limit 控制最大返回数 */
  function getNextUp(limit = 100): Song[] {
    return queue.value.slice(index.value + 1, index.value + 1 + limit);
  }

  /** 推入历史 */
  function pushHistory(song: Song) {
    history.value.unshift(song);
    if (history.value.length > 50) {
      history.value.length = 50;
    }
  }

  // =============== 命令式方法 ===============

  /**
   * 用一组歌曲替换播放队列，并从 startIndex 处开始播放。
   */
  async function playList(songs: Song[], startIndex = 0) {
    if (songs.length === 0) return;
    queue.value = [...songs];
    index.value = Math.max(0, Math.min(startIndex, songs.length - 1));
    await playCurrent();
  }

  /** 播放当前索引对应的歌曲 */
  let playFailCount = 0;

  function prefetchNextSongUrl() {
    // 只在列表循环下预取确定候选；随机不可预测，单曲循环无需下一首。
    if (playMode.value !== "loop-list" || queue.value.length < 2) return;
    const nextIndex = (index.value + 1) % queue.value.length;
    const nextSong = queue.value[nextIndex];
    if (!nextSong || nextSong.id === currentSong.value?.id) return;
    controller.prefetchSongUrl(nextSong.id);
  }

  async function recoverFromPlaybackFailure(error: unknown) {
    playFailCount++;
    if (playFailCount >= 3) {
      console.error("[player] 连续 3 次播放失败，停止自动切换", error);
      playFailCount = 0;
      return;
    }
    console.error("[player] 播放失败，自动跳到下一首", error);
    await next();
  }

  async function playCurrent() {
    const song = currentSong.value;
    if (!song) return;
    try {
      const started = await controller.playSong(song.id, song);
      if (!started || currentSong.value?.id !== song.id) return;
      pushHistory(song);
      playFailCount = 0;
      prefetchNextSongUrl();
    } catch (e) {
      await recoverFromPlaybackFailure(e);
    }
  }

  /** 播放单首歌曲（不替换队列，但加入队首） */
  async function playSong(song: Song) {
    // 若歌曲已在队列中，仅切换索引；否则插入到当前索引的下一位
    const existIdx = queue.value.findIndex((s) => s.id === song.id);
    if (existIdx >= 0) {
      index.value = existIdx;
    } else {
      const insertAt = index.value + 1;
      queue.value.splice(insertAt, 0, song);
      index.value = insertAt;
    }
    await playCurrent();
  }

  /** 播放/暂停；待加载请求被取消后再次播放时会重新取当前歌曲 URL。 */
  function togglePlay() {
    if (controller.state.playing || controller.state.loading) {
      controller.pause();
      return;
    }
    const hasCurrentSource =
      currentSong.value?.id === controller.state.currentSongId &&
      controller.hasSource();
    if (hasCurrentSource) {
      void controller.resume();
    } else {
      void playCurrent();
    }
  }

  /** 下一首 */
  async function next() {
    if (queue.value.length === 0) return;

    if (playMode.value === "shuffle") {
      // 随机模式下：若队列 >1，随机选一个不同的；否则保持
      if (queue.value.length > 1) {
        let nextIdx = index.value;
        while (nextIdx === index.value) {
          nextIdx = Math.floor(Math.random() * queue.value.length);
        }
        index.value = nextIdx;
      }
    } else if (queue.value.length > 1) {
      // 手动“下一首”不受单曲循环影响；单曲循环仅控制 ended 行为。
      index.value = (index.value + 1) % queue.value.length;
    } else {
      if (playMode.value === "loop-list") {
        await playCurrent();
      }
      return;
    }
    await playCurrent();
  }

  /** 上一首 */
  async function prev() {
    if (queue.value.length === 0) return;

    // 若已播放 > 3 秒，则"上一首"=回到当前歌曲开头
    if (controller.state.currentTime > 3) {
      controller.seek(0);
      return;
    }

    if (queue.value.length > 1) {
      index.value = (index.value - 1 + queue.value.length) % queue.value.length;
    } else {
      controller.seek(0);
      return;
    }
    await playCurrent();
  }

  /** 切换播放模式 */
  function togglePlayMode() {
    const order: PlayMode[] = ["loop-list", "loop-one", "shuffle"];
    const cur = order.indexOf(playMode.value);
    playMode.value = order[(cur + 1) % order.length];
    prefetchNextSongUrl();
  }

  /** 监听稳定的播放事件总线，触发自动下一首 + MediaSession 系统媒体键。
   *  幂等：多次调用不会重复注册监听器。*/
  let autoNextBound = false;
  const onPlaybackEnded = () => {
    if (playMode.value === "loop-one") {
      void playCurrent();
    } else {
      void next();
    }
  };
  const onPlaybackError = () => {
    void recoverFromPlaybackFailure(new Error("播放过程中媒体流中断"));
  };
  const onMediaPlay = () => {
    if (!controller.state.playing && !controller.state.loading) togglePlay();
  };
  const onMediaPause = () => {
    if (controller.state.playing || controller.state.loading) {
      controller.pause();
    }
  };
  const onMediaSeek = ((event: CustomEvent<number>) => {
    controller.seek(event.detail);
  }) as EventListener;
  const onMediaPrev = () => {
    void prev();
  };
  const onMediaNext = () => {
    void next();
  };

  function bindAutoNext() {
    if (autoNextBound) return;
    autoNextBound = true;
    controller.eventTarget.addEventListener("nnplayer:ended", onPlaybackEnded);
    controller.eventTarget.addEventListener("nnplayer:error", onPlaybackError);
    // 系统媒体键（MediaSession）→ window 自定义事件桥接
    window.addEventListener("nnplayer:media:play", onMediaPlay);
    window.addEventListener("nnplayer:media:pause", onMediaPause);
    window.addEventListener("nnplayer:media:seek", onMediaSeek);
    window.addEventListener("nnplayer:media:prev", onMediaPrev);
    window.addEventListener("nnplayer:media:next", onMediaNext);
  }

  onScopeDispose(() => {
    if (!autoNextBound) return;
    controller.eventTarget.removeEventListener("nnplayer:ended", onPlaybackEnded);
    controller.eventTarget.removeEventListener("nnplayer:error", onPlaybackError);
    window.removeEventListener("nnplayer:media:play", onMediaPlay);
    window.removeEventListener("nnplayer:media:pause", onMediaPause);
    window.removeEventListener("nnplayer:media:seek", onMediaSeek);
    window.removeEventListener("nnplayer:media:prev", onMediaPrev);
    window.removeEventListener("nnplayer:media:next", onMediaNext);
    autoNextBound = false;
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
    // 转发 audio 控制器
    audioState: controller.state,
    getMediaCurrentTime: controller.getMediaCurrentTime,
    getMediaPlaybackRate: controller.getMediaPlaybackRate,
    togglePlay,
    seek: controller.seek,
    setVolume: controller.setVolume,
    toggleMute: controller.toggleMute,
    // 队列操作
    playList,
    playSong,
    next,
    prev,
    togglePlayMode,
    bindAutoNext,
    // 阶段4：队列管理
    removeFromQueue,
    reorderQueue,
    clearQueue,
    getNextUp,
  };
});
