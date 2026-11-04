<script setup lang="ts">
// 独立桌面歌词窗口页面（PR2 升级）。
//
// 升级内容：
//   1. CSS 变量驱动字号 / 不透明度（通过 useLyricWindowPrefs）
//   2. 自定义拖动（Pointer Events → startDragging，锁定后禁用）
//   3. 双击切换锁定
//   4. Hover 工具条（字号 +/-、不透明度滑块、锁定、关闭）
//   5. 几何信息防抖持久化（useWindowGeometry）
//   6. Esc 只收起工具条，不销毁窗口；强退出只保留工具条关闭按钮

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Lock, Minus, Plus, Rows3, Sun, Unlock, X } from "@lucide/vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { useDesktopLyricsBridge } from "@/composables/useDesktopLyricsBridge";
import { useLyricWindowPrefs } from "@/composables/useLyricWindowPrefs";
import { useWindowGeometry } from "@/composables/useWindowGeometry";
import { createKaraokeFrameProjector } from "@/lyrics/lyricFrame";
import { contrastRatio, DEFAULT_DESKTOP_ACCENT } from "@/utils/themeTokens";
import { langForLyric } from "@/utils/lyricScript";

const {
  state,
  frame: lyricFrame,
  connectionStatus,
  connectionError,
} = useDesktopLyricsBridge();
const { prefs } = useLyricWindowPrefs();
useWindowGeometry(); // 防抖保存窗口位置/大小

const toolbarVisible = ref(false);
const rootRef = ref<HTMLElement | null>(null);

// =============== 本地绝对媒体时钟 + 独立时间轴定位 ===============
// 主窗只低频发送绝对时钟锚点；完整 lines/tokensByLine 在快照中只传一次。
// 子窗每帧由绝对位置自行二分切行，因此换行不依赖 IPC 到达时机。

const activeLineIndex = computed(() => lyricFrame.value.activeLineIndex);

const visible = computed(() => {
  const ls = state.value.lines;
  const idx = activeLineIndex.value;
  return {
    prev: idx > 0 ? ls[idx - 1] : null,
    current: idx >= 0 && idx < ls.length ? ls[idx] : null,
    next: idx + 1 < ls.length ? ls[idx + 1] : null,
  };
});

const hasSong = computed(() => !!state.value.songName);
const hasLyric = computed(() => state.value.lines.length > 0);
/** 有歌但没有歌词时歌名 chip 常驻，否则移开鼠标就不知道这是哪首歌；
 *  有歌词时仍只在工具条出现时显示，避免常驻遮挡桌面。 */
const songInfoAlwaysVisible = computed(() => hasSong.value && !hasLyric.value);

const placeholderText = computed(() => {
  // 首开握手：先明确「正在连接」，2.5s 未收到主窗快照升级为可见的重试提示。
  // 不能一上来就显示「等待播放…」——那只应在「已就绪且确实没有歌曲」时出现。
  if (connectionStatus.value === "connecting") return "正在连接桌面歌词…";
  if (connectionStatus.value === "retrying") {
    return connectionError.value || "歌词连接较慢，正在重试…";
  }
  if (!hasSong.value) return "等待播放…";
  if (!hasLyric.value) return "这首歌没有提供歌词";
  return "♪";
});

// =============== 卡拉 OK 逐字三态 ===============
//
// 每个 token 用 --char-pct 控制字内擦除：
//   - 已唱 (localProgressMs >= endMs) → 100%
//   - 未唱 (localProgressMs < startMs) → 0%
//   - 进行中 → (localProgressMs - startMs) / (endMs - startMs)
// 无 YRC token 时只显示行级歌词，不伪造看似精确的逐字动画。

const karaokeFrameProjector = createKaraokeFrameProjector();
// 卡拉OK擦色 20fps 节流：透明置顶窗的逐字重绘（每字 3 个节点 + clip-path +
// 描边阴影）是子窗光栅大头。DESIGN 只要求擦色跟得上演唱，20fps 与 30fps 无
// 肉眼差异，重绘次数再降三分之一；桥接帧循环同步降到 33ms（见 useDesktopLyricsBridge）。
const KARAOKE_PAINT_INTERVAL_MS = 50;
const karaokeProgressMs = ref(0);
let lastKaraokePaint = 0;
watch(
  () => lyricFrame.value.tokens,
  () => {
    // 换行立即投影，避免上一行进度泄漏到新行
    lastKaraokePaint = 0;
    karaokeProgressMs.value = lyricFrame.value.lineProgressMs;
  },
);
watch(
  () => lyricFrame.value.lineProgressMs,
  (ms) => {
    const now = performance.now();
    if (now - lastKaraokePaint >= KARAOKE_PAINT_INTERVAL_MS) {
      lastKaraokePaint = now;
      karaokeProgressMs.value = ms;
    }
  },
);
const projectedKaraokeFrame = computed(() =>
  karaokeFrameProjector.project(lyricFrame.value.tokens, karaokeProgressMs.value)
);

// =============== 上下文槽位：下一行 + 翻译（唯一槽位） ===============
//
// 上下文只保留一个槽位（下一行），固定在窗口右下：悬浮工具条在顶部右侧，
// 两者竖直方向隔着一整块当前行，工具条既盖不到它，也不需要 hover 让位
// （不重排任何歌词行）。跟唱最需要的是“接下来唱什么”，刚唱过的内容已经由
// 当前行的逐字擦色交代，所以上一行让位给下一行。
//
// 窗口固定 800×200（本机 125% 渲染下 160 CSS）：46–48px 字号时当前行底板下缘
// 到窗口底部只剩 30 CSS 左右，这条安全带必须实测——猜一个固定值就会把上下文
// 底板叠到当前行底板上（评审判定的“两块黑板压字”）。

const currentWrapRef = ref<HTMLElement | null>(null);
/** 上下文底板可用高度（px）；null = 尚未测量，先用 CSS 里的 44px 兜底。 */
const contextBandPx = ref<number | null>(null);
/** 底板底边距（与 .context-line 的 bottom 一致）与两板之间的呼吸距离。 */
const CONTEXT_BOTTOM_OFFSET_PX = 8;
const CONTEXT_BAND_GAP_PX = 2;
/** .context-line__stack 的内边距与 .context-line 的行高（与 CSS 同源）。 */
const CONTEXT_STACK_TOP_PAD_PX = 3;
const CONTEXT_STACK_BOTTOM_PAD_PX = 6;
/** 底边渐隐区（mask 的最后 6px）。它由 6px 下内边距承载，不额外再加一层。 */
const CONTEXT_MASK_BLEED_PX = 6;
const CONTEXT_LINE_HEIGHT = 1.12;
/** .context-line__translation 的 margin-top。 */
const CONTEXT_TRANSLATION_GAP_PX = 1;

function measureContextBand() {
  const wrap = currentWrapRef.value;
  const root = rootRef.value;
  if (!wrap || !root) return;
  const wrapBottom = wrap.getBoundingClientRect().bottom;
  const rootBottom = root.getBoundingClientRect().bottom;
  contextBandPx.value = Math.max(
    0,
    Math.floor(
      rootBottom - wrapBottom - CONTEXT_BOTTOM_OFFSET_PX - CONTEXT_BAND_GAP_PX,
    ),
  );
}

/** DESIGN：上下文行 clamp(11px, 42% × 当前字号, 16px)，翻译行 38% 字号。
 *  这里算出来既喂 CSS 变量，也用来判断两行能否放进安全带——单一来源，避免
 *  CSS 与脚本各写一份 clamp 后漂移。 */
function contextFontSize(fontSize: number, ratio: number): number {
  return Math.min(16, Math.max(11, fontSize * ratio));
}

const contextFontPx = computed(() => contextFontSize(prefs.value.fontSize, 0.42));
const contextTranslationFontPx = computed(() =>
  contextFontSize(prefs.value.fontSize, 0.38),
);

/** 安全带连一行上下文都放不下时（46–48px 且当前行自带翻译，实测只剩 22–23
 *  CSS），整个槽位不渲染，而不是塞半行被 6px 渐隐吃掉。判定用最省空间的一行：
 *  上内边距 + 一行字高 + 6px 渐隐区。no-translation 的 48px 情况实测 ≥32px，
 *  仍满足该门槛、照常显示下一行。 */
const contextBandFitsContextLine = computed(() => {
  const band = contextBandPx.value;
  if (band === null) return true; // 首次测量前先渲染，量到后一帧内收敛
  return contextBandFitsLine(
    band,
    contextFontPx.value,
    CONTEXT_STACK_TOP_PAD_PX,
    CONTEXT_MASK_BLEED_PX,
    CONTEXT_LINE_HEIGHT,
  );
});

/** 下一行 + 翻译两行连同上下内边距都放得下时才渲染翻译行；放不下（大字号，
 *  或当前行自己带翻译把安全带压得更窄）只保留下一行本身，不硬塞半行被裁的字。
 *  底边渐隐仍兜底更极端的情况（见 .context-line__stack）。 */
const contextShowsTranslation = computed(() => {
  if (!contextBandFitsContextLine.value) return false;
  const band = contextBandPx.value;
  if (band === null) return true; // 首次测量前先按两行渲染，量到后一帧内收敛
  const chromePx = CONTEXT_STACK_TOP_PAD_PX + CONTEXT_STACK_BOTTOM_PAD_PX;
  return (
    chromePx +
      contextFontPx.value * CONTEXT_LINE_HEIGHT +
      CONTEXT_TRANSLATION_GAP_PX +
      contextTranslationFontPx.value * CONTEXT_LINE_HEIGHT <=
    band
  );
});

// =============== CSS 变量 ===============

/** 封面强调色：优先跟随桥接状态（每次歌词推送都带最新色），事件通道作为补充 */
const accentColor = computed(() =>
  state.value.accentColor || DEFAULT_DESKTOP_ACCENT,
);

// =============== 桌面歌词可读性兜底（浅色桌面上白字只有约 1.1:1） ===============
//
// 透明窗口直接浮在任意壁纸上，白字 + 黑描边的老方案只在深色桌面成立。
// 这里给歌词文本加一块半透明深色底板（.lyric-plate，仍随窗口不透明度淡出），
// 并按"底板叠在最亮桌面（纯白）"这一最差样本反推已唱强调色的最低亮度：
//   - 底板 rgba(0,0,0,0.88) 叠在纯白桌面上 = #1F1F1F；
//   - 白字 95% 对底板 15.0:1 起，上下文（下一行 74% / 翻译 72%）白 9.2–9.7:1；
//   - 已唱强调色只向白色提亮、不换色相：全不透明时对底板 ≥5:1，并按当前整窗
//     不透明度与最亮桌面（纯白）重新合成，保证实际渲染仍 ≥4.6:1。
const LYRIC_PLATE_ALPHA = 0.88;
const LYRIC_ACCENT_MIN_CONTRAST = 5;
const LYRIC_ACCENT_MIN_CONTRAST_COMPOSITED = 4.6;
/** 底板叠在纯白桌面上时最亮，是强调色对比度的最差样本。 */
const LIGHTEST_PLATE_CHANNEL = Math.round(255 * (1 - LYRIC_PLATE_ALPHA));
const LIGHTEST_PLATE_HEX = `#${LIGHTEST_PLATE_CHANNEL.toString(16)
  .padStart(2, "0")
  .repeat(3)}`;

function parseHexChannels(value: string): [number, number, number] | null {
  const match = /^#([\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** 整窗不透明度 o 时，颜色从黑板层叠到纯白桌面后的等效色（WCAG 合成）。 */
function compositeOverLightestPlate(value: string, opacity: number): string {
  const channels = parseHexChannels(value);
  if (!channels) return value;
  return `#${channels
    .map((channel) =>
      Math.round(channel * opacity + 255 * (1 - opacity))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** 当前整窗不透明度下，文字对底板（叠纯白桌面）的真实对比度。 */
function contrastAtWindowOpacity(textHex: string, opacity: number): number {
  return contrastRatio(
    compositeOverLightestPlate(textHex, opacity),
    compositeOverLightestPlate(LIGHTEST_PLATE_HEX, opacity),
  );
}

/** 保持色相，只把强调色按比例推向白色，直到它在底板上达到对比度下限。 */
function ensureReadableAccent(value: string, groupOpacity: number): string {
  const channels = parseHexChannels(value);
  // 桥接状态始终是 deriveCoverTheme 产出的 hex；非 hex 输入保持原值。
  if (!channels) return value;
  for (let step = 0; step <= 100; step += 1) {
    const amount = step / 100;
    const hex = `#${channels
      .map((channel) => {
        const mixed = Math.round(channel + (255 - channel) * amount);
        return mixed.toString(16).padStart(2, "0");
      })
      .join("")}`;
    if (
      contrastRatio(hex, LIGHTEST_PLATE_HEX) >= LYRIC_ACCENT_MIN_CONTRAST &&
      contrastAtWindowOpacity(hex, groupOpacity) >=
        LYRIC_ACCENT_MIN_CONTRAST_COMPOSITED
    ) {
      return hex;
    }
  }
  return "#ffffff";
}

// 强调色随当前不透明度重新推导：滑块越低，已唱字越靠白，保证合成后仍可读。
const readableAccent = computed(() =>
  ensureReadableAccent(accentColor.value, prefs.value.opacity),
);

const cssVars = computed(() => ({
  "--lyric-font-size": `${prefs.value.fontSize}px`,
  "--lyric-opacity": String(prefs.value.opacity),
  "--color-accent": accentColor.value,
  // 深色半透明底板与可读强调色：见上方对比度说明。
  "--lyric-plate": `rgba(0, 0, 0, ${LYRIC_PLATE_ALPHA})`,
  "--lyric-accent": readableAccent.value,
  // 上下文槽位：字号公式与实测安全带（见 measureContextBand）。
  "--lyric-context-font-size": `${contextFontPx.value}px`,
  "--lyric-context-translation-size": `${contextTranslationFontPx.value}px`,
  "--lyric-context-band": `${contextBandPx.value ?? 44}px`,
}));

// =============== 工具条可测逻辑（纯函数） ===============
// 本段必须保持零依赖：不 import Vue/Tauri、不读浏览器 API。单测
// tests/desktopLyricsControls.test.mjs 会截取两个标记之间的源码转译后直接执行，
// 新增可测逻辑放这里并同步补测试。

type EscapeAction = "hide-toolbar" | "ignore";

interface EscapeContext {
  toolbarVisible: boolean;
}

/**
 * Esc 决策：工具条可见 → 只收起工具条；工具条已收起 → 忽略。
 *
 * 桌面歌词是置顶常驻窗，误按 Esc 让它从桌面上消失会直接打断正在看的歌词
 * （PRODUCT 原则 1「播放不被打断」）。强退出只保留工具条关闭按钮 onClose。
 */
function resolveEscapeAction(context: EscapeContext): EscapeAction {
  return context.toolbarVisible ? "hide-toolbar" : "ignore";
}

/** 不透明度读数：0.95 → "95%"（步进 0.05，四舍五入后最多三位数）。 */
function formatOpacityPercent(opacity: number): string {
  return `${Math.round(opacity * 100)}%`;
}

/** 不透明度滑块的完整标签（aria-label / title 共用，含当前值与操作方式）。 */
function formatOpacityLabel(opacity: number): string {
  return `不透明度 ${formatOpacityPercent(opacity)}，左右拖动调整`;
}

/** 下一行歌词开关的动作 + 当前状态；上一行不再显示，文案不能再说「上一行」。 */
function formatPrevNextLabel(show: boolean): string {
  return show
    ? "隐藏下一行歌词（当前已显示）"
    : "显示下一行歌词（当前已隐藏）";
}

/** 锁定开关的 aria-label：动作 + 当前状态，并写明锁定后窗口不可拖动。 */
function formatLockLabel(locked: boolean): string {
  return locked
    ? "解锁桌面歌词（当前已锁定，窗口不可拖动）"
    : "锁定桌面歌词（锁定后窗口不可拖动）";
}

/** 锁定开关的 title：在 label 基础上保留「双击歌词也可切换」这条既有操作提示。 */
function formatLockTitle(locked: boolean): string {
  return locked
    ? "解锁桌面歌词（当前已锁定，窗口不可拖动；双击歌词也可解锁）"
    : "锁定桌面歌词（锁定后窗口不可拖动；双击歌词也可锁定）";
}

/** 字号步进按钮的动作 + 当前字号。 */
function formatFontSizeLabel(
  direction: "increase" | "decrease",
  fontSize: number,
): string {
  return `${direction === "increase" ? "增大" : "减小"}字号（当前 ${fontSize}px）`;
}

/** 安全带能否容纳一行上下文：上内边距 + 一行字高 + 6px 底边渐隐区。
 *  返回 false 时整个上下文槽位不渲染——46–48px 且当前行带翻译时实测只剩
 *  22–23 CSS，硬塞进去只会得到被 mask 裁掉底部的半行。默认值与 CSS 的
 *  .context-line__stack / .context-line 同源；组件调用时传入上面的常量。 */
function contextBandFitsLine(
  bandPx: number,
  contextFontPx: number,
  topPadPx = 3,
  maskBleedPx = 6,
  lineHeight = 1.12,
): boolean {
  return topPadPx + contextFontPx * lineHeight + maskBleedPx <= bandPx;
}

// =============== 工具条可测逻辑结束 ===============

// =============== 超长当前行自适应 ===============
//
// 测量容器 = `.current-line-frame`：宽度被限制在窗口可用宽度内
// （width/max-width:100% + box-sizing:border-box + 左右 padding）。
// 文本不参与布局宽度测量之外的任何“撑开”——长行只做 transform 整体缩放，
// 且用 left:50% + translateX(-50%) 保证缩放前后都以容器中心对齐，
// 这样即使文本比容器宽也不会再向右溢出窗口被裁掉（旧实现只 scale 不居中，
// 长行在 800px 窗口右侧被直接裁切）。

const currentLineFrameRef = ref<HTMLElement | null>(null);
const currentTextRef = ref<HTMLElement | null>(null);
const translationTextRef = ref<HTMLElement | null>(null);
const currentLineScale = ref(1);
const translationLineScale = ref(1);
let lyricResizeObserver: ResizeObserver | null = null;

/**
 * 读取测量容器的真实内容宽度：clientWidth 含左右 padding，
 * 而 padding 正是长行两侧的安全区（描边/阴影/圆角），必须扣除。
 */
function measurementContentWidth(frame: HTMLElement | null): number {
  if (!frame) return 0;
  const style = getComputedStyle(frame);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(0, frame.clientWidth - paddingLeft - paddingRight);
}

function fitCurrentLine() {
  const frame = currentLineFrameRef.value;
  const text = currentTextRef.value;
  if (!frame || !text) {
    currentLineScale.value = 1;
    translationLineScale.value = 1;
    return;
  }

  const availableWidth = measurementContentWidth(frame);
  const naturalWidth = text.scrollWidth;
  currentLineScale.value =
    availableWidth > 0 && naturalWidth > 0
      ? Math.min(1, availableWidth / naturalWidth)
      : 1;

  // 翻译行与当前行共用同一个测量容器宽度；长翻译同样整体缩放不裁切。
  const translation = translationTextRef.value;
  const translationWidth = translation?.scrollWidth ?? 0;
  translationLineScale.value =
    availableWidth > 0 && translationWidth > 0
      ? Math.min(1, availableWidth / translationWidth)
      : 1;
}

// 文本的居中 + 缩放：translateX(-50%) 让元素中心落在 left:50% 处，
// 之后再以 transform-origin:center 缩放，中心不动、两侧对称收缩。
const currentTextStyle = computed(() => ({
  transform: `translateX(-50%) scale(${currentLineScale.value})`,
}));
const translationTextStyle = computed(() => ({
  transform: `translateX(-50%) scale(${translationLineScale.value})`,
}));

watch(
  () => [
    visible.value.current?.text,
    visible.value.current?.translation,
    // 同一行从「无逐字」切到「有逐字」时渲染树的字形宽度会变，需要重测。
    projectedKaraokeFrame.value.tokens.length,
    // 连接/等待/空态文案也会变化长度，同样需要重新缩放。
    placeholderText.value,
    prefs.value.fontSize,
  ],
  () => void nextTick(() => {
    fitCurrentLine();
    // 当前行底板的高度（受字号/翻译影响）就是上下文槽位的可用上界。
    measureContextBand();
  }),
  { flush: "post" },
);

// =============== 生命周期 ===============

onMounted(() => {
  lyricResizeObserver = new ResizeObserver(() => {
    fitCurrentLine();
    measureContextBand();
  });
  if (currentLineFrameRef.value) {
    lyricResizeObserver.observe(currentLineFrameRef.value);
  }
  void nextTick(() => {
    fitCurrentLine();
    measureContextBand();
  });

  // Escape 键收起工具条（不销毁窗口）
  window.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  lyricResizeObserver?.disconnect();
  lyricResizeObserver = null;
  window.removeEventListener("keydown", onKeyDown);
  _cleanupDragListeners();
});

// 锁定状态变化 → 通知主窗
watch(
  () => prefs.value.locked,
  (v) => {
    void emit("desktop-lyrics:control", { action: "lock", value: v }).catch(
      () => {},
    );
  },
);

// =============== 交互 ===============
//
// 拖拽策略：不在 pointerdown 立即调用 startDragging（那样会阻塞 dblclick 等
// 事件），而是等指针实际移动超过 5px 阈值后才启动拖拽；短点击 / 双击切换锁定
// 不受影响。监听用 Pointer Events + setPointerCapture：鼠标、触摸、触控笔走
// 同一条路径，指针移出窗口后仍能收到 move/up，且 pointercancel /
// lostpointercapture / blur 都会复位，不会留下半途的拖拽状态。
// 拖动面（.lyric-root）同时声明 touch-action: none，触摸拖动不会先被滚动/缩放
// 手势截走。

let _dragPointerId: number | null = null;
let _dragStartX = 0;
let _dragStartY = 0;

const DRAG_THRESHOLD_PX = 5;

function _onDragMove(ev: PointerEvent) {
  if (_dragPointerId === null || ev.pointerId !== _dragPointerId) return;
  const dx = ev.clientX - _dragStartX;
  const dy = ev.clientY - _dragStartY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
    _cleanupDragListeners();
    getCurrentWindow().startDragging().catch((e) => {
      // 拖拽是用户显式手势，失败时表现为"拖不动"；不记录就完全看不出原因。
      console.warn("[desktop-lyrics] startDragging 失败", e);
    });
  }
}

/** pointerup / pointercancel / lostpointercapture / window blur 共用：只复位，
 *  不触发拖拽之外的任何状态（锁定与双击语义不变）。 */
function _onDragEnd() {
  _cleanupDragListeners();
}

function _cleanupDragListeners() {
  const root = rootRef.value;
  if (root) {
    root.removeEventListener("pointermove", _onDragMove);
    root.removeEventListener("pointerup", _onDragEnd);
    root.removeEventListener("pointercancel", _onDragEnd);
    root.removeEventListener("lostpointercapture", _onDragEnd);
    if (_dragPointerId !== null && root.hasPointerCapture(_dragPointerId)) {
      root.releasePointerCapture(_dragPointerId);
    }
  }
  window.removeEventListener("blur", _onDragEnd);
  _dragPointerId = null;
}

function onPointerDown(e: PointerEvent) {
  if (prefs.value.locked) return;
  // 主指针之外（多指触摸的第二指）不参与窗口拖动。
  if (!e.isPrimary) return;
  // 鼠标只认主键；触摸/触控笔的 button 恒为 0。
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if ((e.target as HTMLElement).closest("[data-toolbar]")) return;
  const root = rootRef.value;
  if (!root) return;
  _dragPointerId = e.pointerId;
  _dragStartX = e.clientX;
  _dragStartY = e.clientY;
  // 监听挂在根节点上并捕获指针：移出窗口后 move/up 仍会派发到这里。
  root.addEventListener("pointermove", _onDragMove);
  root.addEventListener("pointerup", _onDragEnd);
  root.addEventListener("pointercancel", _onDragEnd);
  root.addEventListener("lostpointercapture", _onDragEnd);
  window.addEventListener("blur", _onDragEnd);
  try {
    root.setPointerCapture(e.pointerId);
  } catch (err) {
    // WebKitGTK 在极少见的指针状态下可能拒绝捕获；此时仍有 window blur 兜底。
    console.warn("[desktop-lyrics] setPointerCapture 失败", err);
  }
}

function onDoubleClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest("[data-toolbar]")) return;
  prefs.value.locked = !prefs.value.locked;
}

function onMouseLeave() {
  const focused = document.activeElement;
  const toolbar = rootRef.value?.querySelector<HTMLElement>("[data-toolbar]");
  if (!focused || !toolbar?.contains(focused)) {
    if (focused === rootRef.value) rootRef.value?.blur();
    toolbarVisible.value = false;
  }
}

function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget;
  if (!(next instanceof Node) || !rootRef.value?.contains(next)) {
    toolbarVisible.value = false;
  }
}

/** 关闭桌面歌词窗口。
 * 用户显式点击关闭按钮 → 直接 destroy 绕过 close-requested 路径。
 * Tauri v2 中只要注册了 close-requested 监听器就会自动 prevent_close，
 * 导致 close() 静默失败。destroy() 不触发 close-requested，是 force-kill。
 * 主窗 store 通过 tauri://destroyed 事件自动同步 isOpen 状态。 */
async function onClose() {
  try {
    await getCurrentWindow().destroy();
  } catch (e) {
    // destroy 失败时退回到 close
    console.warn("[desktop-lyrics] destroy 失败，尝试 close:", e);
    try {
      await getCurrentWindow().close();
    } catch (e2) {
      console.warn("[desktop-lyrics] 关闭窗口失败:", e2);
    }
  }
}

/** Escape 键：只收起工具条；工具条已收起时忽略——绝不销毁整窗。
 *  强退出只保留工具条关闭按钮（onClose），避免误按 Esc 让桌面歌词凭空消失。 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const action = resolveEscapeAction({ toolbarVisible: toolbarVisible.value });
  if (action === "ignore") return;
  e.preventDefault();
  // 焦点在工具条按钮上时先归还根容器；focusin 会把工具条重新打开，所以最后再置 false。
  const toolbar = rootRef.value?.querySelector<HTMLElement>("[data-toolbar]");
  if (toolbar?.contains(document.activeElement)) rootRef.value?.focus();
  toolbarVisible.value = false;
}

function onFontSizeChange(delta: number) {
  prefs.value.fontSize = Math.max(14, Math.min(48, prefs.value.fontSize + delta));
}
</script>

<template>
  <div
    ref="rootRef"
    class="lyric-root relative flex flex-col items-center justify-center h-screen select-none"
    :style="cssVars"
    tabindex="0"
    role="region"
    aria-label="桌面歌词，按 Tab 可调整显示设置"
    @pointerdown="onPointerDown"
    @dblclick="onDoubleClick"
    @mouseenter="toolbarVisible = true"
    @mouseleave="onMouseLeave"
    @focusin="toolbarVisible = true"
    @focusout="onFocusOut"
  >
    <!-- 歌词内容层（受 --lyric-opacity 影响；工具栏在同层但在外） -->
    <div class="lyric-content flex flex-col items-center justify-center">
      <!-- 上下文只保留一个槽位：下一行（右下）。上一行放在左上时，64% 宽会伸进
           悬停工具条（顶部右侧）下面；而跟唱最需要的是“接下来唱什么”，刚唱过的
           内容已经由当前行的逐字擦色交代。 -->

      <!-- 当前行（卡拉OK 逐字）；currentWrapRef 用于实测上下文槽位的安全带高度 -->
      <div ref="currentWrapRef" class="current-wrap lyric-plate">
        <!-- 测量容器：宽度限制在窗口可用宽度内；当前行/翻译在其中整体缩放，
             永不横向裁切或滚动（见 fitCurrentLine）。 -->
        <div ref="currentLineFrameRef" class="current-line-frame">
          <h1
            v-if="visible.current && projectedKaraokeFrame.tokens.length > 0"
            class="current-lyric current-line-scaled text-transparent font-semibold leading-tight"
            :lang="langForLyric(visible.current.text)"
            :aria-label="visible.current.text"
          >
            <span
              ref="currentTextRef"
              class="lyric-karaoke"
              :style="currentTextStyle"
              dir="auto"
              aria-hidden="true"
            >
              <!-- 逐字：每个字独立双层 span，靠 --char-pct 控制字内擦除
                   （曾改为单 span background-clip:text + 容器 drop-shadow，
                    与 Chromium 渲染冲突导致文字看不清，回退双层方案） -->
              <span
                v-for="(c, i) in projectedKaraokeFrame.tokens"
                :key="i"
                class="lyric-char"
                :style="{ '--char-pct': `${(c.progress * 100).toFixed(2)}%` }"
              >
                <span class="lyric-char__sung">{{ c.char }}</span>
                <span class="lyric-char__pending">{{ c.char }}</span>
              </span>
            </span>
          </h1>
          <h1
            v-else-if="visible.current && visible.current.text"
            class="current-lyric current-line-scaled font-semibold leading-tight"
            :lang="langForLyric(visible.current.text)"
          >
            <!-- 无精确时间戳时展示稳定文本，不伪造逐字进度。 -->
            <span
              ref="currentTextRef"
              class="plain-current-text"
              :style="currentTextStyle"
            >
              {{ visible.current.text }}
            </span>
          </h1>
          <h1
            v-else
            class="current-lyric current-line-scaled placeholder-lyric font-semibold leading-tight"
            role="status"
            aria-live="polite"
          >
            <!-- 连接/等待/空态文案同样走测量容器整体缩放，长提示不会被裁掉。 -->
            <span
              ref="currentTextRef"
              class="plain-current-text placeholder-text"
              :style="currentTextStyle"
            >{{ placeholderText }}</span>
          </h1>
          <!-- 翻译行（外文歌双语显示） -->
          <p
            v-if="visible.current && visible.current.translation"
            class="translation-line"
            :lang="langForLyric(visible.current.translation)"
          >
            <span
              ref="translationTextRef"
              class="translation-text"
              :style="translationTextStyle"
            >{{ visible.current.translation }}</span>
          </p>
        </div>
      </div>

      <!-- 下一行（上下文唯一槽位，右下）：下一行与它的翻译同属一块底板，
           翻译在下一行下面单独一行，不再各占一块并排的“黑板”。
           宽度上限 64%、最多两行，超宽/超高都用 mask 渐隐收口，不用省略号。 -->
      <!-- 安全带连一行都放不下时整槽隐藏（见 contextBandFitsContextLine），
           而不是把下一行裁成半行。 -->
      <p
        v-if="visible.next && prefs.showPrevNext && contextBandFitsContextLine"
        class="context-line lyric-plate"
        :lang="langForLyric(visible.next.text)"
      >
        <span class="context-line__stack">
          <span class="context-line__text">{{ visible.next.text }}</span>
          <span
            v-if="visible.next.translation && contextShowsTranslation"
            class="context-line__translation"
            :lang="langForLyric(visible.next.translation)"
          >{{ visible.next.translation }}</span>
        </span>
      </p>

      <!-- 歌曲信息：有歌但没有歌词时（"这首歌没有提供歌词"）常驻，
           否则只在工具条出现时显示，避免长期遮挡桌面。 -->
      <p
        v-if="hasSong"
        class="song-info lyric-plate truncate"
        :class="{ 'song-info--visible': toolbarVisible || songInfoAlwaysVisible }"
      >
        {{ state.songName }}<span v-if="state.artists" class="ml-2">— {{ state.artists }}</span>
      </p>
    </div>

    <!-- 工具条（hover / 键盘聚焦时显示；绝对定位浮层，出现时不推挤歌词行） -->
    <div
      v-show="toolbarVisible"
      data-toolbar
      class="toolbar absolute top-2 right-2 flex items-center rounded-lg bg-black/60 text-white/90 text-xs"
      role="toolbar"
      aria-label="桌面歌词显示设置"
    >
      <!-- 字号 - -->
      <button
        type="button"
        class="toolbar-btn"
        :title="formatFontSizeLabel('decrease', prefs.fontSize)"
        :aria-label="formatFontSizeLabel('decrease', prefs.fontSize)"
        @click="onFontSizeChange(-2)"
        @mousedown.stop
      >
        <Minus :size="16" :stroke-width="2" aria-hidden="true" />
      </button>

      <span class="w-8 text-center tabular-nums">{{ prefs.fontSize }}px</span>

      <!-- 字号 + -->
      <button
        type="button"
        class="toolbar-btn"
        :title="formatFontSizeLabel('increase', prefs.fontSize)"
        :aria-label="formatFontSizeLabel('increase', prefs.fontSize)"
        @click="onFontSizeChange(2)"
        @mousedown.stop
      >
        <Plus :size="16" :stroke-width="2" aria-hidden="true" />
      </button>

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 不透明度：太阳图标 + 百分比读数（可见标签，不再只靠 title）；
           滑块整块 24px 高都能拖，视觉轨道仍是 4px（见 .opacity-slider）。
           下限 0.9：再低已唱强调色与白字阶梯无法同时满足 AA（见 useLyricWindowPrefs）。
           工具条整块通过 [data-toolbar] 从窗口拖动中排除，原生滑块拖动不受影响。 -->
      <div class="opacity-control">
        <span class="opacity-icon" aria-hidden="true">
          <Sun :size="16" :stroke-width="2" aria-hidden="true" />
        </span>
        <input
          type="range"
          min="0.9"
          max="1"
          step="0.05"
          :value="prefs.opacity"
          class="opacity-slider"
          :title="formatOpacityLabel(prefs.opacity)"
          :aria-label="formatOpacityLabel(prefs.opacity)"
          :aria-valuetext="formatOpacityPercent(prefs.opacity)"
          @input="prefs.opacity = Number(($event.target as HTMLInputElement).value)"
        />
        <span class="opacity-value tabular-nums" aria-hidden="true">{{ formatOpacityPercent(prefs.opacity) }}</span>
      </div>

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 上下文行开关 -->
      <button
        type="button"
        class="toolbar-btn"
        :class="{ 'is-active': prefs.showPrevNext }"
        :aria-pressed="prefs.showPrevNext"
        :aria-label="formatPrevNextLabel(prefs.showPrevNext)"
        :title="formatPrevNextLabel(prefs.showPrevNext)"
        @click="prefs.showPrevNext = !prefs.showPrevNext"
        @mousedown.stop
      >
        <Rows3 :size="16" :stroke-width="2" aria-hidden="true" />
      </button>

      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 锁定开关 -->
      <button
        type="button"
        class="toolbar-btn"
        :aria-pressed="prefs.locked"
        :aria-label="formatLockLabel(prefs.locked)"
        :title="formatLockTitle(prefs.locked)"
        @click="prefs.locked = !prefs.locked"
        @mousedown.stop
      >
        <!-- Lock icon when locked -->
        <Lock v-if="prefs.locked" :size="16" :stroke-width="2" aria-hidden="true" />
        <!-- Unlock icon when unlocked -->
        <Unlock v-else :size="16" :stroke-width="2" aria-hidden="true" />
      </button>

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 关闭：桌面歌词的唯一强退出路径（Esc 只收起工具条，不销毁窗口） -->
      <button
        type="button"
        class="toolbar-btn"
        title="关闭桌面歌词（窗口关闭，需从侧栏重新打开）"
        aria-label="关闭桌面歌词（需要从侧栏重新打开）"
        @click="onClose"
        @mousedown.stop
      >
        <X :size="16" :stroke-width="2" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style>
/* 透明背景 + 去除默认边距 */
html,
body,
#app {
  background: transparent !important;
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

/* 透明底：除深色底板 .lyric-plate 外，歌词内容区内所有元素强制透明，
   让文字（与底板）直接浮在桌面上。底板是为了浅色桌面上的可读性，
   是透明窗里唯一的不透明层，见下方 .lyric-plate。 */
.lyric-content {
  background: transparent !important;
}

.lyric-content *:not(.lyric-plate) {
  background: transparent !important;
}

/* 深色半透明底板：透明窗内唯一的不透明层。
   白字在浅色壁纸上只有约 1.1:1，底板把文字局部背景压到近黑后达到
   15:1 起；12% 透出桌面保留透明感。1px 内嵌白色描边 + 浮影让底板在
   深色桌面上也有明确边界（不依赖任何主题 token，见 --lyric-plate）。 */
.lyric-plate {
  background: var(--lyric-plate, rgb(0 0 0 / 88%));
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 22%),
    0 2px 10px rgb(0 0 0 / 32%);
}

* {
  user-select: none;
  -webkit-user-select: none;
}

/* 歌词根容器：融入桌面，无背景/边框/投影；不透明度由 .lyric-content 层控制。
   它是 role="region" 的命名容器（aria-label：桌面歌词，按 Tab 可调整显示设置），
   也是窗口的拖动面，所以声明 touch-action: none——触摸/触控笔拖动不会被浏览器的
   滚动/缩放手势截走（Pointer Events 见 onPointerDown）。 */
.lyric-root {
  width: 100%;
  max-width: 100vw;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  touch-action: none;
}

/* 首次键盘焦点（Tab 进入窗口主体）的可见提示：透明窗没有页面底色可描边，
   给当前行黑板加 2px 内嵌白环——与工具条按钮的白色焦点环同一套语言，且不
   依赖桌面壁纸颜色。用 outline（负 offset 内嵌）而不是 box-shadow：强制颜色
   模式下 shadow 会被丢掉，outline 会映射成系统焦点色。
   鼠标点击不触发（:focus-visible），工具条自身仍有焦点环。 */
.lyric-root:focus-visible .current-wrap {
  outline: 2px solid rgb(255 255 255 / 92%);
  outline-offset: -2px;
}

/* 工具条是绝对定位浮层：出现/隐藏不改变歌词布局，避免 hover 时歌词行被推挤/缩放。 */

/* 上下文槽位（只保留一个：下一行 + 翻译），固定在窗口右下。
   悬浮工具条在顶部右侧，两者竖直方向隔着一整块当前行：工具条出现时盖不到它，
   也不需要 hover 让位（不重排任何歌词行）。
   宽度上限 64%：窗口 640 CSS 时约 410px，是安全区 596px 的 69%，落在 DESIGN
   的 60–70% 带内；高度上限是实测安全带（当前行底板下缘到窗口底部），保证
   上下文底板永远不压到当前行底板（大字号下这段空间只有 30 CSS 左右）。 */
.context-line {
  position: absolute;
  right: 18px;
  bottom: 8px;
  z-index: 1;
  box-sizing: border-box;
  /* 宽度跟着内容走：短句仍是一块贴住右缘的小底板，长句才用满 64%。 */
  width: max-content;
  max-width: 64%;
  max-height: var(--lyric-context-band, 44px);
  margin: 0;
  padding: 0;
  overflow: hidden;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.74);
  font-size: var(--lyric-context-font-size, 16px);
  font-weight: 500;
  line-height: 1.12;
  text-align: left;
  pointer-events: none;
}

/* 内容层负责收口：底边 6px 渐隐。mask 放在内容层而不是底板上，所以底板的
   内嵌描边与 6px 圆角永远完整；6px 同时是下内边距，正常两行内容不会被渐隐
   吃掉，只有被安全带裁掉时才看得到这层淡出。 */
.context-line__stack {
  display: block;
  max-height: inherit;
  padding: 3px 0 6px 10px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 6px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 6px), transparent);
}

/* 文本行：右缘 14px 渐隐代替省略号（不用 text-overflow / line-clamp 的省略号）。
   14px 同时是右内边距，正常长度不会被吃掉；超长时墨迹进入内边距、在底板内侧淡出。 */
.context-line__text,
.context-line__translation {
  display: block;
  padding-right: 14px;
  overflow: hidden;
  white-space: nowrap;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
}

/* 翻译：与下一行同一块底板，单独一行；沿用文档的 72% 白与 38% 字号。 */
.context-line__translation {
  margin-top: 1px;
  color: rgba(255, 255, 255, 0.72);
  font-size: var(--lyric-context-translation-size, 12px);
}

.current-wrap {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  /* 底板的内边距：给文字留出呼吸区，也覆盖文本描边/阴影的安全区。 */
  padding: 8px 16px;
  overflow: visible;
  box-sizing: border-box;
  border-radius: 12px;
  gap: 2px;
}

/* 当前行/翻译的测量容器：宽度永远不超过窗口可用宽度。
   fitCurrentLine 用它的内容宽度（扣掉左右 padding）作为缩放基准；
   文本超出时只做 transform 缩放，布局宽度不会被长行撑开。 */
.current-line-frame {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  box-sizing: border-box;
  /* 长行缩放后的横向安全区（描边 0.55px + 6px 阴影 + 圆角余量）。 */
  padding-inline: 12px;
}

.current-lyric {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 4px 0;
  overflow: visible;
  box-sizing: border-box;
  font-size: var(--lyric-font-size, 28px);
  /* 固定白 95%：歌词文字颜色不可配置（DESIGN 的白色阶梯是唯一来源）。 */
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.06;
}

/* 只有带缩放文本的行需要左对齐的静态位置：
   left:50% + translateX(-50%) 的居中依赖静态位置从容器左缘开始。 */
.current-line-scaled {
  text-align: left;
}

/* 歌曲信息：左上角。右下整条安全带留给上下文槽位（一条 60–70% 宽的底板），
   左上在上下文独占下一行后已经空出来；工具条在右上，640 CSS 下两者相隔足够远。
   有歌但没有歌词时常驻，否则只在工具条出现时显示，避免长期遮挡桌面。 */
.song-info {
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  top: 8px;
  left: 18px;
  max-width: 38%;
  margin: 0;
  padding: 2px 8px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.64);
  font-size: clamp(11px, calc(var(--lyric-font-size, 28px) * 0.3), 12px);
  line-height: 1.15;
  text-align: left;
  opacity: 0;
  transform: translateY(3px);
  transition:
    opacity 160ms ease,
    transform 180ms ease;
  pointer-events: none;
}

.song-info--visible {
  opacity: 1;
  transform: translateY(0);
}

/* 翻译行（外文歌双语）：小字号、半透，位于当前行与歌曲信息之间 */
.translation-line {
  position: relative;
  width: 100%;
  max-width: 100%;
  margin: 0;
  overflow: visible;
  box-sizing: border-box;
  /* 静态位置从容器左缘开始，配合 translateX(-50%) 做确定性居中。 */
  text-align: left;
  color: rgba(255, 255, 255, 0.72);
  font-size: clamp(11px, calc(var(--lyric-font-size, 28px) * 0.38), 16px);
  font-weight: 500;
  line-height: 1.15;
}

.translation-text {
  display: inline-block;
  position: relative;
  left: 50%;
  white-space: nowrap;
  transform-origin: center center;
  transition: transform 0.15s ease-out;
}

.context-line,
.translation-line,
.song-info {
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.96),
    0 0 5px rgba(0, 0, 0, 0.78);
  -webkit-text-stroke: 0.3px rgba(0, 0, 0, 0.76);
  paint-order: stroke fill;
}

/* 滑块控制的整窗歌词不透明度：只作用于歌词内容层，不影响工具栏背景 */
.lyric-content {
  position: relative;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-width: 0;
  padding: 7px 22px;
  overflow: hidden;
  box-sizing: border-box;
  opacity: var(--lyric-opacity, 1);
  transition: opacity 0.15s linear;
}

/* 卡拉OK 容器：inline-block + relative，子层 absolute 才能对齐。
   left:50% + translateX(-50%) 让缩放中心恒为测量容器中心：
   文本比容器宽时向两侧对称溢出（而不是只向右溢出窗口被裁掉）。 */
.lyric-karaoke {
  display: inline-block;
  position: relative;
  left: 50%;
  white-space: nowrap;
  transform-origin: center center;
  transition: transform 0.15s ease-out;
}

.plain-current-text {
  display: inline-block;
  position: relative;
  left: 50%;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.95);
  transform-origin: center center;
  transition: transform 0.15s ease-out;
}

.placeholder-lyric {
  color: rgba(255, 255, 255, 0.78);
}

/* 连接/等待/空态文案使用与占位符一致的白 78%，并同样参与整体缩放。 */
.placeholder-text {
  color: rgba(255, 255, 255, 0.78);
}

/* 逐字：每个字独立双层 span，靠 --char-pct 控制字内擦除。
   不加 transition：rAF 每帧更新 pct，CSS 补间反而会引入延迟让逐字失同步。 */
.lyric-char {
  display: inline-block;
  position: relative;
  white-space: pre;
}

.lyric-char__sung {
  display: inline-block;
  /* 已唱字：强调色按底板对比度派生（只提亮、不换色相），保证浅色桌面上
     底板内的已唱字仍 ≥4.5:1；--color-accent 仍用于工具条等黑底控件。 */
  color: var(--lyric-accent, var(--color-accent, #d65d0e));
  clip-path: inset(0 calc(100% - var(--char-pct, 0%)) 0 0);
}

.lyric-char__pending {
  position: absolute;
  inset: 0;
  display: inline-block;
  color: rgba(255, 255, 255, 0.94);
  pointer-events: none;
  clip-path: inset(0 0 0 var(--char-pct, 0%));
}

.plain-current-text,
.placeholder-lyric,
.lyric-char__sung,
.lyric-char__pending {
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.98),
    0 0 6px rgba(0, 0, 0, 0.84),
    0 0 1px rgba(255, 255, 255, 0.2);
  -webkit-text-stroke: 0.55px rgba(0, 0, 0, 0.9);
  paint-order: stroke fill;
}

.lyric-karaoke:dir(rtl) .lyric-char__sung {
  clip-path: inset(0 0 0 calc(100% - var(--char-pct, 0%)));
}

.lyric-karaoke:dir(rtl) .lyric-char__pending {
  clip-path: inset(0 var(--char-pct, 0%) 0 0);
}

/* 工具条按钮样式 */
.toolbar {
  z-index: 4;
  max-width: calc(100% - 16px);
  gap: 4px;
  padding: 6px 8px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 8px 24px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* 工具条按钮：24×24 命中区（≥24 可点），视觉仍是 4px 圆角小方钮。
   图标 16px，与 24px 方钮的留白比例接近旧版 14px/20px。 */
.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.toolbar-btn.is-active {
  color: #fff;
  background: color-mix(in srgb, var(--color-accent) 58%, transparent);
}

.toolbar-btn:focus-visible,
.opacity-slider:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* 不透明度控件：太阳图标 + 百分比读数构成可见标签（不再只靠 title）；
   整块 24px 高便于点按，滑块本体透明，只有 4px 轨道可见（track 伪元素），
   所以命中区是 24px 高、视觉轨道仍是 DESIGN 的 4px。 */
.opacity-control {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
}

.opacity-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
  pointer-events: none;
}

.opacity-value {
  min-width: 30px;
  color: rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;
  text-align: right;
  pointer-events: none;
}

.opacity-slider {
  appearance: none;
  -webkit-appearance: none;
  width: 56px;
  height: 24px;
  margin: 0;
  padding: 0;
  background: transparent;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  vertical-align: middle;
}

/* 视觉轨道仍是 4px：input 本身 24px 高（拖拽命中区），轨道由本伪元素绘制。 */
.opacity-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
}

.opacity-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  /* (4px 轨道 - 10px 拇指) / 2：让拇指在轨道上垂直居中。 */
  margin-top: -3px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  border: none;
  cursor: pointer;
}
</style>
