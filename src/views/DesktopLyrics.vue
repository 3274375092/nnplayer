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
import { findActiveLineIndex } from "@/utils/lrcParser";
import { getKaraokeTokenProgress } from "@/utils/lyricTiming";

const { state } = useDesktopLyricsBridge();
const { prefs, apply: applyPrefs } = useLyricWindowPrefs();
useWindowGeometry(); // 防抖保存窗口位置/大小

const unlistens: UnlistenFn[] = [];
const toolbarVisible = ref(false);
let disposed = false;

// =============== 本地绝对媒体时钟 + 独立时间轴定位 ===============
// 主窗只低频发送绝对时钟锚点；完整 lines/tokensByLine 在快照中只传一次。
// 子窗每帧由绝对位置自行二分切行，因此换行不依赖 IPC 到达时机。

const localPositionMs = ref(0);
let anchorPositionMs = 0;
let anchorTs = 0;
let anchorPlaying = false;
let anchorPlaybackRate = 1;
let lastSongId: number | null = null;
let lastSessionId = "";
let lastSeekRevision = -1;
let initialized = false;
let rafId = 0;

const HARD_SYNC_THRESHOLD_MS = 300;
const SOFT_CORRECTION_RATIO = 0.35;
const MAX_TRANSPORT_COMPENSATION_MS = 5000;

function packetPositionNow() {
  const s = state.value;
  if (!s.playing) return s.positionMs;
  const transportAge = Number.isFinite(s.sampledAt)
    ? Math.max(
        0,
        Math.min(MAX_TRANSPORT_COMPENSATION_MS, Date.now() - s.sampledAt),
      )
    : 0;
  return s.positionMs + transportAge * s.playbackRate;
}

function shouldRunLocalRaf() {
  return anchorPlaying && document.visibilityState === "visible";
}

function stopLocalRaf() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function rafTick() {
  rafId = 0;
  if (!shouldRunLocalRaf()) return;
  localPositionMs.value =
    anchorPositionMs +
    (performance.now() - anchorTs) * anchorPlaybackRate;
  rafId = requestAnimationFrame(rafTick);
}

function updateLocalRaf() {
  if (!shouldRunLocalRaf()) {
    stopLocalRaf();
    return;
  }
  if (!rafId) rafId = requestAnimationFrame(rafTick);
}

function syncAnchor(forceSnap: boolean) {
  const s = state.value;
  const now = performance.now();
  const elapsed = Math.max(0, now - anchorTs);
  const currentPosition = anchorPlaying
    ? anchorPositionMs + elapsed * anchorPlaybackRate
    : anchorPositionMs;
  const authoritativePosition = packetPositionNow();
  const positionDelta = authoritativePosition - currentPosition;
  const sessionChanged = initialized && s.sessionId !== lastSessionId;
  const songChanged = initialized && s.songId !== lastSongId;
  const seeked = initialized && s.seekRevision !== lastSeekRevision;
  const playStateChanged = initialized && s.playing !== anchorPlaying;
  const rateChanged = initialized && s.playbackRate !== anchorPlaybackRate;
  const hardSync =
    forceSnap ||
    !initialized ||
    sessionChanged ||
    songChanged ||
    seeked ||
    playStateChanged ||
    rateChanged ||
    Math.abs(positionDelta) >= HARD_SYNC_THRESHOLD_MS;

  anchorPositionMs = hardSync
    ? authoritativePosition
    : currentPosition + positionDelta * SOFT_CORRECTION_RATIO;
  localPositionMs.value = anchorPositionMs;
  anchorTs = now;
  anchorPlaying = s.playing;
  anchorPlaybackRate = s.playbackRate;
  lastSessionId = s.sessionId;
  lastSongId = s.songId;
  lastSeekRevision = s.seekRevision;
  initialized = true;
  updateLocalRaf();
}

watch(
  () => [state.value.sessionId, state.value.sequence],
  () => syncAnchor(false),
);

const activeLineIndex = computed(() =>
  findActiveLineIndex(state.value.lines, Math.floor(localPositionMs.value)),
);

const localProgressMs = computed(() => {
  const idx = activeLineIndex.value;
  const line = idx >= 0 ? state.value.lines[idx] : undefined;
  return line ? Math.max(0, localPositionMs.value - line.time) : 0;
});

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
  if (!hasSong.value) return "等待播放…";
  if (!hasLyric.value) return "暂无歌词";
  return "♪";
});

// =============== 卡拉 OK 逐字三态 ===============
//
// 每个 token 用 --char-pct 控制字内擦除：
//   - 已唱 (localProgressMs >= endMs) → 100%
//   - 未唱 (localProgressMs < startMs) → 0%
//   - 进行中 → (localProgressMs - startMs) / (endMs - startMs)
// 无 YRC token 时只显示行级歌词，不伪造看似精确的逐字动画。

interface CharRender {
  char: string;
  pct: number;
}

/** 逐字渲染数据：每个字的字内已唱百分比（0~1） */
const chars = computed<CharRender[]>(() => {
  const tokens = state.value.tokensByLine[activeLineIndex.value] ?? [];
  if (!tokens || tokens.length === 0) return [];
  const now = localProgressMs.value;
  return tokens.map((token) => ({
    char: token.char,
    pct: getKaraokeTokenProgress(token, now),
  }));
});

// =============== CSS 变量 ===============

/** 封面强调色：优先跟随桥接状态（每次歌词推送都带最新色），事件通道作为补充 */
const accentColor = computed(() => state.value.accentColor || "#E85D3A");

const cssVars = computed(() => ({
  "--lyric-font-size": `${prefs.value.fontSize}px`,
  "--lyric-opacity": String(prefs.value.opacity),
  "--lyric-text-color": prefs.value.textColor,
  "--color-accent": accentColor.value,
}));

// =============== 超长当前行自适应 ===============

const currentWrapRef = ref<HTMLElement | null>(null);
const currentTextRef = ref<HTMLElement | null>(null);
const currentLineScale = ref(1);
let lyricResizeObserver: ResizeObserver | null = null;

/**
 * 桌面歌词保持单行展示。文本超过窗口可用宽度时只缩放当前行的视觉尺寸，
 * 不改变用户保存的字号，也不会让页面的布局宽度被长文本撑开。
 */
function fitCurrentLine() {
  const wrapper = currentWrapRef.value;
  const text = currentTextRef.value;
  if (!wrapper || !text) {
    currentLineScale.value = 1;
    return;
  }

  const availableWidth = wrapper.clientWidth;
  const naturalWidth = text.scrollWidth;
  if (availableWidth <= 0 || naturalWidth <= 0) {
    currentLineScale.value = 1;
    return;
  }

  currentLineScale.value = Math.min(1, availableWidth / naturalWidth);
}

const currentTextStyle = computed(() => ({
  transform: `scale(${currentLineScale.value})`,
}));

watch(
  () => [visible.value.current?.text, prefs.value.fontSize],
  () => void nextTick(fitCurrentLine),
  { flush: "post" },
);

// =============== 生命周期 ===============

function onVisibilityChange() {
  // 恢复可见时用最近权威包（含 sampledAt）补齐后台经过的时间。
  syncAnchor(document.visibilityState === "visible");
}

onMounted(async () => {
  disposed = false;
  lyricResizeObserver = new ResizeObserver(() => fitCurrentLine());
  if (currentWrapRef.value) lyricResizeObserver.observe(currentWrapRef.value);
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
  document.addEventListener("visibilitychange", onVisibilityChange);

  // 首帧用 EMPTY 锚点；只有收到 playing=true 后才启动 rAF。
  syncAnchor(true);
});

onBeforeUnmount(() => {
  disposed = true;
  lyricResizeObserver?.disconnect();
  lyricResizeObserver = null;
  unlistens.forEach((u) => u());
  unlistens.length = 0;
  window.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  stopLocalRaf();
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
    getCurrentWindow().startDragging().catch(() => {});
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
    class="lyric-root flex flex-col items-center justify-center h-screen select-none"
    :style="cssVars"
    @mousedown="onMouseDown"
    @dblclick="onDoubleClick"
    @mouseenter="toolbarVisible = true"
    @mouseleave="toolbarVisible = false"
  >
    <!-- 歌词内容层（受 --lyric-opacity 影响；工具栏在同层但在外） -->
    <div class="lyric-content flex flex-col items-center justify-center">
      <!-- 上一行（小字号、半透明） -->
      <p
        v-if="visible.prev && prefs.showPrevNext"
        class="prev-line text-white/40 text-center max-w-full truncate"
        style="text-shadow: 0 0 1px rgba(0, 0, 0, 0.18)"
      >
        {{ visible.prev.text }}
      </p>
      <p v-else-if="prefs.showPrevNext" class="prev-line"></p>

      <!-- 当前行（卡拉OK 逐字） -->
      <div ref="currentWrapRef" class="current-wrap">
        <h1
          v-if="visible.current && chars.length > 0"
          class="current-lyric text-transparent font-semibold leading-tight text-center"
        >
          <span
            ref="currentTextRef"
            class="lyric-karaoke"
            :style="currentTextStyle"
            dir="auto"
            aria-hidden="true"
          >
            <!-- 逐字：每个字独立双层 span，靠 --char-pct 控制字内擦除 -->
            <span
              v-for="(c, i) in chars"
              :key="i"
              class="lyric-char"
              :style="{ '--char-pct': `${(c.pct * 100).toFixed(2)}%` }"
            >
              <span class="lyric-char__sung">{{ c.char }}</span>
              <span class="lyric-char__pending">{{ c.char }}</span>
            </span>
          </span>
        </h1>
        <h1
          v-else-if="visible.current && visible.current.text"
          class="current-lyric font-semibold leading-tight text-center"
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
          class="current-lyric text-white/40 font-semibold leading-tight text-center"
          style="text-shadow: 0 0 1px rgba(0, 0, 0, 0.18)"
        >
          {{ placeholderText }}
        </h1>
        <!-- 翻译行（外文歌双语显示） -->
        <p
          v-if="visible.current && visible.current.translation"
          class="translation-line text-center max-w-full truncate"
        >
          {{ visible.current.translation }}
        </p>
      </div>

      <!-- 下一行（中字号、半透明） -->
      <p
        v-if="visible.next && prefs.showPrevNext"
        class="next-line text-white/70 text-center max-w-full truncate"
        style="text-shadow: 0 0 1px rgba(0, 0, 0, 0.18)"
      >
        {{ visible.next.text }}
      </p>
      <p v-else-if="prefs.showPrevNext" class="next-line"></p>

      <!-- 歌曲信息 -->
      <p
        v-if="hasSong"
        class="song-info text-white/50 text-center max-w-full truncate"
        style="text-shadow: 0 0 1px rgba(0, 0, 0, 0.15)"
      >
        {{ state.songName }}<span v-if="state.artists" class="ml-2">— {{ state.artists }}</span>
      </p>
    </div>

    <!-- 工具条（hover 显示） -->
    <div
      v-show="toolbarVisible"
      data-toolbar
      class="toolbar absolute top-2 right-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/60 text-white/80 text-xs"
    >
      <!-- 字号 - -->
      <button
        class="toolbar-btn"
        title="减小字号"
        @click="onFontSizeChange(-2)"
        @mousedown.stop
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>

      <span class="w-6 text-center tabular-nums">{{ prefs.fontSize }}</span>

      <!-- 字号 + -->
      <button
        class="toolbar-btn"
        title="增大字号"
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
        @input="prefs.opacity = Number(($event.target as HTMLInputElement).value)"
      />

      <!-- 分隔线 -->
      <span class="w-px h-3.5 bg-white/20"></span>

      <!-- 锁定开关 -->
      <button
        class="toolbar-btn"
        :title="prefs.locked ? '已锁定，双击解锁' : '已解锁，可拖动'"
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
      <button class="toolbar-btn" title="关闭桌面歌词" @click="onClose" @mousedown.stop>
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

/* 核弹级透明：歌词内容区内所有元素强制透明，确保文字直接浮在桌面 */
.lyric-content,
.lyric-content * {
  background: transparent !important;
}

* {
  user-select: none;
  -webkit-user-select: none;
}

/* 歌词根容器：融入桌面，无背景/边框/投影；不透明度由 .lyric-content 层控制 */
.lyric-root {
  width: 100%;
  max-width: 100vw;
  overflow: hidden;
  box-sizing: border-box;
  background: transparent;
  border: none;
  box-shadow: none;
}

.prev-line {
  font-size: calc(var(--lyric-font-size, 28px) * 0.45);
  margin-bottom: 0.1rem;
  min-height: calc(var(--lyric-font-size, 28px) * 0.45);
  line-height: 1.15;
}

.current-wrap {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  flex-direction: column;
  overflow: hidden;
  min-height: calc(var(--lyric-font-size, 28px) * 1.1);
}

.current-lyric {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  font-size: var(--lyric-font-size, 28px);
  color: var(--lyric-text-color, rgba(255, 255, 255, 0.95));
}

.next-line {
  font-size: calc(var(--lyric-font-size, 28px) * 0.5);
  margin-top: 0.1rem;
  min-height: calc(var(--lyric-font-size, 28px) * 0.5);
  line-height: 1.15;
}

.song-info {
  font-size: calc(var(--lyric-font-size, 28px) * 0.3);
  margin-top: 0.15rem;
}

/* 翻译行（外文歌双语）：小字号、半透，位于当前行与歌曲信息之间 */
.translation-line {
  font-size: calc(var(--lyric-font-size, 28px) * 0.38);
  color: rgba(255, 255, 255, 0.42);
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.12);
  margin-top: 0.06rem;
}

/* 滑块控制的整窗歌词不透明度：只作用于歌词内容层，不影响工具栏背景 */
.lyric-content {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding-inline: 16px;
  overflow: hidden;
  box-sizing: border-box;
  opacity: var(--lyric-opacity, 1);
  transition: opacity 0.15s linear;
}

/* 卡拉OK 容器：inline-block + relative，子层 absolute 才能对齐 */
.lyric-karaoke {
  display: inline-block;
  position: relative;
  white-space: nowrap;
  transform-origin: center center;
  transition: transform 0.15s ease-out;
}

.plain-current-text {
  display: inline-block;
  white-space: nowrap;
  color: var(--lyric-text-color, rgba(255, 255, 255, 0.95));
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.22);
  transform-origin: center center;
  transition: transform 0.15s ease-out;
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
  color: var(--color-accent, #E85D3A);
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.22);
  clip-path: inset(0 calc(100% - var(--char-pct, 0%)) 0 0);
}

.lyric-char__pending {
  position: absolute;
  inset: 0;
  display: inline-block;
  color: rgba(255, 255, 255, 0.88);
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  clip-path: inset(0 0 0 var(--char-pct, 0%));
}

.lyric-karaoke:dir(rtl) .lyric-char__sung {
  clip-path: inset(0 0 0 calc(100% - var(--char-pct, 0%)));
}

.lyric-karaoke:dir(rtl) .lyric-char__pending {
  clip-path: inset(0 var(--char-pct, 0%) 0 0);
}

/* 工具条按钮样式 */
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
