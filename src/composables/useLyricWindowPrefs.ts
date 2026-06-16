// 桌面歌词窗口本地偏好 composable。
//
// 持久化键：nnplayer.lyricWindow.prefs
// 注意：只从子窗自己读写，主窗不订阅。
// 主窗设置面板若修改偏好，通过 'desktop-lyrics:apply-prefs' 事件广播给子窗。

import { ref, watch } from "vue";

export interface LyricWindowPrefs {
  /** 当前行字号（px），14 ~ 48 */
  fontSize: number;
  /** 整窗不透明度，0.2 ~ 1.0 */
  opacity: number;
  /** 文字颜色 */
  textColor: string;
  /** 锁定后不可拖动 */
  locked: boolean;
  /** 是否显示上下两行 */
  showPrevNext: boolean;
}

const STORAGE_KEY = "nnplayer.lyricWindow.prefs";
const DEFAULTS: LyricWindowPrefs = {
  fontSize: 32,
  opacity: 0.95,
  textColor: "rgba(255,255,255,0.95)",
  locked: false,
  showPrevNext: true,
};

function load(): LyricWindowPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(prefs: LyricWindowPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota exceeded 等静默 */
  }
}

export function useLyricWindowPrefs() {
  const prefs = ref<LyricWindowPrefs>(load());

  // 修改后自动持久化
  watch(
    prefs,
    (v) => {
      save(v);
    },
    { deep: true },
  );

  function reset() {
    prefs.value = { ...DEFAULTS };
  }

  return { prefs, reset };
}
