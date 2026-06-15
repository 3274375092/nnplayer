// LRC 歌词解析器。
//
// LRC 格式示例：
//   [00:01.23]歌词文本
//   [00:04.50]下一句
//   [00:04.50][01:12.00]同一时间点多个时间戳（多时间标签）
//   [ar:艺人]    元数据行（无时间戳，跳过）
//
// 输出：按时间排序的 LyricLine 数组。
// 同时产出 Map<timeMs, line> 便于 O(1) 二分定位（实际用 upper_bound）。

export interface LyricLine {
  /** 时间（毫秒） */
  time: number;
  /** 文本（已 trim） */
  text: string;
}

/**
 * 解析 LRC 字符串。
 * - 容忍空字符串
 * - 跳过元数据行（无时间戳）
 * - 跳过空文本
 * - 同一文本多时间戳会展开为多条
 * - 末尾按时间升序
 */
export function parseLrc(lrc: string | null | undefined): LyricLine[] {
  if (!lrc) return [];
  const out: LyricLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 匹配所有 [mm:ss(.ms)?] 标签
    const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const tags: number[] = [];
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = tagRe.exec(line)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const ms = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) : 0;
      tags.push(min * 60_000 + sec * 1000 + ms);
      lastIndex = tagRe.lastIndex;
    }

    if (tags.length === 0) {
      // 元数据行（[ar:xxx] 等），跳过
      continue;
    }

    const text = line.slice(lastIndex).trim();
    if (!text) continue;

    for (const t of tags) {
      out.push({ time: t, text });
    }
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * 根据当前播放时间（秒），二分定位到当前应该高亮的行索引。
 * 规则：返回最后一条 time <= currentMs 的索引；若无则返回 -1。
 */
export function findActiveLineIndex(lines: LyricLine[], currentMs: number): number {
  if (lines.length === 0) return -1;
  if (currentMs < lines[0].time) return -1;

  // 二分：找第一个 time > currentMs 的位置，然后 -1
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= currentMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
