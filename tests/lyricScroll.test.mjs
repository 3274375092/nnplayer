import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 歌词滚动决策的纯函数测试（评审 M7/L7）。
// 评审要点：SCROLL_LEAD_MS=200 的提前滚动、相邻行弹簧 vs 大跳 snap 的
// 「2.5 行」阈值此前写在 SFC 里没有任何覆盖；这里在 node --test 环境用真实
// Lyric Timeline / heightPrefix 守住边界，并加一条源码契约防止逻辑退回 SFC。

async function compileTypeScriptModule(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const viewport = await import(
  await compileTypeScriptModule("../src/lyrics/lyricViewport.ts")
);
const lyricScroll = await import(
  await compileTypeScriptModule("../src/lyrics/lyricScroll.ts")
);
const { buildLyricHeightPrefix } = viewport;
const {
  computeLyricSnapLimitPx,
  computeScrollIndex,
  MAX_ANIMATED_JUMP_LINES,
  SCROLL_LEAD_MS,
} = lyricScroll;

// 普通 2s 行距的 Lyric Timeline（与 line.time 同源）。
const timeline = [1000, 3000, 5000, 8000];

function scrollIndexAt(overrides = {}) {
  return computeScrollIndex({
    activeLineIndex: 0,
    lineStartMs: timeline,
    progressMs: 0,
    playing: true,
    ...overrides,
  });
}

test("scroll tuning constants stay at the reviewed values", () => {
  assert.equal(SCROLL_LEAD_MS, 200);
  assert.equal(MAX_ANIMATED_JUMP_LINES, 2.5);
});

test("visual scroll leads the next line by 200ms (inclusive boundary)", () => {
  // 第 0 行时长 2000ms：剩余 201ms 不预滚，剩余 200ms 进入预滚窗口。
  assert.equal(scrollIndexAt({ progressMs: 1799 }), 0);
  assert.equal(scrollIndexAt({ progressMs: 0 }), 0);
  assert.equal(scrollIndexAt({ progressMs: 1800 }), 1);
  // 越过本行后仍只前进一步，不一次跳过多行。
  assert.equal(scrollIndexAt({ progressMs: 1999 }), 1);
});

test("visual scroll never leads past the last line", () => {
  const lastIndex = timeline.length - 1;
  assert.equal(
    scrollIndexAt({
      activeLineIndex: lastIndex,
      progressMs: 999_999,
    }),
    lastIndex,
  );
});

test("paused playback keeps the active line centered (no lead)", () => {
  assert.equal(scrollIndexAt({ progressMs: 1999, playing: false }), 0);
  assert.equal(scrollIndexAt({ progressMs: 0, playing: false }), 0);
});

test("no lead before the first active line", () => {
  assert.equal(scrollIndexAt({ activeLineIndex: -1 }), -1);
  assert.equal(
    computeScrollIndex({
      activeLineIndex: -1,
      lineStartMs: [],
      progressMs: 0,
      playing: true,
    }),
    -1,
  );
});

test("dense and zero-duration lines still lead by exactly one line", () => {
  // 行距全部短于 200ms 的说唱段：每行一进入就处在下一行的预滚窗口里。
  const dense = [0, 120, 240, 260];
  assert.equal(
    computeScrollIndex({
      activeLineIndex: 0,
      lineStartMs: dense,
      progressMs: 0,
      playing: true,
    }),
    1,
  );
  assert.equal(
    computeScrollIndex({
      activeLineIndex: 1,
      lineStartMs: dense,
      progressMs: 0,
      playing: true,
    }),
    2,
  );
  // 零时长行（同时间戳）：remaining = 0 - progress <= 200，仍只前进一步。
  const zeroDuration = [0, 0, 900];
  assert.equal(
    computeScrollIndex({
      activeLineIndex: 0,
      lineStartMs: zeroDuration,
      progressMs: 0,
      playing: true,
    }),
    1,
  );
  assert.equal(
    computeScrollIndex({
      activeLineIndex: 0,
      lineStartMs: zeroDuration,
      progressMs: 400,
      playing: true,
    }),
    1,
  );
  // 同时间戳的最后一行没有下一行，不预滚。
  assert.equal(
    computeScrollIndex({
      activeLineIndex: 2,
      lineStartMs: zeroDuration,
      progressMs: 0,
      playing: true,
    }),
    2,
  );
});

test("snap limit follows measured heights: ~57px translated lines give ~142px, not 90px", () => {
  // 带翻译的歌词行实际高约 57px（36px 正文 + 翻译行）。
  const tallLineHeight = 57;
  const count = 8;
  const prefix = buildLyricHeightPrefix(
    count,
    new Array(count).fill(tallLineHeight),
    36,
  );
  const limit = computeLyricSnapLimitPx(prefix, count, 2, 36);
  assert.ok(
    Math.abs(limit - 142.5) < 1e-9,
    `57px 行高对应阈值应为 142.5px，实际 ${limit}`,
  );
  assert.ok(
    limit > 36 * MAX_ANIMATED_JUMP_LINES,
    "不得退回 props.lineHeight 的 90px 阈值",
  );
});

test("snap limit uses the same adjacent-line mean as targetY", () => {
  const prefix = buildLyricHeightPrefix(4, [36, 57, 57, 36], 36);
  // 目标行与下一行同为 57px：单行位移 57px。
  assert.equal(computeLyricSnapLimitPx(prefix, 4, 1, 36), 2.5 * 57);
  // 目标行 36px、下一行 57px：单行位移取两者均值。
  assert.equal(computeLyricSnapLimitPx(prefix, 4, 0, 36), 2.5 * ((36 + 57) / 2));
  // 最后一行没有下一行：单行位移取自身高度。
  assert.equal(computeLyricSnapLimitPx(prefix, 4, 3, 36), 2.5 * 36);
});

test("snap limit falls back to props.lineHeight while heights are unmeasured", () => {
  // 未测量行由 buildLyricHeightPrefix 填入 fallback（即 props.lineHeight）。
  const unmeasured = buildLyricHeightPrefix(5, [], 36);
  assert.equal(computeLyricSnapLimitPx(unmeasured, 5, 0, 36), 90);
  // heightPrefix 尚未生成 / 前缀缺项时同样回退。
  assert.equal(computeLyricSnapLimitPx(new Float64Array(1), 5, 3, 36), 90);
  assert.equal(computeLyricSnapLimitPx([], 0, 0, 36), 90);
  // 越界索引夹到有效范围，不产生 NaN。
  const measured = buildLyricHeightPrefix(2, [57, 57], 36);
  assert.equal(computeLyricSnapLimitPx(measured, 2, 99, 36), 142.5);
});

test("LyricPanel uses the pure module and listens to reduced-motion changes", async () => {
  const [panel, aside] = await Promise.all([
    readFile(new URL("../src/components/LyricPanel.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/components/LyricAside.vue", import.meta.url), "utf8"),
  ]);
  // 目标行与大跳阈值不再在 SFC 内复制一份。
  assert.match(panel, /from\s+"@\/lyrics\/lyricScroll"/);
  assert.match(panel, /computeScrollIndex\(/);
  assert.match(panel, /computeLyricSnapLimitPx\(/);
  assert.doesNotMatch(panel, /const\s+SCROLL_LEAD_MS\s*=/);
  assert.doesNotMatch(panel, /const\s+MAX_ANIMATED_JUMP_LINES\s*=/);
  // reduce-motion 从 setup 快照改为 matchMedia change 监听，并在卸载时清理。
  assert.match(panel, /addEventListener\(\s*"change",\s*onReduceMotionChange/);
  assert.match(panel, /removeEventListener\(\s*"change",\s*onReduceMotionChange/);
  // 高度测量用布局偏移，不受 sticky 卡片实时 rect 影响。
  assert.match(aside, /asideRect\.top\s*-\s*portRect\.top\s*\+\s*port\.scrollTop/);
});
