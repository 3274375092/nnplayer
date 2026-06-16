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

// =============== 卡拉 OK ===============

const karaokeStyle = computed(() => {
  const cur = visible.value.current;
  if (!cur) return {};
  const next = visible.value.next;
  const span = Math.max(1, (next?.time ?? cur.time + 5000) - cur.time);
  const pct = Math.max(0, Math.min(1, state.value.progressMs / span));
  return { "--lyric-pct": `${(pct * 100).toFixed(1)}%` };
});

const sungStyle = computed(() => ({
  clipPath: "inset(0 calc(100% - var(--lyric-pct, 0%)) 0 0)",
}));

const pendingStyle = computed(() => ({
  clipPath: "inset(0 0 0 var(--lyric-pct, 0%))",
}));

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
});

onBeforeUnmount(() => {
  unlistens.forEach((u) => u());
  unlistens.length = 0;
  window.removeEventListener("keydown", onKeyDown);
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
      <div class="current-wrap" :style="karaokeStyle">
        <h1
          v-if="visible.current && state.karaokeTokens.length > 0"
          class="current-lyric text-transparent font-semibold leading-tight text-center"
        >
          <span class="lyric-karaoke" aria-hidden="true">
            <!-- 已唱：accent 色，靠 clip-path 从左裁出 -->
            <span class="lyric-karaoke__sung" :style="sungStyle">
              <span v-for="(t, i) in state.karaokeTokens" :key="`s${i}`">{{ t.char }}</span>
            </span>
            <!-- 未唱：覆盖在白色之上（绝对定位，反向 clip-path） -->
            <span class="lyric-karaoke__pending" :style="pendingStyle">
              <span v-for="(t, i) in state.karaokeTokens" :key="`p${i}`">{{ t.char }}</span>
            </span>
          </span>
        </h1>
        <h1
          v-else-if="visible.current && visible.current.text"
          class="current-lyric text-white font-semibold leading-tight text-center"
          style="text-shadow: 0 0 1px rgba(0, 0, 0, 0.22)"
        >
          {{ visible.current.text }}
        </h1>
        <h1
          v-else
          class="current-lyric text-white/40 font-semibold leading-tight text-center"
          style="text-shadow: 0 0 1px rgba(0, 0, 0, 0.18)"
        >
          {{ placeholderText }}
        </h1>
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

/* 滑块控制的整窗歌词不透明度：只作用于歌词内容层，不影响工具栏背景 */
.lyric-content {
  opacity: var(--lyric-opacity, 1);
  transition: opacity 0.15s linear;
}

/* 卡拉OK：双层 span 模拟单行渐变，字符始终单行 inline，不会撑高父行 */
.lyric-karaoke {
  display: inline-block;
  position: relative;
  white-space: nowrap;
}

.lyric-karaoke__sung,
.lyric-karaoke__pending {
  display: inline-block;
  white-space: nowrap;
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.22);
}

.lyric-karaoke__sung {
  color: var(--color-accent, #E85D3A);
  transition: clip-path 0.1s linear;
}

.lyric-karaoke__pending {
  position: absolute;
  inset: 0;
  color: rgba(255, 255, 255, 0.88);
  pointer-events: none;
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
