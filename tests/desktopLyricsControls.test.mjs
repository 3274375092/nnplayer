import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 桌面歌词工具条的可测逻辑从 SFC 的标记区间抽取后转译执行：
// Esc 决策与 aria/title 文案因此可以单测，而不必为「可测」再拆一个源文件。
// 抽取值必须保持零依赖（不 import Vue/Tauri、不读浏览器 API），见 DesktopLyrics.vue 注释。
const SOURCE_URL = new URL("../src/views/DesktopLyrics.vue", import.meta.url);
const START_MARKER =
  "// =============== 工具条可测逻辑（纯函数） ===============";
const END_MARKER = "// =============== 工具条可测逻辑结束 ===============";

const source = await readFile(SOURCE_URL, "utf8");

// 其余桌面歌词文件只做源码契约断言：偏好归一化、桥接帧率与快照去重
// 都是运行时行为，但单测环境没有 Tauri/WebView，源码契约是能守住回归的部分。
const PREFS_SOURCE_URL = new URL(
  "../src/composables/useLyricWindowPrefs.ts",
  import.meta.url,
);
const BRIDGE_SOURCE_URL = new URL(
  "../src/composables/useDesktopLyricsBridge.ts",
  import.meta.url,
);
const PUBLISHER_SOURCE_URL = new URL(
  "../src/composables/useDesktopLyricsPublisher.ts",
  import.meta.url,
);
const [prefsSource, bridgeSource, publisherSource] = await Promise.all([
  readFile(PREFS_SOURCE_URL, "utf8"),
  readFile(BRIDGE_SOURCE_URL, "utf8"),
  readFile(PUBLISHER_SOURCE_URL, "utf8"),
]);

function extractControlsSource() {
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  assert.ok(start >= 0, "DesktopLyrics.vue 缺少纯函数起始标记");
  assert.ok(end > start, "DesktopLyrics.vue 缺少纯函数结束标记");
  // 标记行本身是注释，切片从行尾开始；区间内的注释与类型声明都可直接转译。
  return source.slice(start + START_MARKER.length, end);
}

async function loadControls() {
  const compiled = ts.transpileModule(
    `${extractControlsSource()}
export {
  resolveEscapeAction,
  formatOpacityPercent,
  formatOpacityLabel,
  formatPrevNextLabel,
  formatLockLabel,
  formatLockTitle,
  formatFontSizeLabel,
  contextBandFitsLine,
};
`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: "desktopLyricsControls.ts",
    },
  ).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const controls = await loadControls();

test("Esc 决策：有工具条只收起，工具条收起后忽略（Esc 绝不销毁窗口）", () => {
  assert.equal(
    controls.resolveEscapeAction({ toolbarVisible: true }),
    "hide-toolbar",
  );
  assert.equal(
    controls.resolveEscapeAction({ toolbarVisible: false }),
    "ignore",
  );

  // 只允许两种动作：不存在把 Esc 解释成「关窗」的分支。
  const actions = new Set([
    controls.resolveEscapeAction({ toolbarVisible: true }),
    controls.resolveEscapeAction({ toolbarVisible: false }),
  ]);
  assert.deepEqual([...actions].sort(), ["hide-toolbar", "ignore"]);
});

test("不透明度标签：可见百分比读数 + 含当前值的 aria/title 文案", () => {
  assert.equal(controls.formatOpacityPercent(1), "100%");
  assert.equal(controls.formatOpacityPercent(0.95), "95%");
  // 0.8 是可调下限（低于它白色阶梯会跌破 AA），读数仍需正确。
  assert.equal(controls.formatOpacityPercent(0.8), "80%");
  assert.equal(
    controls.formatOpacityLabel(0.95),
    "不透明度 95%，左右拖动调整",
  );
  assert.match(controls.formatOpacityLabel(0.85), /不透明度 85%/);
});

test("下一行开关 label 说明动作与当前状态，不承诺不存在的上一行", () => {
  const shown = controls.formatPrevNextLabel(true);
  const hidden = controls.formatPrevNextLabel(false);

  assert.match(shown, /隐藏下一行歌词/);
  assert.match(shown, /当前已显示/);
  assert.match(hidden, /显示下一行歌词/);
  assert.match(hidden, /当前已隐藏/);
  assert.doesNotMatch(shown, /上一行/);
  assert.doesNotMatch(hidden, /上一行/);
  assert.notEqual(shown, hidden);
});

test("锁定 label 写明「锁定后窗口不可拖动」，title 保留双击提示", () => {
  const locked = controls.formatLockLabel(true);
  const unlocked = controls.formatLockLabel(false);

  assert.match(locked, /解锁桌面歌词/);
  assert.match(locked, /当前已锁定/);
  assert.match(unlocked, /锁定桌面歌词/);
  for (const label of [locked, unlocked]) {
    assert.match(label, /窗口不可拖动/);
  }

  assert.match(controls.formatLockTitle(true), /双击歌词也可解锁/);
  assert.match(controls.formatLockTitle(false), /双击歌词也可锁定/);
});

test("字号步进 label 带当前字号", () => {
  assert.equal(
    controls.formatFontSizeLabel("increase", 32),
    "增大字号（当前 32px）",
  );
  assert.equal(
    controls.formatFontSizeLabel("decrease", 14),
    "减小字号（当前 14px）",
  );
});

test("onKeyDown 只折叠工具条，不再调用 onClose/destroy", () => {
  const handler = source.match(/function onKeyDown\(e: KeyboardEvent\) \{[\s\S]*?\n\}/);
  assert.ok(handler, "DesktopLyrics.vue 中找不到 onKeyDown");

  assert.match(handler[0], /resolveEscapeAction/);
  assert.doesNotMatch(handler[0], /onClose|destroy\(/);

  // 强退出只保留工具条关闭按钮：全文件只有一个 @click="onClose"。
  assert.equal([...source.matchAll(/@click="onClose"/g)].length, 1);
  assert.doesNotMatch(source, /void onClose\(\)/);
});

test("工具条命中区：按钮 24×24、滑块 24px 高而视觉轨道仍 4px", () => {
  const button = source.match(/\.toolbar-btn \{[\s\S]*?\n\}/);
  assert.ok(button, "找不到 .toolbar-btn 规则");
  assert.match(button[0], /width: 24px;/);
  assert.match(button[0], /height: 24px;/);
  assert.match(button[0], /border-radius: 4px;/);

  const slider = source.match(/\.opacity-slider \{[\s\S]*?\n\}/);
  assert.ok(slider, "找不到 .opacity-slider 规则");
  assert.match(slider[0], /height: 24px;/);

  const track = source.match(
    /\.opacity-slider::-webkit-slider-runnable-track \{[\s\S]*?\n\}/,
  );
  assert.ok(track, "找不到滑块轨道规则");
  assert.match(track[0], /height: 4px;/);

  // 最小值随对比度下限抬到 0.9；值仍写回 useLyricWindowPrefs 的 prefs.opacity。
  assert.match(source, /min="0\.9"/);
  assert.match(source, /max="1"/);
  assert.match(source, /step="0\.05"/);
  assert.match(source, /useLyricWindowPrefs/);
});

test("不透明度下限 0.9 同时落在持久化归一化上（旧值向上收敛）", () => {
  // 旧版本存过 0.2–0.85 的值：载入时必须夹到 0.9，而不是把窗口恢复到不可读。
  assert.match(prefsSource, /const MIN_LYRIC_WINDOW_OPACITY = 0\.9;/);
  assert.match(
    prefsSource,
    /Math\.max\(MIN_LYRIC_WINDOW_OPACITY, Math\.min\(1, input\.opacity\)\)/,
  );
  assert.doesNotMatch(prefsSource, /Math\.max\(0\.2,/);
});

test("根容器是命名 region，首次键盘焦点在当前行黑板上可见", () => {
  // role=region 才能让 aria-label 生效（generic 角色会丢弃 aria-label）。
  assert.match(source, /role="region"/);
  assert.match(source, /aria-label="桌面歌词，按 Tab 可调整显示设置"/);
  // 透明窗没有页面底色：焦点提示用当前行底板的内嵌白环（outline 负 offset，
  // 强制颜色模式下仍然可见），不依赖壁纸颜色。
  assert.match(
    source,
    /\.lyric-root:focus-visible \.current-wrap \{[\s\S]*?outline: 2px solid rgb\(255 255 255 \/ 92%\);[\s\S]*?outline-offset: -2px;/,
  );
  // 工具条按钮原有的白色焦点环保持不变。
  assert.match(
    source,
    /\.toolbar-btn:focus-visible,[\s\S]*?outline: 2px solid #fff/,
  );
  // 首次焦点仍会展开工具条（原有行为）。
  assert.match(source, /@focusin="toolbarVisible = true"/);
});

test("外文歌词行带 lang：当前行、翻译行、下一行与其翻译", () => {
  assert.match(source, /import \{ langForLyric \} from "@\/utils\/lyricScript";/);
  const bound = [...source.matchAll(/:lang="langForLyric\(/g)];
  assert.ok(
    bound.length >= 4,
    `歌词行 lang 绑定不足：${bound.length}`,
  );
  assert.match(source, /:lang="langForLyric\(visible\.current\.text\)"/);
  assert.match(source, /:lang="langForLyric\(visible\.current\.translation\)"/);
  assert.match(source, /:lang="langForLyric\(visible\.next\.text\)"/);
  assert.match(source, /:lang="langForLyric\(visible\.next\.translation\)"/);
});

test("拖动层是 Pointer Events：capture + touch-action:none + 取消/失焦清理", () => {
  assert.match(source, /@pointerdown="onPointerDown"/);
  assert.doesNotMatch(source, /@mousedown="onMouseDown"/);
  assert.doesNotMatch(source, /addEventListener\("mousemove"/);
  assert.match(source, /setPointerCapture\(e\.pointerId\)/);
  assert.match(source, /addEventListener\("pointercancel"/);
  assert.match(source, /addEventListener\("lostpointercapture"/);
  assert.match(source, /addEventListener\("blur"/);
  // 拖动面本身关掉浏览器手势，触摸拖动不会被滚动/缩放截走。
  assert.match(source, /\.lyric-root \{[\s\S]*?touch-action: none;/);
  // 5px 阈值与锁定/双击语义不变。
  assert.match(source, /const DRAG_THRESHOLD_PX = 5;/);
  assert.match(source, /if \(prefs\.value\.locked\) return;/);
  assert.match(source, /function onDoubleClick/);
});

test("每帧擦色 20fps、桥接帧循环 33ms（不再 60fps 供 20fps 消费）", () => {
  assert.match(source, /const KARAOKE_PAINT_INTERVAL_MS = 50;/);
  assert.match(
    source,
    /if \(now - lastKaraokePaint >= KARAOKE_PAINT_INTERVAL_MS\)/,
  );
  assert.doesNotMatch(source, />= 33\)/);
  assert.match(bridgeSource, /const FRAME_INTERVAL_MS = 33;/);
  assert.match(
    bridgeSource,
    /if \(now - lastFrameTickAt >= FRAME_INTERVAL_MS\)/,
  );
});

test("快照去重：同一份时间轴不重复发送，显式握手仍强制重发", () => {
  assert.match(publisherSource, /function isDuplicateTimeline\(/);
  assert.match(publisherSource, /previous\.lines === identity\.lines/);
  assert.match(publisherSource, /previous\.tokensByLine === identity\.tokensByLine/);
  // 握手/子窗请求路径必须 force——那是真的没收到，必须重发。
  assert.match(publisherSource, /sendSnapshot\(\{ force: true \}\)/);
  // watcher 先做去重判断，再推进 revision（重复内容不推进、不清空子窗歌词）。
  assert.match(
    publisherSource,
    /if \(isDuplicateTimeline\(currentTimelineIdentity\(\)\)\) return;\s*\n\s*timelineRevision \+= 1;/,
  );
  // burst 重试节奏（子窗侧）保持原样。
  assert.match(bridgeSource, /SNAPSHOT_BURST_RETRY_DELAYS_MS = \[300, 900, 1_600, 2_400, 3_200\]/);
});

test("上下文安全带连一行都放不下时隐藏整槽（不再显示被裁半行）", () => {
  // 640×160、48px 当前行：带翻译时安全带实测 22–23 CSS → 整槽隐藏；
  // 不带翻译时仍有 32–33 CSS → 下一行照常显示（不回退既有能力）。
  const oneLineBand = 3 + 16 * 1.12 + 6; // = 26.92
  assert.equal(controls.contextBandFitsLine(oneLineBand, 16), true);
  assert.equal(controls.contextBandFitsLine(oneLineBand - 0.01, 16), false);
  assert.equal(controls.contextBandFitsLine(33, 16), true);
  assert.equal(controls.contextBandFitsLine(32, 16), true);
  assert.equal(controls.contextBandFitsLine(23, 16), false);
  assert.equal(controls.contextBandFitsLine(22, 16), false);
  // 小字号（安全带充裕）仍显示，避免把默认 32px 状态下的一行误藏。
  assert.equal(controls.contextBandFitsLine(41, 13.44), true);

  // 渲染条件用上判定：隐藏整个槽位而不是只隐藏翻译行。
  assert.match(source, /const contextBandFitsContextLine = computed\(/);
  assert.match(
    source,
    /v-if="visible\.next && prefs\.showPrevNext && contextBandFitsContextLine"/,
  );
  // 两行放得下才显示翻译行的既有逻辑保留。
  assert.match(source, /contextShowsTranslation/);
});

test("textColor 能力与 apply-prefs 死监听已移除，当前行固定白 95%", () => {
  assert.doesNotMatch(source, /textColor/);
  assert.doesNotMatch(source, /apply-prefs/);
  assert.doesNotMatch(source, /--lyric-text-color/);
  assert.doesNotMatch(prefsSource, /textColor/);
  assert.doesNotMatch(prefsSource, /apply-prefs/);
  // 固定白色阶梯（DESIGN 的白色 95%），不再有可配置文字色。
  assert.match(source, /\.current-lyric \{[\s\S]*?color: rgba\(255, 255, 255, 0\.95\);/);
});

test("每个工具条控件都有 aria-label + title，开关带 aria-pressed", () => {
  for (const helper of [
    "formatFontSizeLabel",
    "formatOpacityLabel",
    "formatPrevNextLabel",
    "formatLockLabel",
  ]) {
    assert.ok(
      source.includes(`:aria-label="${helper}(`),
      `${helper} 未用于 aria-label`,
    );
  }
  assert.ok(source.includes(`:title="formatFontSizeLabel(`));
  assert.ok(source.includes(`:title="formatOpacityLabel(`));
  assert.ok(source.includes(`:title="formatPrevNextLabel(`));
  assert.ok(source.includes(`:title="formatLockTitle(`));

  assert.match(source, /aria-label="关闭桌面歌词（需要从侧栏重新打开）"/);
  assert.match(source, /title="关闭桌面歌词/);

  // 锁定 / 上下行是两个开关：用 aria-pressed 暴露状态。
  assert.ok(
    [...source.matchAll(/:aria-pressed="/g)].length >= 2,
    "开关缺少 aria-pressed",
  );
});

test("有歌无歌词时歌名 chip 常驻，有歌词时仍跟随工具条", () => {
  assert.match(
    source,
    /const songInfoAlwaysVisible = computed\(\(\) => hasSong\.value && !hasLyric\.value\)/,
  );
  assert.match(source, /song-info--visible[^}]*songInfoAlwaysVisible/);
});

test("工具条仍是深色板世界：黑 60% + 12px blur + 白 90% + 白色焦点环", () => {
  assert.match(
    source,
    /class="toolbar[^"]*bg-black\/60[^"]*text-white\/90[^"]*"/,
  );
  assert.match(source, /backdrop-filter: blur\(12px\)/);
  assert.match(
    source,
    /\.toolbar-btn:focus-visible,[\s\S]*?outline: 2px solid #fff/,
  );
  // 不引入任何纸面 token（深色底板是唯一允许离开纸面的表面）。
  assert.doesNotMatch(
    source,
    /--color-(?:raised|bg|card|surface|text-primary|ink)/,
  );
});

test("工具条是绝对定位浮层，出现时不推挤歌词行（无 300px 让位）", () => {
  assert.match(source, /class="toolbar absolute/);
  assert.doesNotMatch(source, /toolbar-visible/);
  assert.doesNotMatch(source, /padding-right:\s*300px/);
});
