// 歌词 composable：
//   1. 拉取并解析当前歌曲歌词
//   2. 监听 audio currentTime，计算当前高亮行 activeLineIndex
//   3. 阶段3：暴露 karaokeTokens（当前行字符级时间窗）和 progressMs（行内毫秒进度）
//   4. 阶段3：向桌面歌词窗口 emit 'desktop-lyrics:update'
//
// 设计原则：
//   - useAudioPlayer 内部已存在唯一的 <audio> 元素（由 player store 持有），
//     useLyric 只通过 playerStore.audioState 读取 currentTime，不再创建 audio。
//   - 切歌时自动重置并重新拉取。
//   - 桌面歌词事件 emit 失败时静默（不影响主流程）。

import {
  computed,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { emit } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getLyric } from "@/composables/useNcmApi";
import {
  findActiveLineIndex,
  parseKaraokeLine,
  parseLrc,
  type LyricLine,
} from "@/utils/lrcParser";
import { usePlayerStore } from "@/stores/player";

export interface UseLyricReturn {
  /** 解析后的歌词行 */
  lines: Ref<LyricLine[]>;
  /** 当前高亮行索引（-1 表示无） */
  activeLineIndex: Ref<number>;
  /** 当前行内卡拉OK 字符级时间窗（伪） */
  karaokeTokens: ComputedRef<
    { char: string; startMs: number; endMs: number }[]
  >;
  /** 当前行内毫秒进度（用于卡拉OK 颜色切换） */
  progressMs: Ref<number>;
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
  const progressMs = ref<number>(0);
  const loading = ref<boolean>(false);
  const error = ref<string>("");
  const currentSongId = ref<number | null>(null);

  const hasLyric = computed(() => lines.value.length > 0);

  /**
   * 当前行的卡拉OK 字符时间窗。
   * 时间窗 = [上一行结束时间, 下一行开始时间]，按字符数等分。
   */
  const karaokeTokens = computed(() => {
    const idx = activeLineIndex.value;
    if (idx < 0 || idx >= lines.value.length) return [];
    const cur = lines.value[idx];
    const prev = idx > 0 ? lines.value[idx - 1] : null;
    const next = idx + 1 < lines.value.length ? lines.value[idx + 1] : null;
    const prevMs = prev ? prev.time : -1;
    const nextMs = next ? next.time : -1;
    return parseKaraokeLine(cur.text, prevMs, nextMs);
  });

  /** 拉取并解析歌词 */
  async function loadFor(songId: number) {
    if (songId === currentSongId.value) return;
    currentSongId.value = songId;
    lines.value = [];
    activeLineIndex.value = -1;
    progressMs.value = 0;
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
        progressMs.value = 0;
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
   * 同时计算行内毫秒进度（用于卡拉OK）。
   */
  watch(
    () => player.audioState.currentTime,
    (t) => {
      if (lines.value.length === 0) {
        activeLineIndex.value = -1;
        progressMs.value = 0;
        return;
      }
      // audio.currentTime 单位是秒
      const currentMs = t * 1000;
      const idx = findActiveLineIndex(lines.value, Math.floor(currentMs));
      activeLineIndex.value = idx;
      // 行内进度
      if (idx >= 0) {
        const lineTime = lines.value[idx].time;
        const next = lines.value[idx + 1];
        const nextTime = next ? next.time : lineTime + 5000;
        progressMs.value = Math.max(
          0,
          Math.min(nextTime - lineTime, currentMs - lineTime),
        );
      } else {
        progressMs.value = 0;
      }
    }
  );

  /**
   * 阶段3：向桌面歌词窗口推送更新。
   * 仅在 Tauri 环境下 emit；失败时静默（不影响主流程）。
   */
  watch(
    [() => player.currentSong?.id, activeLineIndex, progressMs, lines],
    () => {
      if (!isTauri()) return;
      const idx = activeLineIndex.value;
      const current = idx >= 0 && idx < lines.value.length
        ? lines.value[idx].text
        : "";
      const next = idx + 1 < lines.value.length
        ? lines.value[idx + 1].text
        : "";
      const lineTime = idx >= 0 ? lines.value[idx].time : 0;
      const nextTime = idx + 1 < lines.value.length
        ? lines.value[idx + 1].time
        : lineTime + 5000;
      const span = Math.max(1, nextTime - lineTime);
      const progress = idx >= 0
        ? Math.max(0, Math.min(1, progressMs.value / span))
        : 0;
      void emit("desktop-lyrics:update", {
        current,
        next,
        progress,
        songName: player.currentSong?.name ?? "",
        artists: player.currentSong?.artists ?? "",
      }).catch(() => {
        /* 桌面窗未打开时 emit 静默失败 */
      });
    },
  );

  /** 点击某行歌词 → 跳转播放 */
  function seekTo(seconds: number) {
    player.seek(seconds);
  }

  return {
    lines,
    activeLineIndex,
    karaokeTokens,
    progressMs,
    loading,
    error,
    hasLyric,
    seekTo,
  };
}
