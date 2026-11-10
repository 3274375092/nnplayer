// 歌词解析/对齐性能基线（`pnpm perf:lyrics`）。
//
// 直接转译并执行 src 下的真实 TS 模块，输出每行一个 JSON，便于前后对比：
//   - 200/1000/5000 行合成歌词：观察规模曲线；
//   - 真实歌曲形态（60–120 行、每行 10–12 个字级标签）：日常切歌的实际成本；
//   - 复杂字素簇样本：覆盖必须回退 Intl.Segmenter 的文本，避免优化只覆盖简单路径。
//
// 每个测量任务重复 REPEATS 次，报告 median（主指标）与 min（去噪后的下界）；
// 单次采样在 Node/V8 上抖动可达 2–3 倍，median 才适合做 before/after 对比。
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const REPEATS = 7;

async function loadTypeScriptModule(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const parser = await loadTypeScriptModule("../src/utils/lrcParser.ts");
const timing = await loadTypeScriptModule("../src/utils/lyricTiming.ts");

function makeLrc(lineCount) {
  return Array.from({ length: lineCount }, (_, index) => {
    const minutes = String(Math.floor(index / 600)).padStart(2, "0");
    const seconds = String(Math.floor((index % 600) / 10)).padStart(2, "0");
    const centiseconds = String(index % 100).padStart(2, "0");
    return `[${minutes}:${seconds}.${centiseconds}]line ${index} performance sample`;
  }).join("\n");
}

function makeYrc(lineCount) {
  return Array.from({ length: lineCount }, (_, index) => {
    const start = index * 1000;
    const words = Array.from({ length: 8 }, (_, word) =>
      `(${start + word * 100},100,0)word${word}`,
    ).join("");
    return `[${start},800]${words}`;
  }).join("\n");
}

/** 真实歌曲形态：中文逐字标签 + 少量英文词，每行 tagsPerLine 个标签。 */
function makeRealisticYrc(lineCount, tagsPerLine = 10) {
  const zhLine = "我们都在不断赶路忘记了出路";
  return Array.from({ length: lineCount }, (_, lineIndex) => {
    const start = lineIndex * 2500;
    let content = "";
    for (let tag = 0; tag < tagsPerLine; tag += 1) {
      const text = tag % 5 === 4 ? " for " : zhLine[tag % zhLine.length];
      content += `(${start + tag * 200},180,0)${text}`;
    }
    return `[${start},${tagsPerLine * 200}]${content}`;
  }).join("\n");
}

/** 需要回退 Intl.Segmenter 的文本：组合附加符、emoji 修饰符/旗帜/ZWJ、组合假名、谚文字母。 */
function makeComplexGraphemeYrc(lineCount) {
  const tokens = ["e\u0301", "👍🏽", "🇨🇳", "1️⃣", "か\u3099", "\u1100\u1161", "👨\u200d👩\u200d👧"];
  return Array.from({ length: lineCount }, (_, index) => {
    const start = index * 1000;
    const words = tokens
      .map((token, tag) => `(${start + tag * 100},100,0)${token}`)
      .join("");
    return `[${start},${tokens.length * 100}]${words}`;
  }).join("\n");
}

/** 重复测量取 median/min；任务返回值不参与统计，只计时。 */
function measure(task) {
  const samples = [];
  for (let i = 0; i < REPEATS; i += 1) {
    const start = performance.now();
    task();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    elapsedMs: Number(samples[Math.floor(REPEATS / 2)].toFixed(3)),
    minElapsedMs: Number(samples[0].toFixed(3)),
  };
}

function report(name, inputChars, measurements) {
  console.log(JSON.stringify({
    name,
    inputChars,
    repeatRuns: REPEATS,
    measurements: measurements.map(({ label, elapsedMs, minElapsedMs }) => ({
      name: label,
      elapsedMs,
      minElapsedMs,
    })),
  }));
}

function toMeasurement(label, task) {
  const { elapsedMs, minElapsedMs } = measure(task);
  return { label, elapsedMs, minElapsedMs };
}

for (const lineCount of [200, 1000, 5000]) {
  const lrc = makeLrc(lineCount);
  const yrc = makeYrc(lineCount);
  const lrcParsed = parser.parseLrc(lrc);
  const yrcParsed = parser.parseYrc(yrc);
  const lrcMeasurement = toMeasurement("parseLrc", () => parser.parseLrc(lrc));
  const yrcMeasurement = toMeasurement("parseYrc", () => parser.parseYrc(yrc));
  const alignMeasurement = toMeasurement("align", () =>
    timing.alignLyricTimelines(
      yrcParsed.map((line) => ({ time: line.time, text: parser.getYrcLineText(line) })),
      lrcParsed,
    ));
  report(
    `lyrics-${lineCount}`,
    lrc.length + yrc.length,
    [lrcMeasurement, yrcMeasurement, alignMeasurement],
  );
}

// 真实歌曲形态：60 行 × 10 标签、120 行 × 12 标签（一次切歌的同步解析成本）。
for (const [lineCount, tagsPerLine] of [[60, 10], [120, 12]]) {
  const yrc = makeRealisticYrc(lineCount, tagsPerLine);
  const lrc = makeLrc(lineCount);
  report(`song-${lineCount}x${tagsPerLine}`, yrc.length + lrc.length, [
    toMeasurement("parseYrc", () => parser.parseYrc(yrc)),
    toMeasurement("parseLrc", () => parser.parseLrc(lrc)),
  ]);
}

// 罕见复杂字素簇（回退 Intl.Segmenter 路径）的解析成本上界。
{
  const yrc = makeComplexGraphemeYrc(120);
  report("complex-graphemes-120", yrc.length, [
    toMeasurement("parseYrc", () => parser.parseYrc(yrc)),
  ]);
}
