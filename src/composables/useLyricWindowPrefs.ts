// 桌面歌词窗口本地偏好 composable。
//
// 持久化键：nnplayer.lyricWindow.prefs
// 注意：只从子窗自己读写，主窗不订阅。

import { ref, watch } from "vue";

export interface LyricWindowPrefs {
  /** 当前行字号（px），14 ~ 48 */
  fontSize: number;
  /** 整窗不透明度，0.9 ~ 1.0（低于 0.9 时已唱强调色/白色阶梯无法同时维持 AA） */
  opacity: number;
  /** 锁定后不可拖动 */
  locked: boolean;
  /** 是否显示上下两行 */
  showPrevNext: boolean;
}

const STORAGE_KEY = "nnplayer.lyricWindow.prefs";
const PREFS_SCHEMA_VERSION = 2;
/**
 * 不透明度下限：整窗透明度同时淡出底板与文字，白字阶梯在 0.8 附近尚可，
 * 但已唱强调色在 0.8–0.9 只有 3.4–4.5:1。桌面歌词窗口因此把下限锁在 0.9
 * （强调色还会按当前不透明度重新推导，见 DesktopLyrics.ensureReadableAccent）；
 * 旧版本允许 0.2–1.0，载入时统一向 0.9 收敛（旧值 0.2~0.85 夹到 0.9，
 * 不丢用户其它偏好）。
 */
const MIN_LYRIC_WINDOW_OPACITY = 0.9;
const DEFAULTS: LyricWindowPrefs = {
  // 首次打开的产品口径：32px / 0.95（DESIGN.md 的桌面歌词默认值同步记录）。
  fontSize: 32,
  opacity: 0.95,
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
    ? Math.max(MIN_LYRIC_WINDOW_OPACITY, Math.min(1, input.opacity))
    : base.opacity;
  return {
    fontSize,
    opacity,
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
  } catch (e) {
    // 读取失败或内容损坏都只能用默认值，但必须留痕：用户看到的是
    // "字号/不透明度设置自己变回去了"，没有日志就无从定位。
    console.warn("[desktop-lyrics] 读取窗口偏好失败，使用默认值", e);
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

  return { prefs, reset };
}
