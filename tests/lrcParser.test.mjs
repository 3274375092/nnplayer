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
