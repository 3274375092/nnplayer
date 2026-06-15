// 歌词 composable：
//   1. 拉取并解析当前歌曲歌词
//   2. 监听 audio currentTime，计算当前高亮行 activeLineIndex
//   3. 提供 seek 跳转方法（点击歌词行时使用）
//
// 设计原则：
//   - useAudioPlayer 内部已存在唯一的 <audio> 元素（由 player store 持有），
//     useLyric 只通过 playerStore.audioState 读取 currentTime，不再创建 audio。
//   - 切歌时自动重置并重新拉取。

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { getLyric } from "@/composables/useNcmApi";
import {
  findActiveLineIndex,
  parseLrc,
  type LyricLine,
} from "@/utils/lrcParser";
import { usePlayerStore } from "@/stores/player";

export interface UseLyricReturn {
  /** 解析后的歌词行 */
  lines: Ref<LyricLine[]>;
  /** 当前高亮行索引（-1 表示无） */
  activeLineIndex: Ref<number>;
  /** 加载中 */
  loading: Ref<boolean>;
  /** 加载/解析错误 */
  error: Ref<string>;
  /** 是否存在原文歌词 */
  hasLyric: ComputedRef<boolean>;
  /** 跳转到指定时间（秒） */
  seekTo: (seconds: number) => void;
}

export function useLyric(): UseLyricReturn {
  const player = usePlayerStore();

  const lines = ref<LyricLine[]>([]);
  const activeLineIndex = ref<number>(-1);
  const loading = ref<boolean>(false);
  const error = ref<string>("");
  const currentSongId = ref<number | null>(null);

  const hasLyric = computed(() => lines.value.length > 0);

  /** 拉取并解析歌词 */
  async function loadFor(songId: number) {
    if (songId === currentSongId.value) return;
    currentSongId.value = songId;
    lines.value = [];
    activeLineIndex.value = -1;
    error.value = "";
    loading.value = true;
    try {
      const res = await getLyric(songId);
      // 优先使用翻译 LRC（如果存在）；否则用原文
      const raw = res.tLrc || res.lrc;
      lines.value = parseLrc(raw);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "歌词加载失败";
    } finally {
      loading.value = false;
    }
  }

  /** 监听当前歌曲变化：切歌时重新拉取 */
  watch(
    () => player.currentSong?.id ?? null,
    (id) => {
      if (id === null) {
        lines.value = [];
        activeLineIndex.value = -1;
        currentSongId.value = null;
        return;
      }
      void loadFor(id);
    },
    { immediate: true }
  );

  /**
   * 监听 playerStore.audioState.currentTime（它本身已是 reactive，
   * 由 useAudioPlayer 的 timeupdate 事件驱动）。
   */
  watch(
    () => player.audioState.currentTime,
    (t) => {
      if (lines.value.length === 0) {
        activeLineIndex.value = -1;
        return;
      }
      // audio.currentTime 单位是秒
      const idx = findActiveLineIndex(lines.value, Math.floor(t * 1000));
      activeLineIndex.value = idx;
    }
  );

  /** 点击某行歌词 → 跳转播放 */
  function seekTo(seconds: number) {
    player.seek(seconds);
  }

  return {
    lines,
    activeLineIndex,
    loading,
    error,
    hasLyric,
    seekTo,
  };
}
