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

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useDesktopLyricsBridge } from "@/composables/useDesktopLyricsBridge";
import { useLyricWindowPrefs } from "@/composables/useLyricWindowPrefs";
import { useWindowGeometry } from "@/composables/useWindowGeometry";

const { state } = useDesktopLyricsBridge();
const { prefs } = useLyricWindowPrefs();
useWindowGeometry(); // 防抖保存窗口位置/大小

const unlistens: UnlistenFn[] = [];
const toolbarVisible = ref(false);

// =============== 歌词行裁剪 ===============

const visible = computed(() => {
  const ls = state.value.lines;
  const idx = state.value.activeLineIndex;
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

// =============== 本地时钟（rAF 插值）==============
//
// 主窗推送节流到 250ms（4Hz），子窗直接用会"两个字两个字跳"。
// 这里用 requestAnimationFrame 跑 60fps 本地时钟：
//   - 收到推送 → 记录锚点 (anchorMs = progressMs, anchorTs = now, playing)
//   - 行切换 → 立即 snap 到新行进度，避免从旧行进度开始擦
//   - rAF tick：playing 时 localProgressMs = anchorMs + (now - anchorTs)
//   - 暂停时 localProgressMs = anchorMs（不动）
//
// 关键：同一行内 anchor 不允许回退。主窗 progressMs 由 <audio> timeupdate
// 驱动（4Hz、离散、滞后实时播放），子窗 rAF 用 performance.now()（墙钟、连续、
// 实时）。两个 anchor 要么一起更新，要么都不动。

const localProgressMs = ref(0);
let anchorMs = 0;
let anchorTs = 0;
let anchorPlaying = false;
let lastLineIdx = -1;
let rafId = 0;
const SEEK_THRESHOLD_MS = 800;
const TOLERANCE_MS = 120;

function syncAnchor(snap: boolean) {
  const s = state.value;
  const lineChanged = s.activeLineIndex !== lastLineIdx;
  const delta = s.progressMs - localProgressMs.value;
  const now = performance.now();

  if (snap || lineChanged || Math.abs(delta) > SEEK_THRESHOLD_MS) {
    localProgressMs.value = s.progressMs;
    lastLineIdx = s.activeLineIndex;
    anchorMs = s.progressMs;
    anchorTs = now;
  } else if (s.playing !== anchorPlaying) {
    anchorMs = localProgressMs.value;
    anchorTs = now;
  } else if (delta > TOLERANCE_MS) {
    anchorMs = (localProgressMs.value + s.progressMs) / 2;
    anchorTs = now;
  }
  anchorPlaying = s.playing;
}

function rafTick() {
  if (anchorPlaying) {
    localProgressMs.value = anchorMs + (performance.now() - anchorTs);
  } else {
    localProgressMs.value = anchorMs;
  }
  rafId = requestAnimationFrame(rafTick);
}

watch(
  () => [state.value.progressMs, state.value.playing, state.value.activeLineIndex],
  () => syncAnchor(false),
);

// =============== 卡拉 OK 逐字三态 ===============

const lineSpan = computed(() => {
  const cur = visible.value.current;
  if (!cur) return 1;
  const next = visible.value.next;
  return Math.max(1, (next?.time ?? cur.time + 5000) - cur.time);
});

const fallbackStyle = computed(() => {
  const pct = Math.max(0, Math.min(1, localProgressMs.value / lineSpan.value));
  return { "--lyric-pct": `${(pct * 100).toFixed(2)}%` };
});

interface CharRender {
  char: string;
  pct: number;
}

const chars = computed<CharRender[]>(() => {
  const tokens = state.value.karaokeTokens;
  if (!tokens || tokens.length === 0) return [];
  const now = localProgressMs.value;
  return tokens.map((t) => {
    const span = t.endMs - t.startMs;
    if (span <= 0) return { char: t.char, pct: now >= t.endMs ? 1 : 0 };
    return { char: t.char, pct: Math.max(0, Math.min(1, (now - t.startMs) / span)) };
  });
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

// =============== 生命周期 ===============

onMounted(async () => {
  // 监听主窗配置推送
  unlistens.push(
    await listen<Partial<typeof prefs.value>>(
      "desktop-lyrics:apply-prefs",
      (e) => {
        Object.assign(prefs.value, e.payload);
      },
    ),
  );

  // Escape 键关闭
  window.addEventListener("keydown", onKeyDown);

  // 启动本地时钟 rAF
  syncAnchor(true);
  rafId = requestAnimationFrame(rafTick);
});

onBeforeUnmount(() => {
  unlistens.forEach((u) => u());
  unlistens.length = 0;
  window.removeEventListener("keydown", onKeyDown);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
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

function onDoubleClick() {
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
      <div class="current-wrap" :style="fallbackStyle">
        <h1
          v-if="visible.current && chars.length > 0"
          class="current-lyric text-transparent font-semibold leading-tight text-center"
        >
          <span class="lyric-karaoke" aria-hidden="true">
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
          class="current-lyric text-transparent font-semibold leading-tight text-center"
        >
          <!-- 回退：无逐字时间戳，整行线性擦 -->
          <span class="lyric-karaoke" aria-hidden="true">
            <span class="lyric-karaoke__sung">{{ visible.current.text }}</span>
            <span class="lyric-karaoke__pending">{{ visible.current.text }}</span>
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
  margin: 0;
  padding: 0;
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
  min-height: calc(var(--lyric-font-size, 28px) * 1.1);
}

.current-lyric {
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
  opacity: var(--lyric-opacity, 1);
  transition: opacity 0.15s linear;
}

/* 卡拉OK 容器：inline-block + relative，子层 absolute 才能对齐 */
.lyric-karaoke {
  display: inline-block;
  position: relative;
  white-space: nowrap;
}

/* 回退：整行双层擦（无逐字时间戳时，用 --lyric-pct） */
.lyric-karaoke__sung {
  display: inline-block;
  white-space: nowrap;
  color: var(--color-accent, #E85D3A);
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.22);
  clip-path: inset(0 calc(100% - var(--lyric-pct, 0%)) 0 0);
}

.lyric-karaoke__pending {
  position: absolute;
  inset: 0;
  display: inline-block;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.88);
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  clip-path: inset(0 0 0 var(--lyric-pct, 0%));
}

/* 逐字：每个字独立双层 span，靠 --char-pct 控制字内擦除 */
.lyric-char {
  display: inline-block;
  position: relative;
  white-space: nowrap;
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
