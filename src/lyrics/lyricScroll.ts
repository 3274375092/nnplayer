// 歌词滚动目标的纯计算模块（从 LyricPanel 抽出，node --test 可覆盖）。
//
// 时间轴分工（ADR 0001）：卡拉 OK / active line 仍严格由权威 Playback Position
// 投影；本模块只决定「视觉滚动到哪一行」，允许提前 SCROLL_LEAD_MS，让新行在
// 擦色开始前完成滚动。把领先量与大跳阈值放在这里，调参行为才能在无 WebView
// 的 node --test 环境里被边界用例守住。

/**
 * 滚动领先量（ms）：下一行时间戳到来前多久开始把面板滚到下一行。
 * 取 200ms：普通歌曲一行 2–4s，足够完成一次 36–40px 的弹簧位移；
 * 行距极密的说唱段仍是连续追赶，不会突兀。
 */
export const SCROLL_LEAD_MS = 200;

/** 相邻行走弹簧动画的最大跨度（行）：超过则直接定位。 */
export const MAX_ANIMATED_JUMP_LINES = 2.5;

export interface LyricScrollDecisionInput {
  /** 当前权威活动行索引（Lyric Frame 的 activeLineIndex）；-1 表示尚未进入任何行 */
  activeLineIndex: number;
  /** 每行起始时间（ms，升序，与 Lyric Timeline 同源） */
  lineStartMs: readonly number[];
  /** 当前行内进度（ms），即 Lyric Frame 的 lineProgressMs */
  progressMs: number;
  /** 是否正在播放 */
  playing: boolean;
}

/**
 * 视觉滚动的目标行索引。
 *   - 正常等于 activeLineIndex；
 *   - 播放中且本行剩余时间不足 SCROLL_LEAD_MS 时提前指向下一行；
 *   - 暂停 / 最后一行 / 尚未进入任何行时不预滚。
 * 只前进一步：即使下一行也是零时长行，也不会一次跳过连续多行。
 */
export function computeScrollIndex({
  activeLineIndex,
  lineStartMs,
  progressMs,
  playing,
}: LyricScrollDecisionInput): number {
  if (activeLineIndex < 0) return activeLineIndex;
  // 暂停时不预滚：当前行保持在中心，恢复播放后恢复领先。
  if (!playing) return activeLineIndex;
  const currentStart = lineStartMs[activeLineIndex];
  const nextStart = lineStartMs[activeLineIndex + 1];
  // 最后一行（没有下一行）或时间轴缺项：不预滚。
  if (!Number.isFinite(currentStart) || !Number.isFinite(nextStart)) {
    return activeLineIndex;
  }
  const remaining = nextStart - currentStart - progressMs;
  return remaining <= SCROLL_LEAD_MS ? activeLineIndex + 1 : activeLineIndex;
}

/**
 * 「MAX_ANIMATED_JUMP_LINES 行」对应的像素大跳阈值。
 *
 * 与 targetY 同源：换行一次的实际位移是相邻两行行高的均值
 * （targetY(i+1) - targetY(i) = -(h[i] + h[i+1]) / 2），所以阈值 =
 * MAX_ANIMATED_JUMP_LINES × 目标行附近的单行位移。带翻译的行实际高约 57px，
 * 2.5 行约 142px；旧实现按 props.lineHeight 的 36px 基线算成 90px，实际只有
 * 约 1.6 行，点击两行外的歌词会意外 snap。
 *
 * heightPrefix 中未测量的行已由 buildLyricHeightPrefix 填入 fallback
 * （即 props.lineHeight），因此首帧未测量时阈值自然退化；只有前缀缺项/越界
 * （heightPrefix 尚未生成或索引超出）才显式使用 fallbackLineHeight。
 */
export function computeLyricSnapLimitPx(
  heightPrefix: ArrayLike<number>,
  lineCount: number,
  targetIndex: number,
  fallbackLineHeight: number,
): number {
  const index = Math.max(0, Math.min(targetIndex, lineCount - 1));
  const heightAt = (lineIndex: number): number => {
    const from = heightPrefix[lineIndex];
    const to = heightPrefix[lineIndex + 1];
    if (typeof from !== "number" || typeof to !== "number") {
      return fallbackLineHeight;
    }
    const height = to - from;
    return Number.isFinite(height) && height > 0 ? height : fallbackLineHeight;
  };
  // 最后一行没有下一行：单行位移退化为该行自身高度。
  const nextIndex = index + 1 < lineCount ? index + 1 : index;
  const lineStepPx = (heightAt(index) + heightAt(nextIndex)) / 2;
  return MAX_ANIMATED_JUMP_LINES * lineStepPx;
}
