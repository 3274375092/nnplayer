// 播放器 Pinia Store。
// 职责：管理播放队列、当前歌曲、播放模式、上下首逻辑。
// 不直接操作 audio DOM（交给 useAudioPlayer），只持有业务状态。

import { defineStore } from "pinia";
import { computed, ref } from "vue";

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
    if (playMode.value === "loop-one") return true;
    return index.value < queue.value.length - 1;
  });

  const hasPrev = computed(() => index.value > 0);

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
      await controller.playSong(song.id);
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

  /** 监听 audio 的 ended 事件，触发自动下一首 */
  function bindAutoNext() {
    controller.audioEl.addEventListener("nnplayer:ended", () => {
      if (playMode.value === "loop-one") {
        void playCurrent();
      } else {
        void next();
      }
    });
  }

  return {
    // 状态
    queue,
    index,
    playMode,
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
  };
});