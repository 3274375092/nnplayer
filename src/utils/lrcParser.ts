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
  /** 翻译文本（若有，按时间戳与原文配对） */
  translation?: string;
}

function readLrcOffset(lrc: string | null | undefined): number {
  if (!lrc) return 0;
  let offsetMs = 0;
  const offsetRe = /^\s*\[\s*offset\s*:\s*([+-]?\d+)\s*\]\s*$/i;
  for (const rawLine of lrc.split(/\r\n?|\n/)) {
    const match = offsetRe.exec(rawLine);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isSafeInteger(value)) offsetMs = value;
  }
  return offsetMs;
}

/**
 * 解析 LRC 字符串。
 * - 容忍空字符串
 * - 跳过元数据行（无时间戳）
 * - 跳过空文本
 * - 同一文本多时间戳会展开为多条
 * - 末尾按时间升序
 */
/**
 * 解析 LRC 并返回**未经截断**的时间戳（内部使用）。
 *
 * `parseLrc` 会把负时间钳到 0（播放器要求非负）。配对翻译时必须使用原始
 * 坐标：`[offset:-3000]` 时前置歌词行会被钳成 0，若在钳过的值上再补偏移，
 * 这些行会全部塌缩到同一时间点。
 */
function parseLrcEntries(
  lrc: string | null | undefined,
): { time: number; text: string }[] {
  if (!lrc) return [];
  const out: { time: number; text: string }[] = [];
  const rawLines = lrc.split(/\r\n?|\n/);

  // offset 是整份 LRC 的全局元数据，可能出现在任意歌词行之前或之后。
  // 先完整扫描再解析时间戳，避免只影响 offset 标签之后的歌词。
  // 多个合法 offset 标签时采用最后一个，和常见播放器的覆盖语义一致。
  const offsetMs = readLrcOffset(lrc);

  for (const rawLine of rawLines) {
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
      out.push({ time: t + offsetMs, text });
    }
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

/** 把原始毫秒钳到播放器可用的非负安全整数范围。 */
function clampLyricTime(time: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, time));
}

export function parseLrc(lrc: string | null | undefined): LyricLine[] {
  // 钳位是单调的，因此先排序再钳位与逐条钳位再排序结果一致。
  return parseLrcEntries(lrc).map((entry) => ({
    time: clampLyricTime(entry.time),
    text: entry.text,
  }));
}

/**
 * 解析原文 LRC 并按时间戳配对翻译 LRC。
 *
 * NCM 的 tLrc 也是标准 LRC，时间戳与 lrc 一一对应；但偶有微小差异
 *（如原文 [00:01.23]、翻译 [00:01.24]），故用 ±50ms 容忍带匹配。
 * 配对失败（找不到对应时间戳）的原文行 translation 留空。
 *
 * - lrc 为空 → 返回 []
 * - tLrc 为空 → 等价于 parseLrc（无 translation）
 */
export function parseLrcWithTranslation(
  lrc: string | null | undefined,
  tLrc: string | null | undefined,
): LyricLine[] {
  const lines = parseLrc(lrc);
  if (lines.length === 0 || !tLrc) return lines;

  // 翻译表：时间戳 → 文本（取首个，重复时间戳取最后一条覆盖）
  const sourceOffset = readLrcOffset(lrc);
  const translationOffset = readLrcOffset(tLrc);
  const translationShift = sourceOffset - translationOffset;
  // 必须用未截断的原始时间做平移：parseLrc 的 clamp 会让负 offset 下的
  // 早期翻译行全部落到 0，从而共享同一条（错误的）翻译。
  const tLines = parseLrcEntries(tLrc).map((entry) => ({
    time: clampLyricTime(entry.time + translationShift),
    text: entry.text,
  }));
  const tMap = new Map<number, string>();
  for (const t of tLines) {
    tMap.set(t.time, t.text);
  }

  const TOLERANCE_MS = 50;
  // 翻译时间戳有序，可用二分就近查找
  const tTimes = tLines.map((t) => t.time);

  function findTranslation(time: number): string | undefined {
    // 精确命中
    const exact = tMap.get(time);
    if (exact) return exact;
    if (tTimes.length === 0) return undefined;
    // 二分找最近的时间戳
    let lo = 0;
    let hi = tTimes.length - 1;
    let best = -1;
    let bestDist = TOLERANCE_MS + 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = Math.abs(tTimes[mid] - time);
      if (d < bestDist) {
        bestDist = d;
        best = mid;
      }
      if (tTimes[mid] < time) {
        lo = mid + 1;
      } else if (tTimes[mid] > time) {
        hi = mid - 1;
      } else {
        break;
      }
    }
    if (best < 0 || bestDist > TOLERANCE_MS) return undefined;
    return tMap.get(tTimes[best]);
  }

  for (const line of lines) {
    const tr = findTranslation(line.time);
    if (tr) line.translation = tr;
  }
  return lines;
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

type GraphemeSegmenterLike = {
  segment(input: string): Iterable<{ segment: string }>;
};
type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" },
) => GraphemeSegmenterLike;

const GraphemeSegmenter = (
  Intl as typeof Intl & { Segmenter?: GraphemeSegmenterConstructor }
).Segmenter;
/** Segmenter 构造一次复用：逐条 word tag 都 new 一个实例会多花约 55–64% 的
 *  解析时间（实测 200 行 YRC：21.9ms → 9ms 量级）；输出与逐次构造一致。 */
let graphemeSegmenter: GraphemeSegmenterLike | null = null;

/**
 * 快速路径白名单：白名单里的码点都不会与前/后码点组成更长的字素簇，因此逐码点
 * 切分与 Intl.Segmenter 完全等价。绝大多数码点的 Grapheme_Cluster_Break 是
 * Other；两个例外也能单码点独立成簇：U+00AD 软连字符（Cf，按 Control 处理）、
 * 预组合谚文音节 U+AC00–D7A3（GCB = LV/LVT，只有后接谚文 V/T 字母时才会合并，
 * 而 L/V/T 字母不在白名单里）。
 *   - ASCII 可打印字符；
 *   - 预组合拉丁字母、希腊/西里尔字母（组合附加符在 0300–036F/0483–0489，不在内）；
 *   - 中文/日文/韩文标点、平假名/片假名基本字、全角与半角片假名；
 *   - CJK 统一表意文字（含兼容区）与预组合谚文音节。
 * 白名单外的一律交给 Intl.Segmenter：组合附加符、emoji/ZWJ、区域旗帜、肤色
 * 修饰符、组合假名浊音点、谚文字母（L/V/T 可组合）、泰文 SARA AM、格式字符等
 * 都可能与前/后码点合成一个字素簇，不能按码点切。
 *
 * 中文歌词的 YRC 几乎逐字一个标签，命中率接近 100%；Intl.Segmenter 每次
 * segment() 都有固定开销（实测 ~1 µs/词），是解析的主成本，快速路径把它降到
 * 一次正则 + Array.from。基线见 `pnpm perf:lyrics`（tools/lyric-performance.mjs）。
 */
const SIMPLE_GRAPHEME_TEXT =
  /^[\u0020-\u007E\u00A1-\u024F\u0370-\u03FF\u0400-\u0482\u048A-\u04FF\u2010-\u2015\u2018-\u201D\u2026\u2030-\u203A\u3000-\u3029\u3030-\u303F\u3041-\u3096\u30A1-\u30FA\uFF01-\uFF60\uFF66-\uFF9D\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\uAC00-\uD7A3]+$/u;

function splitGraphemes(text: string): string[] {
  if (SIMPLE_GRAPHEME_TEXT.test(text)) {
    // 单码点（中文逐字标签最常见）直接返回单元素数组，跳过 Array.from 迭代。
    return text.length <= 1 ? [text] : Array.from(text);
  }
  if (!GraphemeSegmenter) return Array.from(text);
  graphemeSegmenter ??= new GraphemeSegmenter(undefined, {
    granularity: "grapheme",
  });
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

/**
 * 返回 YRC 行的可见文本。
 *
 * 只移除整行首尾的空白，保留歌词内部空格。它和
 * {@link getYrcLineStartMs} 使用相同的“可见字符”判定，避免显示文本已经去掉
 * 前导空格、行起点却仍落在空格时间上的偏差。
 */
export function getYrcLineText(line: YrcLine): string {
  return line.words.map((word) => word.char).join("").trim();
}

/**
 * 返回 YRC 行第一个实际可见字符/词的绝对毫秒时间。
 *
 * 无可见字符时回退到第一个有效字时间，再回退到行级时间；外部构造的不合法
 * 数据也不会令结果变成 NaN 或负数。
 */
export function getYrcLineStartMs(line: YrcLine): number {
  const isValidMs = (value: number) => Number.isFinite(value) && value >= 0;
  const firstVisible = line.words.find(
    (word) => word.char.trim().length > 0 && isValidMs(word.startMs),
  );
  if (firstVisible) return firstVisible.startMs;

  const firstTimed = line.words.find((word) => isValidMs(word.startMs));
  if (firstTimed) return firstTimed.startMs;
  return isValidMs(line.time) ? line.time : 0;
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

  // 按物理行解析，避免一条损坏的标签吞掉后续歌词。允许数字周围出现空格，
  // 同时保留 ] 后的歌词内容（包括有意义的空格）。
  const lineRe = /^\s*\[\s*(\d+)\s*,\s*(\d+)\s*\](.*)$/;
  for (const rawLine of yrcText.split(/\r\n?|\n/)) {
    // 只在真的带 BOM 时才 slice，避免给每一行都分配一个新字符串。
    const line = rawLine.charCodeAt(0) === 0xfeff ? rawLine.slice(1) : rawLine;
    const lineMatch = lineRe.exec(line);
    if (!lineMatch) continue;

    const lineStart = Number(lineMatch[1]);
    const lineDuration = Number(lineMatch[2]);
    const content = lineMatch[3];
    if (
      !Number.isSafeInteger(lineStart) ||
      !Number.isSafeInteger(lineDuration) ||
      !content
    ) {
      continue;
    }

    // YRC 字标签为 (absoluteStart,duration,volume)。只把合法时间标签当边界，
    // 因此歌词文本中的普通括号不会截断字符。第三项不参与时间计算，但允许
    // 常见的正负数和小数写法。
    const wordTagRe =
      /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*[+-]?\d+(?:\.\d+)?\s*\)/g;
    const wordTags: {
      startMs: number;
      duration: number;
      tagIndex: number;
      textIndex: number;
    }[] = [];
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordTagRe.exec(content)) !== null) {
      const startMs = Number(wordMatch[1]);
      const duration = Number(wordMatch[2]);
      if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(duration)) {
        continue;
      }
      wordTags.push({
        startMs,
        duration,
        tagIndex: wordMatch.index,
        textIndex: wordTagRe.lastIndex,
      });
    }

    const words: YrcWord[] = [];
    // 字标签通常已按时间升序（YRC 生成器保证）；只有真正乱序时才在行尾排序，
    // 避免对每行都做一次 O(k log k) 排序（中文逐字歌词 k 常为 20–40）。
    let sorted = true;
    let previousStartMs = Number.NEGATIVE_INFINITY;
    for (let tagIndex = 0; tagIndex < wordTags.length; tagIndex += 1) {
      const tag = wordTags[tagIndex];
      const nextTag = wordTags[tagIndex + 1];
      const text = content.slice(
        tag.textIndex,
        nextTag?.tagIndex ?? content.length,
      );
      if (!text) continue;

      // 按可见字素切分，避免组合音标或 ZWJ emoji 被拆成多个错误 token。
      const chars = splitGraphemes(text);
      let visibleCount = 0;
      for (let index = 0; index < chars.length; index += 1) {
        if (chars[index].trim().length > 0) visibleCount += 1;
      }
      const perCharDuration = visibleCount > 0 ? tag.duration / visibleCount : 0;
      let visibleIndex = 0;
      for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        const isWhitespace = char.trim().length === 0;
        const startMs = tag.startMs + visibleIndex * perCharDuration;
        if (startMs < previousStartMs) sorted = false;
        previousStartMs = startMs;
        words.push({
          char,
          // 字标签起点本身就是歌曲内绝对毫秒，不能再叠加 lineStart。
          startMs,
          // 分隔空格保留显示宽度，但不吞掉真实字符的演唱时长。
          duration: isWhitespace ? 0 : perCharDuration,
        });
        if (!isWhitespace) visibleIndex += 1;
      }
      // 如果标签包含多字符（如英文词），在词内均分 duration
      // 这样每个字符都有递增的时间戳，而非全部挤在同一时刻
    }

    if (words.length === 0) continue;
    // 损坏或非规范来源偶尔会把字标签乱序；渲染层需要时间单调递增。
    if (!sorted) words.sort((a, b) => a.startMs - b.startMs);
    lines.push({ time: lineStart, duration: lineDuration, words });
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}
