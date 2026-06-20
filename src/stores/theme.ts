// 主题色 Pinia Store。
// 职责：管理"封面驱动主题色"的状态——当前调色板、是否正在应用。
//
// 设计要点：
// 1. watch currentSong 由 player store 触发，这里只暴露 applyFromCover/resetToDefault
// 2. debounce 200ms：切歌快连时，旧任务直接被 clearTimeout 取消，避免卡顿
// 3. 不阻塞播放链路：try/catch + console.warn，提取失败就保持当前色

import { defineStore } from "pinia";
import { ref } from "vue";

import {
  applyToCssVars,
  extractPalette,
  resetCssVars,
} from "@/utils/colorExtractor";

export const useThemeStore = defineStore("theme", () => {
  /** 当前调色板（debug 用，暂不消费） */
  const palette = ref<string[]>([]);
  /** 当前 seed（hex） */
  const seed = ref<string>("#E85D3A");
  /** 是否正在提取/应用（防重入） */
  const applying = ref<boolean>(false);

  // debounce 句柄：清旧任务
  let pending: ReturnType<typeof setTimeout> | null = null;

  /** 切歌时调用：debounce 200ms 后从封面提取并应用主题色 */
  function applyFromCover(imgUrl: string) {
    if (pending) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => {
      void doApply(imgUrl);
    }, 200);
  }

  async function doApply(imgUrl: string) {
    applying.value = true;
    try {
      const result = await extractPalette(imgUrl);
      seed.value = result.seed;
      palette.value = result.palette;
      applyToCssVars(result.seed);
    } catch (e) {
      // 提取失败：保持当前色，不打断 UI
      // eslint-disable-next-line no-console
      console.warn("[theme] 主题色提取失败，保持当前色", e);
    } finally {
      applying.value = false;
    }
  }

  /** 清除 CSS 变量，回到 :root 默认值（米黄） */
  function resetToDefault() {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    palette.value = [];
    seed.value = "#E85D3A";
    resetCssVars();
  }

  return {
    palette,
    seed,
    applying,
    applyFromCover,
    resetToDefault,
  };
});
