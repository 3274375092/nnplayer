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
const PREFS_SCHEMA_VERSION = 2;
const DEFAULTS: LyricWindowPrefs = {
  fontSize: 32,
  opacity: 0.95,
  textColor: "rgba(255,255,255,0.95)",
  locked: false,
  showPrevNext: false,
};

function normalize(value: unknown, base: LyricWindowPrefs = DEFAULTS): LyricWindowPrefs {
  const input = value && typeof value === "object"
    ? value as Partial<Record<keyof LyricWindowPrefs, unknown>>
    : {};
  const fontSize = typeof input.fontSize === "number" && Number.isFinite(input.fontSize)
    ? Math.max(14, Math.min(48, input.fontSize))
    : base.fontSize;
  const opacity = typeof input.opacity === "number" && Number.isFinite(input.opacity)
    ? Math.max(0.2, Math.min(1, input.opacity))
    : base.opacity;
  const textColor = typeof input.textColor === "string" && input.textColor.trim().length > 0
    ? input.textColor
    : base.textColor;
  return {
    fontSize,
    opacity,
    textColor,
    locked: typeof input.locked === "boolean" ? input.locked : base.locked,
    showPrevNext: typeof input.showPrevNext === "boolean"
      ? input.showPrevNext
      : base.showPrevNext,
  };
}

function load(): LyricWindowPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    const next = normalize(parsed);
    const storedVersion = parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).schemaVersion
      : undefined;
    // v2 将默认桌面歌词收敛为单行。旧版没有显式开关，持久化的 true
    // 只是当时的默认值，不能视为用户主动选择。
    if (storedVersion !== PREFS_SCHEMA_VERSION) next.showPrevNext = false;
    return next;
  } catch {
    return { ...DEFAULTS };
  }
}

function save(prefs: LyricWindowPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: PREFS_SCHEMA_VERSION,
      ...prefs,
    }));
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

  function apply(next: unknown) {
    prefs.value = normalize(next, prefs.value);
  }

  return { prefs, reset, apply };
}
