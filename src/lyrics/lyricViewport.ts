export const LYRIC_VIRTUAL_THRESHOLD = 160;
export const LYRIC_VIRTUAL_OVERSCAN = 16;

export interface LyricRenderRange {
  start: number;
  end: number;
}

export function getLyricRenderRange(
  count: number,
  activeIndex: number,
  threshold = LYRIC_VIRTUAL_THRESHOLD,
  overscan = LYRIC_VIRTUAL_OVERSCAN,
): LyricRenderRange {
  if (count <= threshold) return { start: 0, end: count };
  const active = activeIndex >= 0 ? Math.min(activeIndex, count - 1) : 0;
  return {
    start: Math.max(0, active - overscan),
    end: Math.min(count, active + overscan + 1),
  };
}

export function buildLyricHeightPrefix(
  count: number,
  heights: readonly number[],
  fallbackHeight: number,
): Float64Array {
  const prefix = new Float64Array(count + 1);
  for (let index = 0; index < count; index += 1) {
    prefix[index + 1] = prefix[index] + (heights[index] ?? fallbackHeight);
  }
  return prefix;
}

export function getLyricVirtualPadding(
  prefix: ArrayLike<number>,
  range: LyricRenderRange,
) {
  return {
    top: prefix[range.start] ?? 0,
    bottom: (prefix[prefix.length - 1] ?? 0) - (prefix[range.end] ?? 0),
  };
}
