import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

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
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const parser = await loadTypeScriptModule("../src/utils/lrcParser.ts");
const timing = await loadTypeScriptModule("../src/utils/lyricTiming.ts");

test("parseLrc applies positive and negative global offsets", () => {
  assert.deepEqual(parser.parseLrc("[offset:+500]\n[00:01.000]A"), [
    { time: 1500, text: "A" },
  ]);
  assert.deepEqual(parser.parseLrc("[00:00.200]A\n[offset:-500]"), [
    { time: 0, text: "A" },
  ]);
});

test("translation matching follows the source LRC offset", () => {
  assert.deepEqual(
    parser.parseLrcWithTranslation(
      "[offset:+1000]\n[00:01.000]A",
      "[00:01.000]译文",
    ),
    [{ time: 2000, text: "A", translation: "译文" }],
  );
});

test("parseYrc preserves absolute word timing and sorts rows", () => {
  const rows = parser.parseYrc(
    "[2000,500](2000,500,0)后\n[1000,900](1000,600,0)Hello (1600,300,0)你",
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].time, 1000);
  assert.equal(parser.getYrcLineText(rows[0]), "Hello 你");
  assert.equal(parser.getYrcLineStartMs(rows[0]), 1000);
  assert.equal(rows[0].words[0].startMs, 1000);
  assert.equal(rows[0].words.at(-1).startMs, 1600);
  assert.deepEqual(
    rows[0].words.slice(0, 6).map((word) => word.duration),
    [120, 120, 120, 120, 120, 0],
  );
});

test("multi-character YRC words divide their duration sequentially", () => {
  const [line] = parser.parseYrc("[5000,900](5000,900,0)ABC");
  assert.deepEqual(
    line.words.map(({ char, startMs, duration }) => ({ char, startMs, duration })),
    [
      { char: "A", startMs: 5000, duration: 300 },
      { char: "B", startMs: 5300, duration: 300 },
      { char: "C", startMs: 5600, duration: 300 },
    ],
  );
});

test("YRC tokenization keeps combining marks and ZWJ emoji intact", () => {
  const [line] = parser.parseYrc(
    "[1000,1000](1000,1000,0)e\u0301👨‍👩‍👧‍👦",
  );
  assert.deepEqual(line.words.map((word) => word.char), ["e\u0301", "👨‍👩‍👧‍👦"]);
  assert.deepEqual(line.words.map((word) => word.duration), [500, 500]);
});

// 以下两条守住 parseYrc 的「简单字素快速路径」：普通中文/英文走码点切分，
// 复杂字素簇必须回退 Intl.Segmenter，两者输出都不能随优化漂移。
test("YRC grapheme fast path keeps complex clusters intact", () => {
  const [line] = parser.parseYrc(
    "[0,700](0,100,0)👍🏽(100,100,0)🇨🇳(200,100,0)1️⃣(300,100,0)か\u3099(400,100,0)\u1100\u1161(500,100,0)e\u0301(600,100,0)x",
  );
  assert.deepEqual(line.words.map((word) => word.char), [
    "👍🏽",
    "🇨🇳",
    "1️⃣",
    "か\u3099", // か + 组合浊音点：一个可见字，一个字素簇
    "\u1100\u1161", // 谚文字母 L+V 组合成一个音节
    "e\u0301",
    "x",
  ]);
});

test("YRC simple-script fast path tokenizes CJK and Latin by code point", () => {
  const [line] = parser.parseYrc(
    "[0,1000](0,100,0)我们(100,300,0)Hello (400,300,0)世界",
  );
  assert.deepEqual(line.words.map((word) => word.char), [
    "我", "们", "H", "e", "l", "l", "o", " ", "世", "界",
  ]);
  // 标签时长在可见字之间均分；空格保留显示但不占时长。
  assert.deepEqual(line.words.map((word) => word.duration), [
    50, 50, 60, 60, 60, 60, 60, 0, 150, 150,
  ]);
});

test("parseYrc strips a leading BOM and skips malformed lines", () => {
  // 注：行首正则的 ^\s*[ 中 \s 本就匹配 U+FEFF，输出层面观测不到 BOM slice
  // 微优化；本用例守的是「带 BOM 的 YRC 仍可正常解析」这一行为契约。
  const rows = parser.parseYrc(
    "\uFEFF[0,500](0,500,0)好\nnot a yrc line\n[1000,500](1000,500,0)呀",
  );
  assert.deepEqual(rows.map((row) => parser.getYrcLineText(row)), ["好", "呀"]);
});

// 白名单一旦误收组合类码点（或漏掉该回退的字符），逐码点切分就会与
// Intl.Segmenter 漂移；这里对边界样本做差分校验，比逐个断言字面量更难被骗过。
test("YRC fast path matches Intl.Segmenter on whitelist boundary samples", () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const samples = [
    "A\u0308", // 拉丁组合附加符：0300–036F 不在白名单
    "\u0438\u0483", "\u0438\u0489", // 西里尔组合附加符：0483–0489 被白名单跳过
    "\u3042\u302a", "\u3042\u302b", // CJK 组合符号：302A–302F 被跳过
    "\u304b\u3099", "\u304b\u309a", // 组合假名浊音/半浊音点：3099–309A 被跳过
    "\uac00\u11a8", // 预组合谚文音节 + T 字母：会合成一个音节
    "\u1100\u1161\u11a8", // L + V + T 字母组合
    "e\u0301", "👍🏽", "🇨🇳", "1️⃣", "👨‍👩‍👧", "\u00ad",
    "我们Hello「世界」，かなカナ한", // 全部命中白名单：快速路径结果必须一致
  ];
  for (const sample of samples) {
    const [line] = parser.parseYrc(`[0,1000](0,1000,0)${sample}`);
    const expected = Array.from(
      segmenter.segment(sample),
      ({ segment }) => segment,
    );
    assert.deepEqual(line.words.map((word) => word.char), expected, sample);
  }
});

test("YRC out-of-order word tags are still sorted by start time", () => {
  // 有序时跳过行内排序是性能优化；乱序标签仍必须按时间单调输出。
  const [line] = parser.parseYrc(
    "[0,1000](500,100,0)B(100,100,0)A(300,100,0)C",
  );
  assert.deepEqual(line.words.map((word) => word.char), ["A", "C", "B"]);
  assert.deepEqual(line.words.map((word) => word.startMs), [100, 300, 500]);
});

test("karaoke token progress clamps before, during, and after its time window", () => {
  const token = { startMs: 100, endMs: 300 };
  assert.equal(timing.getKaraokeTokenProgress(token, 50), 0);
  assert.equal(timing.getKaraokeTokenProgress(token, 200), 0.5);
  assert.equal(timing.getKaraokeTokenProgress(token, 350), 1);
});

test("timeline alignment does not jump to a farther repeated short line", () => {
  const result = timing.alignLyricTimelines(
    [{ time: 1000, text: "la" }],
    [
      { time: 1000, text: "la!" },
      { time: 3000, text: "la" },
    ],
  );
  assert.deepEqual(result.lrcIndexByYrc, [0]);
  assert.equal(result.fallbackOffsetMs, 0);
});

test("timeline alignment keeps partial YRC matching one-to-one", () => {
  const result = timing.alignLyricTimelines(
    [{ time: 1000, text: "A" }],
    [
      { time: 1000, text: "A" },
      { time: 1400, text: "B" },
    ],
  );
  assert.deepEqual(result.lrcIndexByYrc, [0]);
});

test("timeline alignment accepts only a consistent multi-line source offset", () => {
  const result = timing.alignLyricTimelines(
    [
      { time: 2000, text: "A" },
      { time: 3000, text: "B" },
      { time: 4000, text: "C" },
    ],
    [
      { time: 1000, text: "A" },
      { time: 2000, text: "B" },
      { time: 3000, text: "C" },
    ],
  );
  assert.deepEqual(result.lrcIndexByYrc, [0, 1, 2]);
  assert.equal(result.fallbackOffsetMs, 1000);
});

test("timeline alignment recognizes a consistent offset in a two-line song", () => {
  const result = timing.alignLyricTimelines(
    [
      { time: 2000, text: "A" },
      { time: 2900, text: "B" },
    ],
    [
      { time: 1000, text: "A" },
      { time: 1900, text: "B" },
    ],
  );
  assert.deepEqual(result.lrcIndexByYrc, [0, 1]);
  assert.equal(result.fallbackOffsetMs, 1000);
});

test("translation-only LRC aligns by sequence before nearest timestamps", () => {
  const result = timing.alignLyricTimelines(
    [
      { time: 2000, text: "Original A" },
      { time: 2900, text: "Original B" },
    ],
    [
      { time: 1000, text: "译文甲" },
      { time: 1900, text: "译文乙" },
    ],
    { lrcTextIsTranslation: true },
  );
  assert.deepEqual(result.lrcIndexByYrc, [0, 1]);
  assert.equal(result.fallbackOffsetMs, 1000);
});

test("translation-only alignment tolerates a missing middle YRC line", () => {
  const result = timing.alignLyricTimelines(
    [
      { time: 2000, text: "A" },
      { time: 4000, text: "C" },
      { time: 5000, text: "D" },
    ],
    [
      { time: 1000, text: "译文 A" },
      { time: 2000, text: "译文 B" },
      { time: 3000, text: "译文 C" },
      { time: 4000, text: "译文 D" },
    ],
    { lrcTextIsTranslation: true },
  );
  assert.deepEqual(result.lrcIndexByYrc, [0, 2, 3]);
  assert.equal(result.fallbackOffsetMs, 1000);
  assert.equal(result.reliable, true);
});

test("translation-only alignment rejects an ambiguous missing edge", () => {
  const result = timing.alignLyricTimelines(
    [
      { time: 2000, text: "A" },
      { time: 3000, text: "B" },
    ],
    [
      { time: 1000, text: "译文 A" },
      { time: 2000, text: "译文 B" },
      { time: 3000, text: "译文 C" },
    ],
    { lrcTextIsTranslation: true },
  );
  assert.equal(result.reliable, false);
  assert.deepEqual(result.lrcIndexByYrc, [null, null]);
});

test("translation-only single line accepts only a unique nearby timestamp", () => {
  const aligned = timing.alignLyricTimelines(
    [{ time: 1200, text: "Original" }],
    [{ time: 1000, text: "Translation" }],
    { lrcTextIsTranslation: true },
  );
  assert.equal(aligned.reliable, true);
  assert.deepEqual(aligned.lrcIndexByYrc, [0]);
  assert.equal(aligned.fallbackOffsetMs, 200);

  const rejected = timing.alignLyricTimelines(
    [{ time: 1400, text: "Original" }],
    [{ time: 1000, text: "Translation" }],
    { lrcTextIsTranslation: true },
  );
  assert.equal(rejected.reliable, false);
  assert.deepEqual(rejected.lrcIndexByYrc, [null]);
});
