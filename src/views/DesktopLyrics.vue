<script setup lang="ts">
// 独立桌面歌词窗口页面（PR2 升级）。
//
// 升级内容：
//   1. CSS 变量驱动字号 / 不透明度 / 颜色（通过 useLyricWindowPrefs）
//   2. 自定义拖动（mousedown → startDragging，锁定后禁用）
//   3. 双击切换锁定
//   4. Hover 工具条（字号 +/-、不透明度滑块、锁定、关闭）
//   5. 几何信息防抖持久化（useWindowGeometry）
//   6. 监听主窗 apply-prefs 事件（同步主窗设置面板）

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useDesktopLyricsBridge } from "@/composables/useDesktopLyricsBridge";
import { useLyricWindowPrefs } from "@/composables/useLyricWindowPrefs";
import { useWindowGeometry } from "@/composables/useWindowGeometry";
import { createKaraokeFrameProjector } from "@/lyrics/lyricFrame";
import { contrastRatio, DEFAULT_DESKTOP_ACCENT } from "@/utils/themeTokens";

const {
  state,
  frame: lyricFrame,
  connectionStatus,
  connectionError,
} = useDesktopLyricsBridge();
const { prefs, apply: applyPrefs } = useLyricWindowPrefs();
useWindowGeometry(); // 防抖保存窗口位置/大小

const unlistens: UnlistenFn[] = [];
const toolbarVisible = ref(false);
const rootRef = ref<HTMLElement | null>(null);
let disposed = false;

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
// 卡拉OK擦色 30fps 节流（与主窗一致）：透明置顶窗的逐字重绘是子窗光栅大头，
// 30fps 擦除无肉眼差异，重绘次数减半。
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
    if (now - lastKaraokePaint >= 33) {
      lastKaraokePaint = now;
      karaokeProgressMs.value = ms;
    }
  },
);
const projectedKaraokeFrame = computed(() =>
  karaokeFrameProjector.project(lyricFrame.value.tokens, karaokeProgressMs.value)
);

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
//   - 白字 95% 对底板 15.0:1 起，上下文 62–74% 白 7.1–9.7:1（全窗口不透明度）；
//   - 已唱强调色只向白色提亮、不换色相，保证 ≥5:1（默认不透明度 0.95 下仍 ≥4.6）。
const LYRIC_PLATE_ALPHA = 0.88;
const LYRIC_ACCENT_MIN_CONTRAST = 5;
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

/** 保持色相，只把强调色按比例推向白色，直到它在底板上达到对比度下限。 */
function ensureReadableAccent(value: string): string {
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
    if (contrastRatio(hex, LIGHTEST_PLATE_HEX) >= LYRIC_ACCENT_MIN_CONTRAST) {
      return hex;
    }
  }
  return "#ffffff";
}

const readableAccent = computed(() => ensureReadableAccent(accentColor.value));

const cssVars = computed(() => ({
  "--lyric-font-size": `${prefs.value.fontSize}px`,
  "--lyric-opacity": String(prefs.value.opacity),
  "--lyric-text-color": prefs.value.textColor,
  "--color-accent": accentColor.value,
  // 深色半透明底板与可读强调色：见上方对比度说明。
  "--lyric-plate": `rgba(0, 0, 0, ${LYRIC_PLATE_ALPHA})`,
  "--lyric-accent": readableAccent.value,
}));

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
    toolbarVisible.value,
  ],
  () => void nextTick(fitCurrentLine),
  { flush: "post" },
);

// =============== 生命周期 ===============

onMounted(async () => {
  disposed = false;
  lyricResizeObserver = new ResizeObserver(() => fitCurrentLine());
  if (currentLineFrameRef.value) {
    lyricResizeObserver.observe(currentLineFrameRef.value);
  }
  void nextTick(fitCurrentLine);

  // 监听主窗配置推送
  const stopPrefs = await listen<Partial<typeof prefs.value>>(
    "desktop-lyrics:apply-prefs",
    (e) => {
      if (!disposed) applyPrefs(e.payload);
    },
  );
  if (disposed) {
    stopPrefs();
    return;
  }
  unlistens.push(stopPrefs);

  // Escape 键关闭
  window.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  disposed = true;
  lyricResizeObserver?.disconnect();
  lyricResizeObserver = null;
  unlistens.forEach((u) => u());
  unlistens.length = 0;
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
// 拖拽策略：不在 mousedown 立即调用 startDragging（那样会阻塞 dblclick 等事件），
// 而是监听 mousemove，只有鼠标实际移动超过 5px 阈值后才启动拖拽。
// 短点击 / 双击切换锁定不受影响。

let _dragStartX = 0;
let _dragStartY = 0;
let _dragMoved = false;

const DRAG_THRESHOLD_PX = 5;

function _onDragMove(ev: MouseEvent) {
  if (_dragMoved) return;
  const dx = ev.clientX - _dragStartX;
  const dy = ev.clientY - _dragStartY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
    _dragMoved = true;
    _cleanupDragListeners();
    getCurrentWindow().startDragging().catch((e) => {
      // 拖拽是用户显式手势，失败时表现为"拖不动"；不记录就完全看不出原因。
      console.warn("[desktop-lyrics] startDragging 失败", e);
    });
  }
}

function _onDragUp() {
  _cleanupDragListeners();
}

function _cleanupDragListeners() {
  window.removeEventListener("mousemove", _onDragMove);
  window.removeEventListener("mouseup", _onDragUp);
}

function onMouseDown(e: MouseEvent) {
  if (prefs.value.locked) return;
  if ((e.target as HTMLElement).closest("[data-toolbar]")) return;
  _dragStartX = e.clientX;
  _dragStartY = e.clientY;
  _dragMoved = false;
  window.addEventListener("mousemove", _onDragMove);
  window.addEventListener("mouseup", _onDragUp);
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

/** Escape 键关闭桌面歌词窗 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    void onClose();
  }
}

function onFontSizeChange(delta: number) {
  prefs.value.fontSize = Math.max(14, Math.min(48, prefs.value.fontSize + delta));
}
</script>

<template>
  <div
    ref="rootRef"
    class="lyric-root relative flex flex-col items-center justify-center h-screen select-none"
    :class="{ 'toolbar-visible': toolbarVisible }"
    :style="cssVars"
    tabindex="0"
    aria-label="桌面歌词，按 Tab 可调整显示设置"
    @mousedown="onMouseDown"
    @dblclick="onDoubleClick"
    @mouseenter="toolbarVisible = true"
    @mouseleave="onMouseLeave"
    @focusin="toolbarVisible = true"
    @focusout="onFocusOut"
  >
    <!-- 歌词内容层（受 --lyric-opacity 影响；工具栏在同层但在外） -->
    <div class="lyric-content flex flex-col items-center justify-center">
      <!-- 上一行（小字号、半透明，叠深色底板保证浅色桌面可读） -->
      <p
        v-if="visible.prev && prefs.showPrevNext"
        class="context-line prev-line lyric-plate truncate"
      >
        {{ visible.prev.text }}
      </p>

      <!-- 当前行（卡拉OK 逐字） -->
      <div class="current-wrap lyric-plate">
        <!-- 测量容器：宽度限制在窗口可用宽度内；当前行/翻译在其中整体缩放，
             永不横向裁切或滚动（见 fitCurrentLine）。 -->
        <div ref="currentLineFrameRef" class="current-line-frame">
          <h1
            v-if="visible.current && projectedKaraokeFrame.tokens.length > 0"
            class="current-lyric current-line-scaled text-transparent font-semibold leading-tight"
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
          >
            <span
              ref="translationTextRef"
              class="translation-text"
              :style="translationTextStyle"
            >{{ visible.current.translation }}</span>
          </p>
        </div>
      </div>

      <!-- 下一行（中字号、半透明，叠深色底板保证浅色桌面可读） -->
      <p
        v-if="visible.next && prefs.showPrevNext"
        class="context-line next-line lyric-plate truncate"
      >
        {{ visible.next.text }}
      </p>

      <!-- 歌曲信息 -->
      <p
        v-if="hasSong"
        class="song-info lyric-plate truncate"
        :class="{ 'song-info--visible': toolbarVisible }"
      >
        {{ state.songName }}<span v-if="state.artists" class="ml-2">— {{ state.artists }}</span>
      </p>
    </div>

    <!-- 工具条（hover 显示） -->
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
        title="减小字号"
        aria-label="减小字号"
        @click="onFontSizeChange(-2)"
        @mousedown.stop
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>

      <span class="w-8 text-center tabular-nums">{{ prefs.fontSize }}px</span>

      <!-- 字号 + -->
      <button
        type="button"
        class="toolbar-btn"
        title="增大字号"
        aria-label="增大字号"
        @click="onFontSizeChange(2)"
        @mousedown.stop
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 不透明度滑块（保留原生 mousedown 以恢复拖拽；按钮各自 .stop，容器不 .stop） -->
      <input
        type="range"
        min="0.2"
        max="1"
        step="0.05"
        :value="prefs.opacity"
        class="opacity-slider w-14 h-1 accent-white/80"
        title="不透明度"
        aria-label="桌面歌词不透明度"
        @input="prefs.opacity = Number(($event.target as HTMLInputElement).value)"
      />

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 上下文行开关 -->
      <button
        type="button"
        class="toolbar-btn"
        :class="{ 'is-active': prefs.showPrevNext }"
        :aria-pressed="prefs.showPrevNext"
        aria-label="显示上下行歌词"
        :title="prefs.showPrevNext ? '隐藏上一行和下一行' : '显示上一行和下一行'"
        @click="prefs.showPrevNext = !prefs.showPrevNext"
        @mousedown.stop
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><line x1="5" y1="7" x2="19" y2="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="5" y1="17" x2="19" y2="17"/></svg>
      </button>

      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 锁定开关 -->
      <button
        type="button"
        class="toolbar-btn"
        :aria-pressed="prefs.locked"
        aria-label="锁定桌面歌词"
        :title="prefs.locked ? '已锁定；双击歌词可解锁' : '未锁定；双击歌词可锁定'"
        @click="prefs.locked = !prefs.locked"
        @mousedown.stop
      >
        <!-- Lock icon when locked -->
        <svg v-if="prefs.locked" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <!-- Unlock icon when unlocked -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
      </button>

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 关闭 -->
      <button type="button" class="toolbar-btn" title="关闭桌面歌词" aria-label="关闭桌面歌词" @click="onClose" @mousedown.stop>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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

/* 歌词根容器：融入桌面，无背景/边框/投影；不透明度由 .lyric-content 层控制 */
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
}

/* 工具条出现时为其让出水平安全区，避免在 800×200 窗口内盖住长歌词。 */
.lyric-root.toolbar-visible .lyric-content {
  padding-right: 300px;
}

.context-line {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  max-width: 42%;
  margin: 0;
  padding: 2px 8px;
  overflow: hidden;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.62);
  font-size: clamp(11px, calc(var(--lyric-font-size, 28px) * 0.42), 16px);
  font-weight: 500;
  line-height: 1.15;
  pointer-events: none;
}

.prev-line {
  top: 8px;
  left: 18px;
  text-align: left;
}

.next-line {
  right: 18px;
  bottom: 8px;
  color: rgba(255, 255, 255, 0.74);
  text-align: right;
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
  color: var(--lyric-text-color, rgba(255, 255, 255, 0.95));
  line-height: 1.06;
}

/* 只有带缩放文本的行需要左对齐的静态位置：
   left:50% + translateX(-50%) 的居中依赖静态位置从容器左缘开始。 */
.current-line-scaled {
  text-align: left;
}

.song-info {
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  bottom: 8px;
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
  color: var(--lyric-text-color, rgba(255, 255, 255, 0.95));
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

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
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

/* 不透明度滑块 */
.opacity-slider {
  appearance: none;
  -webkit-appearance: none;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  vertical-align: middle;
}

.opacity-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  border: none;
  cursor: pointer;
}
</style>
