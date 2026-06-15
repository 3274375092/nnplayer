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

// =============== 阶段 3：卡拉OK 字符级时间窗 ===============
// YRC 逐字歌词支持。

/**
 * YRC 字级时间条目（精确逐字时间戳）。
 */
export interface YrcWord {
  /** 字符文本 */
  char: string;
  /** 起始时间（毫秒），绝对时间戳 */
  startMs: number;
  /** 持续时长（毫秒） */
  duration: number;
}

/**
 * YRC 行级数据（包含字级时间戳）。
 */
export interface YrcLine {
  /** 行起始时间（毫秒） */
  time: number;
  /** 本行持续时长（毫秒） */
  duration: number;
  /** 逐字条目 */
  words: YrcWord[];
}

/**
 * 解析 NCM YRC 逐字歌词。
 *
 * YRC 格式（网易云 yrc）：
 *   [行偏移ms,行持续时长ms](字偏移ms,字持续ms,音量)字(字偏移ms,字持续ms,音量)字...
 *
 *   示例：
 *   [50000,3000](50000,400,0)你(50400,350,0)好(50750,250,0)世(51000,600,0)界
 *
 * 其中字偏移是**绝对时间戳**（毫秒），不是相对行偏移。
 *
 * @param yrcText 原始 YRC 字符串
 * @returns 解析后的 YRC 行数组
 */
export function parseYrc(yrcText: string | null | undefined): YrcLine[] {
  if (!yrcText) return [];
  const lines: YrcLine[] = [];

  // 匹配行级： [offset,duration]content
  const lineRe = /\[(\d+),(\d+)](.*?)(?:\r?\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(yrcText)) !== null) {
    const lineStart = Number(m[1]);
    const lineDuration = Number(m[2]);
    const content = m[3];
    if (!content) continue;

    // 匹配字级：(offset,dur,vol)文本
    // 文本用 [^(]（非 ( 字符）匹配，因为 YRC 每个标签对应一个字
    const words: YrcWord[] = [];
    const wordRe = /\((\d+),(\d+),\d+\)([^(]+)/g;
    let wm: RegExpExecArray | null;
    while ((wm = wordRe.exec(content)) !== null) {
      const offset = Number(wm[1]);
      const dur = Number(wm[2]);
      const text = wm[3];
      if (!text) continue;

      for (const ch of Array.from(text)) {
        words.push({ char: ch, startMs: offset, duration: dur });
      }
      // 如果标签包含多字符（如英文词），在词内均分 duration
      // 这样每个字符都有递增的时间戳，而非全部挤在同一时刻
    }

    if (words.length === 0) continue;
    lines.push({ time: lineStart, duration: lineDuration, words });
  }

  return lines;
}

/**
 * 从 YRC 行数据生成 [startMs, endMs] 格式的 CharToken[]。
 * 用于替换原先的伪卡拉OK 等分时间窗。
 *
 * @param words YRC 逐字条目
 * @returns 兼容 CharToken 格式的数组
 */
export function yrcWordsToCharTokens(
  words: YrcWord[],
): CharToken[] {
  return words.map((w) => ({
    char: w.char,
    startMs: w.startMs,
    endMs: w.startMs + w.duration,
  }));
}

/**
 * 卡拉OK 字符级时间标签。
 * 按字符数等分 [prevMs, nextMs] 时间窗（伪卡拉OK，NCM LRC 无逐字时间戳）。
 */
export interface CharToken {
  char: string;
  startMs: number;
  endMs: number;
}

/**
 * 把一行歌词按字符数等分为 CharToken[]。
 * - prevMs / nextMs：上一行结束 / 下一行开始（毫秒）
 * - prevMs < 0 时退化为 nextMs - 5000
 * - nextMs <= prevMs 时退化为 prevMs + 5000
 * - 空文本返回 []
 * - 字符可以是汉字、英文、标点、空格（空格保留可见宽度，不去掉）
 */
export function parseKaraokeLine(
  text: string,
  prevMs: number,
  nextMs: number,
): CharToken[] {
  if (!text) return [];
  // 退化窗口：边界缺失时给一个合理长度
  let start = prevMs >= 0 ? prevMs : nextMs - 5000;
  let end = nextMs > start ? nextMs : start + 5000;
  if (end <= start) end = start + 1000;
  const chars = Array.from(text); // 按 code point 切，避免 surrogate pair 错位
  if (chars.length === 0) return [];
  const span = end - start;
  const per = span / chars.length;
  return chars.map((c, i) => ({
    char: c,
    startMs: start + i * per,
    endMs: start + (i + 1) * per,
  }));
}
