// 播放器 Pinia Store。
// 职责：管理播放队列、当前歌曲、播放模式、上下首逻辑。
// 不直接操作 audio DOM（交给 useAudioPlayer），只持有业务状态。

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

import { useAudioPlayer } from "@/composables/useAudioPlayer";
import { useThemeStore } from "@/stores/theme";
import type { PlayMode, Song } from "@/types/music";

export const usePlayerStore = defineStore("player", () => {
  // 单例 audio 控制器，整个应用共享一个 audio 元素
  const controller = useAudioPlayer();
  // 主题色 store：当前歌曲封面变化时驱动主题色
  const themeStore = useThemeStore();

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

  // =============== 副作用 ===============

  // 监听当前歌曲变化：把封面主色应用到主题
  // - 有 picUrl：触发封面提取（debounce 200ms 由 theme store 处理）
  // - 无 picUrl：重置回米黄默认
  watch(
    currentSong,
    (song) => {
      if (song?.picUrl) {
        themeStore.applyFromCover(song.picUrl);
      } else {
        themeStore.resetToDefault();
      }
    },
    { immediate: true },
  );

  const hasNext = computed(() => {
    if (playMode.value === "loop-one") return true;
    return index.value < queue.value.length - 1;
  });

  const hasPrev = computed(() => index.value > 0);

  // =============== 队列管理（阶段4） ===============

  /** 播放历史（最近 50 首），playCurrent 成功时 push */
  const history = ref<Song[]>([]);

  /** 移除队列中某项（absIdx 是绝对索引，含已播过的） */
  function removeFromQueue(absIdx: number) {
    if (absIdx < 0 || absIdx >= queue.value.length) return;
    queue.value.splice(absIdx, 1);
    // 修正 index：若移除项在当前之前，index-1；若就是当前，index 不变（指向下一首）
    if (absIdx < index.value) {
      index.value -= 1;
    } else if (absIdx === index.value) {
      // 当前歌曲被移除：index 指向它的下一首（即现在的 absIdx）
      if (index.value >= queue.value.length) {
        // 已播到队尾，停在这里
        return;
      }
    }
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
  }

  /** 清空队列（保留 index 0 之外的已播部分） */
  function clearQueue() {
    queue.value = [];
    index.value = -1;
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
  async function playCurrent() {
    const song = currentSong.value;
    if (!song) return;
    try {
      await controller.playSong(song.id, song);
      pushHistory(song);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[player] 播放失败，自动跳到下一首", e);
      await next();
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
    } else {
      if (index.value < queue.value.length - 1) {
        index.value += 1;
      } else if (playMode.value === "loop-list") {
        index.value = 0;
      } else {
        // 列表不循环：停在末尾
        return;
      }
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

    if (index.value > 0) {
      index.value -= 1;
    } else if (playMode.value === "loop-list") {
      index.value = queue.value.length - 1;
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
  }

  /** 监听 audio 的 ended 事件，触发自动下一首 + MediaSession 系统媒体键 */
  function bindAutoNext() {
    controller.audioEl.addEventListener("nnplayer:ended", () => {
      if (playMode.value === "loop-one") {
        void playCurrent();
      } else {
        void next();
      }
    });
    // 系统媒体键（MediaSession）→ window 自定义事件桥接
    window.addEventListener("nnplayer:media:play", () => {
      if (!controller.state.playing) controller.resume();
    });
    window.addEventListener("nnplayer:media:pause", () => {
      if (controller.state.playing) controller.pause();
    });
    window.addEventListener("nnplayer:media:seek", ((e: CustomEvent<number>) => {
      controller.seek(e.detail);
    }) as EventListener);
    window.addEventListener("nnplayer:media:prev", () => {
      void prev();
    });
    window.addEventListener("nnplayer:media:next", () => {
      void next();
    });
  }

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
    togglePlay: controller.toggle,
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