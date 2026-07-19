// 主题色 Pinia Store。
// 职责：管理"封面驱动主题色"的状态——当前调色板、是否正在应用。
//
// 设计要点：
// 1. watch currentSong 由 player store 触发，这里只暴露 applyFromCover/resetToDefault
// 2. debounce 200ms：切歌快连时，旧任务直接被 clearTimeout 取消，避免卡顿
// 3. 不阻塞播放链路：try/catch + console.warn，最新封面失败时恢复默认主题

import { defineStore } from "pinia";
import { ref } from "vue";

import {
  applyToCssVars,
  extractPalette,
  resetCssVars,
} from "@/utils/colorExtractor";
import {
  DEFAULT_DESKTOP_ACCENT,
  DEFAULT_THEME_SEED,
} from "@/utils/themeTokens";

export const useThemeStore = defineStore("theme", () => {
  /** 当前调色板（debug 用，暂不消费） */
  const palette = ref<string[]>([]);
  /** 当前 seed（hex） */
  const seed = ref<string>(DEFAULT_THEME_SEED);
  /** 主界面在浅色表面上使用的可读强调色 */
  const uiAccent = ref<string>(DEFAULT_THEME_SEED);
  /** 透明桌面歌词窗口使用的高明度强调色 */
  const desktopAccent = ref<string>(DEFAULT_DESKTOP_ACCENT);
  /** 是否正在提取/应用（防重入） */
  const applying = ref<boolean>(false);

  // debounce 句柄：清旧任务
  let pending: ReturnType<typeof setTimeout> | null = null;
  let applySeq = 0;

  /** 切歌时调用：debounce 200ms 后从封面提取并应用主题色 */
  function applyFromCover(imgUrl: string) {
    const seq = ++applySeq;
    if (pending) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => {
      pending = null;
      void doApply(imgUrl, seq);
    }, 200);
  }

  async function doApply(imgUrl: string, seq: number) {
    applying.value = true;
    try {
      const result = await extractPalette(imgUrl);
      if (seq !== applySeq) return;
      const derived = applyToCssVars(result.palette);
      seed.value = result.seed;
      palette.value = result.palette;
      uiAccent.value = derived.uiAccent;
      desktopAccent.value = derived.desktopAccent;
    } catch (e) {
      if (seq !== applySeq) return;
      // 当前封面失败时回到默认主题，不能让新歌曲沿用上一首颜色。
      palette.value = [];
      seed.value = DEFAULT_THEME_SEED;
      uiAccent.value = DEFAULT_THEME_SEED;
      desktopAccent.value = DEFAULT_DESKTOP_ACCENT;
      resetCssVars();
      // eslint-disable-next-line no-console
      console.warn("[theme] 主题色提取失败，已恢复 Gruvbox Light", e);
    } finally {
      if (seq === applySeq) applying.value = false;
    }
  }

  /** 清除动态 CSS 变量，回到 :root 的 Gruvbox Light。 */
  function resetToDefault() {
    applySeq += 1;
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    palette.value = [];
    seed.value = DEFAULT_THEME_SEED;
    uiAccent.value = DEFAULT_THEME_SEED;
    desktopAccent.value = DEFAULT_DESKTOP_ACCENT;
    applying.value = false;
    resetCssVars();
  }

  return {
    palette,
    seed,
    uiAccent,
    desktopAccent,
    applying,
    applyFromCover,
    resetToDefault,
  };
});
