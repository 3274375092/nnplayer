/** 计算当前媒体位置落在单个 YRC token 内的已唱比例。 */
export function getKaraokeTokenProgress(
  token: { startMs: number; endMs: number },
  currentMs: number,
): number {
  if (!Number.isFinite(currentMs)) return 0;
  const span = token.endMs - token.startMs;
  if (!Number.isFinite(span) || span <= 0) {
    return currentMs >= token.endMs ? 1 : 0;
  }
  return Math.max(0, Math.min(1, (currentMs - token.startMs) / span));
}

export interface AlignableLyricLine {
  time: number;
  text: string;
}

export interface LyricTimelineAlignment {
  /** 每条 YRC 行对应的 LRC 下标；null 表示没有可信匹配。 */
  lrcIndexByYrc: Array<number | null>;
  /** 补回缺失 LRC 行时应应用的时间偏移。 */
  fallbackOffsetMs: number;
  /** false 表示仅靠译文时间无法唯一确定配对，应保守放弃翻译映射。 */
  reliable: boolean;
}

export interface LyricTimelineAlignmentOptions {
  /** LRC 文本实际是翻译，不能与 YRC 原文做文本比较。 */
  lrcTextIsTranslation?: boolean;
}

export function normalizeLyricMatchText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

export function areLyricTextsEquivalent(left: string, right: string): boolean {
  const normalized = normalizeLyricMatchText(left);
  return normalized.length > 0 && normalized === normalizeLyricMatchText(right);
}

function lowerBoundTimes(lines: readonly AlignableLyricLine[], time: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function stableMedian(samples: number[], minimumSamples: number): number {
  if (samples.length < minimumSamples) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const inliers = sorted.filter((value) => Math.abs(value - median) <= 500);
  if (
    inliers.length < minimumSamples ||
    inliers.length / sorted.length < 0.6
  ) {
    return 0;
  }
  return inliers[Math.floor(inliers.length / 2)];
}

function scoreTimelineOffset(
  yrcLines: AlignableLyricLine[],
  lrcLines: AlignableLyricLine[],
  offsetMs: number,
): { count: number; error: number } {
  let yrcIndex = 0;
  let lrcIndex = 0;
  let count = 0;
  let error = 0;
  while (yrcIndex < yrcLines.length && lrcIndex < lrcLines.length) {
    const adjustedLrcTime = lrcLines[lrcIndex].time + offsetMs;
    const delta = yrcLines[yrcIndex].time - adjustedLrcTime;
    if (Math.abs(delta) <= 300) {
      count += 1;
      error += Math.abs(delta);
      yrcIndex += 1;
      lrcIndex += 1;
    } else if (adjustedLrcTime < yrcLines[yrcIndex].time) {
      lrcIndex += 1;
    } else {
      yrcIndex += 1;
    }
  }
  return { count, error };
}

/** 无法比较原文/译文时，用时间差聚类寻找允许缺行的单调全局偏移。 */
function estimateTimelineOffset(
  yrcLines: AlignableLyricLine[],
  lrcLines: AlignableLyricLine[],
): { offsetMs: number; reliable: boolean } {
  if (yrcLines.length === 1 && lrcLines.length === 1) {
    const difference = yrcLines[0].time - lrcLines[0].time;
    const reliable = Number.isFinite(difference) && Math.abs(difference) <= 300;
    return { offsetMs: reliable ? difference : 0, reliable };
  }

  const bins = new Map<number, number[]>();
  for (const yrc of yrcLines) {
    const start = lowerBoundTimes(lrcLines, yrc.time - 10_000);
    const end = lowerBoundTimes(lrcLines, yrc.time + 10_000);
    for (let index = start; index < end; index += 1) {
      const lrc = lrcLines[index];
      const difference = yrc.time - lrc.time;
      const bin = Math.round(difference / 100);
      const values = bins.get(bin) ?? [];
      values.push(difference);
      bins.set(bin, values);
    }
  }

  let bestOffset = 0;
  let bestCount = 0;
  let bestError = Number.POSITIVE_INFINITY;
  let ambiguous = false;
  for (const values of bins.values()) {
    values.sort((a, b) => a - b);
    const candidate = values[Math.floor(values.length / 2)];
    const score = scoreTimelineOffset(yrcLines, lrcLines, candidate);
    if (
      score.count > bestCount ||
      (score.count === bestCount && score.error < bestError)
    ) {
      bestOffset = candidate;
      bestCount = score.count;
      bestError = score.error;
      ambiguous = false;
    } else if (
      score.count === bestCount &&
      score.error === bestError &&
      Math.abs(candidate - bestOffset) > 300
    ) {
      ambiguous = true;
    }
  }

  const requiredMatches = Math.max(
    2,
    Math.ceil(Math.min(yrcLines.length, lrcLines.length) * 0.5),
  );
  const reliable = bestCount >= requiredMatches && !ambiguous;
  return { offsetMs: reliable ? bestOffset : 0, reliable };
}

/**
 * 将 YRC 与 LRC 做单调、一对一配对。
 *
 * - 只有至少 3 个一致文本样本才能建立全局偏移，避免短句/副歌误判。
 * - 文本相同仅在时间成本接近时优先，不能跳过明显更近的当前行。
 * - 返回可信配对的中位偏移，供部分 YRC 缺行时补齐普通 LRC。
 */
export function alignLyricTimelines(
  yrcLines: AlignableLyricLine[],
  lrcLines: AlignableLyricLine[],
  options: LyricTimelineAlignmentOptions = {},
): LyricTimelineAlignment {
  const offsetSamples: number[] = [];
  const normalizedYrc = yrcLines.map((line) => normalizeLyricMatchText(line.text));
  const normalizedLrc = lrcLines.map((line) => normalizeLyricMatchText(line.text));
  const lrcIndexesByText = new Map<string, number[]>();
  normalizedLrc.forEach((text, index) => {
    if (!text) return;
    const indexes = lrcIndexesByText.get(text) ?? [];
    indexes.push(index);
    lrcIndexesByText.set(text, indexes);
  });

  if (!options.lrcTextIsTranslation) {
    for (let yrcIndex = 0; yrcIndex < yrcLines.length; yrcIndex += 1) {
      const yrc = yrcLines[yrcIndex];
      const normalizedText = normalizedYrc[yrcIndex];
      if (!normalizedText) continue;
      let bestDistance = 10_001;
      let bestOffset: number | null = null;
      for (const lrcIndex of lrcIndexesByText.get(normalizedText) ?? []) {
        const lrc = lrcLines[lrcIndex];
        const offset = yrc.time - lrc.time;
        const distance = Math.abs(offset);
        if (distance <= 10_000 && distance < bestDistance) {
          bestDistance = distance;
          bestOffset = offset;
        }
      }
      if (bestOffset !== null) offsetSamples.push(bestOffset);
    }
  }
  // 单个短句不足以证明全局偏移；两个一致样本可覆盖短歌。
  const timelineEstimate = options.lrcTextIsTranslation
    ? estimateTimelineOffset(yrcLines, lrcLines)
    : null;
  const sourceOffset = timelineEstimate
    ? timelineEstimate.offsetMs
    : stableMedian(offsetSamples, 2);
  if (timelineEstimate && !timelineEstimate.reliable) {
    return {
      lrcIndexByYrc: yrcLines.map(() => null),
      fallbackOffsetMs: 0,
      reliable: false,
    };
  }

  const matches: Array<number | null> = [];
  const matchedOffsets: number[] = [];
  let lastMatchedLrcIndex = -1;

  for (let yrcIndex = 0; yrcIndex < yrcLines.length; yrcIndex += 1) {
    const yrc = yrcLines[yrcIndex];
    const normalizedText = normalizedYrc[yrcIndex];
    let exactIndex = -1;
    let exactDistance = Number.POSITIVE_INFINITY;
    let nearestIndex = -1;
    let nearestDistance = 2501;

    const firstCandidate = Math.max(
      lastMatchedLrcIndex + 1,
      lowerBoundTimes(lrcLines, yrc.time - sourceOffset - 2500),
    );
    const lastCandidate = Math.min(
      lrcLines.length,
      lowerBoundTimes(lrcLines, yrc.time - sourceOffset + 2500),
    );
    for (let i = firstCandidate; i < lastCandidate; i += 1) {
      const lrc = lrcLines[i];
      const adjustedTime = Math.max(0, lrc.time + sourceOffset);
      const distance = Math.abs(adjustedTime - yrc.time);
      if (
        !options.lrcTextIsTranslation &&
        normalizedText.length > 0 &&
        normalizedLrc[i] === normalizedText &&
        distance <= 2500 &&
        distance < exactDistance
      ) {
        exactIndex = i;
        exactDistance = distance;
      }
      if (distance <= 2500 && distance < nearestDistance) {
        nearestIndex = i;
        nearestDistance = distance;
      }
    }

    const exactIsCompetitive = exactIndex >= 0 &&
      (nearestIndex < 0 || exactDistance <= nearestDistance + 250);
    const matchedIndex = exactIsCompetitive ? exactIndex : nearestIndex;
    if (matchedIndex < 0) {
      matches.push(null);
      continue;
    }
    matches.push(matchedIndex);
    lastMatchedLrcIndex = matchedIndex;
    matchedOffsets.push(yrc.time - lrcLines[matchedIndex].time);
  }

  return {
    lrcIndexByYrc: matches,
    fallbackOffsetMs: matchedOffsets.length > 0
      ? stableMedian(matchedOffsets, 1)
      : sourceOffset,
    reliable: true,
  };
}
