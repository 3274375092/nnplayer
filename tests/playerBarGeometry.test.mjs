import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 窄窗播放条 / 进度命中框的几何契约（审计 #9，WCAG 2.5.8 Target Size）。
//
// 单测环境没有 WebView，无法量 DOM，所以这里做的是「源码契约 + 算术」：
// 从 styles.css / App.vue / QueueDrawer.vue / PlayerBarFloating.vue /
// ProgressBar.vue 读出声明值，再用它们重算布局，证明 24px 命中框在 768 CSS
// 的最小窗里是完整可见的，且与 40px 播放键之间满足 2.5.8 的间距算术。
// 任何一处单文件改动（条高、列间距、进度行高、命中框尺寸、预留/内缩）都会让
// 这里的算术失败，从而无法在无人察觉的情况下重新打开这个 WCAG 缺口。
//
// 契约（FIX-CONTEXT-2，HEAD 之前的 re-audit 残留）：
//   窄窗条高 74px；中央列 40（传输行）+ 8（间距）+ 12（进度行）= 60px，居中后
//   上下各 7px；24px 命中框 = 49–73；播放键圆心 27 ↔ 命中框圆心 61 = 34px
//   ≥ 20（播放键半径）+ 12（命中框半径）= 32px。消费者：--player-reserved-space
//   90px、queue inset 90px、About 弹层的底部让位同样按 90px（页面自身不再叠
//   底部留白，单一来源是外壳预留）。

const SOURCE_URLS = {
  styles: new URL("../src/styles.css", import.meta.url),
  app: new URL("../src/App.vue", import.meta.url),
  queue: new URL("../src/components/QueueDrawer.vue", import.meta.url),
  playerBar: new URL("../src/components/PlayerBarFloating.vue", import.meta.url),
  progressBar: new URL("../src/components/ProgressBar.vue", import.meta.url),
  about: new URL("../src/components/AboutDialog.vue", import.meta.url),
};

const [
  stylesSource,
  appSource,
  queueSource,
  playerBarSource,
  progressBarSource,
  aboutSource,
] = await Promise.all(
  Object.values(SOURCE_URLS).map((url) => readFile(url, "utf8")),
);

/** 取出某个 CSS 选择器（第 occurrence 次出现）的规则体。 */
function readRule(source, selector, occurrence = 1) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...source.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "g")),
  ];
  assert.ok(
    matches.length >= occurrence,
    `找不到第 ${occurrence} 个 ${selector} 规则`,
  );
  return matches[occurrence - 1][1];
}

function readPx(rule, property, label) {
  const match = rule.match(new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`));
  assert.ok(match, `${label} 缺少 ${property}: <n>px`);
  return Number(match[1]);
}

/** 断言 @media (max-width: 768px) 块内出现了给定声明。 */
function assertInNarrowBlock(source, pattern, label) {
  const block = source.match(/@media \(max-width: 768px\) \{[\s\S]*?\n\}/);
  assert.ok(block, "找不到 @media (max-width: 768px) 块");
  assert.match(block[0], pattern, label);
}

// =============== 契约常量 ===============

test("窄窗播放条高 74px（桌面 76px 不变）", () => {
  const narrowBar = readRule(stylesSource, ".mobile-player-bar");
  assert.equal(
    readPx(narrowBar, "height", "styles.css .mobile-player-bar"),
    74,
  );
  // 桌面条高仍是 DESIGN 的 76px。
  const desktopBar = readRule(playerBarSource, ".player-bar-grid");
  assert.equal(readPx(desktopBar, "height", ".player-bar-grid"), 76);
});

test("窄窗中央列 = 40 传输行 + 8 间距 + 12 进度行 = 60px", () => {
  // 传输行高 = 40px 播放键（窄窗不变形）。
  // 第 1 个 .player-play-button 规则是与图标键共用的过渡声明，第 2 个才是尺寸。
  const playButton = readRule(playerBarSource, ".player-play-button", 2);
  assert.equal(readPx(playButton, "height", ".player-play-button"), 40);
  assert.equal(readPx(playButton, "width", ".player-play-button"), 40);

  // 间距：桌面 6px（76px 条内仍放得下），窄窗 8px（#9 契约）。
  const centerColumnBase = readRule(playerBarSource, ".player-center-column");
  assert.equal(readPx(centerColumnBase, "gap", ".player-center-column"), 6);
  assertInNarrowBlock(
    playerBarSource,
    /\.player-center-column\s*\{\s*gap:\s*8px;/,
    "窄窗 .player-center-column 必须是 gap: 8px",
  );

  // 进度行高 = ProgressBar 根节点的 Tailwind h-3（0.75rem = 12px），
  // 且时间标签必须 line-height: 1（否则默认 1.5 会把行撑到 16.5px）。
  assert.match(
    progressBarSource,
    /class="progress-bar relative h-3/,
    "ProgressBar 根节点必须是 h-3（12px 进度行）",
  );
  const playerTime = readRule(playerBarSource, ".player-time");
  assert.match(
    playerTime,
    /line-height:\s*1;/,
    ".player-time 必须 line-height: 1，进度行才是 12px",
  );
});

test("24px 进度命中框完整落在 74px 条内（49–73）", () => {
  const range = readRule(progressBarSource, ".progress-range");
  assert.equal(readPx(range, "height", ".progress-range 命中框"), 24);
  // 命中框在 12px 进度行里垂直居中：top 50% + translateY(-50%)。
  assert.match(range, /top:\s*50%;/);
  assert.match(range, /transform:\s*translateY\(-50%\);/);
});

test("播放条允许纵向溢出（浮动气泡），横向仍由网格收缩约束", () => {
  // 播放条必须 overflow: visible：进度预览气泡是 Floating 层，停在条内会压住
  // 传输控件行，只能探出条顶（DESIGN Elevation）。横向不会溢出——三列分别是
  // minmax(0,1fr) / clamp(...) / minmax(0,1fr)，左右列内容都带 min-w-0，
  // 封面由自身 overflow:hidden 裁剪，播放键脉冲 64px < 条高 76px。
  const bar = readRule(playerBarSource, ".player-bar-grid");
  assert.match(bar, /overflow:\s*visible;/);
  assert.match(
    playerBarSource,
    /grid-template-columns:\s*\n\s*minmax\(0, 1fr\)/,
    "播放条横向仍必须是可收缩的三列网格",
  );
});

test("几何算术：24px 目标 + 34px ≥ 20 + 12 的 WCAG 2.5.8 间距", () => {
  const barHeight = readPx(
    readRule(stylesSource, ".mobile-player-bar"),
    "height",
    "条高",
  );
  const transportHeight = readPx(
    readRule(playerBarSource, ".player-play-button", 2),
    "height",
    "传输行",
  );
  const centerColumn = readRule(playerBarSource, ".player-center-column");
  const narrowGap = Number(
    playerBarSource
      .match(
        /@media \(max-width: 768px\) \{[\s\S]*?\.player-center-column\s*\{\s*gap:\s*(\d+)px;/,
      )?.[1],
  );
  const seekInputHeight = readPx(
    readRule(progressBarSource, ".progress-range"),
    "height",
    "命中框",
  );
  const seekRowHeight = 12; // 进度行 = ProgressBar 根节点 h-3
  const playDiameter = transportHeight;

  assert.ok(Number.isFinite(narrowGap), "窄窗间距必须是像素整数");

  const columnHeight = transportHeight + narrowGap + seekRowHeight;
  const topMargin = (barHeight - columnHeight) / 2;
  const playCenter = topMargin + playDiameter / 2;
  const seekCenter = topMargin + transportHeight + narrowGap + seekRowHeight / 2;
  const inputTop = seekCenter - seekInputHeight / 2;
  const inputBottom = seekCenter + seekInputHeight / 2;
  const spacing = seekCenter - playCenter;
  const minimumSpacing = playDiameter / 2 + seekInputHeight / 2;

  // 中央列 60 居中于 74：上下各 7px（整数，避免半像素）。
  assert.equal(columnHeight, 60, "中央列高必须是 40 + 8 + 12 = 60");
  assert.equal(topMargin, 7, "中央列居中后上下必须是 7px");
  assert.equal(playCenter, 27, "播放键圆心必须是 27");
  assert.equal(seekCenter, 61, "命中框圆心必须是 61");
  assert.equal(inputTop, 49, "24px 命中框顶部必须是 49");
  assert.equal(inputBottom, 73, "24px 命中框底部必须是 73");
  assert.ok(inputTop >= 0, "命中框不能超出播放条顶部");
  assert.ok(inputBottom <= barHeight, "命中框必须完整落在 74px 条内");
  assert.equal(spacing, 34, "圆心间距必须是 34");
  assert.equal(minimumSpacing, 32, "2.5.8 间距下限是 20 + 12 = 32");
  assert.ok(
    spacing >= minimumSpacing,
    "24px 目标与 40px 播放键之间必须留出 ≥ 32px 圆心距，间距例外不再适用",
  );
});

test("源码注释记录了 34 ≥ 20 + 12 的间距算术（防止只改数字不留依据）", () => {
  // 契约算术必须写在组件源码里，供后续维护者理解 8px 间距不是随手定的。
  assert.match(
    playerBarSource,
    /34px\s*≥\s*20（播放键半径）\s*\+\s*12（命中框半径）\s*=\s*32px/,
    "PlayerBarFloating.vue 必须记录 34 ≥ 20 + 12 的几何依据",
  );
  assert.match(
    progressBarSource,
    /34px\s*≥\s*20\+12\s*=\s*32px/,
    "ProgressBar.vue 必须记录命中框与播放键的间距算术",
  );
});

// =============== 消费者（预留高度 / 队列内缩 / 页面留白） ===============

test("窄窗 --player-reserved-space = 90px（74 + 8 + 8），桌面 100px 不变", () => {
  assertInNarrowBlock(
    appSource,
    /--player-reserved-space:\s*90px;/,
    "App.vue 窄窗必须预留 90px",
  );
  assert.match(
    appSource,
    /\.app-content-shell\s*\{\s*--player-reserved-space:\s*100px;/,
    "App.vue 桌面预留应保持 100px",
  );
});

test("窄窗队列抽屉 --queue-bottom-inset = 90px，桌面 96px 不变", () => {
  // 桌面基准（.queue-scrim, .queue-drawer 共用变量）保持 96px。
  assert.match(
    queueSource,
    /\.queue-scrim,\s*\.queue-drawer\s*\{\s*--queue-bottom-inset:\s*96px;/,
    "队列抽屉桌面内缩保持 96px",
  );
  assertInNarrowBlock(
    queueSource,
    /--queue-bottom-inset:\s*90px;/,
    "QueueDrawer.vue 窄窗内缩必须是 90px",
  );
});

test("窄窗底部让位只有一个来源：外壳 90px 预留，页面不再叠 padding-bottom", () => {
  // 播放条遮挡由 .app-main 的 --player-reserved-space: 90px 统一让开；
  // 页面若再声明 padding-bottom 会与预留叠加成双倍空白（历史 94px 已删除）。
  assert.match(
    appSource,
    /--player-reserved-space:\s*90px;/,
    "App.vue 窄窗预留必须是 90px（74 播放条 + 8 底距 + 8 间隙）",
  );
  const pagePadding = readRule(stylesSource, ".mobile-content-padding");
  assert.doesNotMatch(
    pagePadding,
    /padding-bottom/,
    "styles.css .mobile-content-padding 不允许再声明 padding-bottom",
  );
  assert.doesNotMatch(
    appSource,
    /mobile-content-padding/,
    "App.vue 不再需要 :deep(.mobile-content-padding) 清零覆盖",
  );
  // 横向仍按 DESIGN 的窄屏 20px，纵向顶部 12px。
  assert.match(pagePadding, /padding-left:\s*20px\s*!important;/);
  assert.match(pagePadding, /padding-right:\s*20px\s*!important;/);
  assert.match(pagePadding, /padding-top:\s*12px\s*!important;/);
});

test("About 弹层窄窗让位跟随 90px 播放条预留（不再用旧 76px）", () => {
  // 与 .mobile-player-bar 同一几何：74 播放条 + 8 底距 + 8 间隙 = 90。
  assert.match(
    aboutSource,
    /padding:\s*16px 12px calc\(90px \+ 12px\);/,
    "AboutDialog 窄窗 stage 底部让位必须是 calc(90px + 12px)",
  );
  assert.match(
    aboutSource,
    /max-height:\s*calc\(100vh - 90px - 28px\);/,
    "AboutDialog 窄窗面板高度上限必须按 90px 计算",
  );
  assert.doesNotMatch(
    aboutSource,
    /calc\(76px/,
    "AboutDialog 不允许残留旧 76px 播放条几何",
  );
});
