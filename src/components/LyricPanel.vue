<script setup lang="ts">
// 歌词面板（阶段3 升级版）。
//   - 弹簧物理滚动：useSpringScroll 跟踪 activeLineIndex
//   - 卡拉 OK 逐字渐变：每个 YRC token 独立计算并渲染字内进度
//   - 行间距离模糊：距当前 3 行外开始模糊
//   - 减少动效：弹簧退化为直接平移，跳过 rAF
//   - 点击某行歌词 → audioPlayer.seek(行 time)
//
// 行高策略（修复 1.5 行歌词与下一行重叠 bug）：
//   - 不再硬锁 height: lineHeight，而是用 min-height + line-height: 1.6
//   - 偏移量通过 ResizeObserver 测量每行实际高度累加，不再假设等高
//   - 当前行每个字符独立双层渲染，换行后仍按演唱顺序染色
//   - 超长行允许换行，并由 ResizeObserver 把真实高度计入滚动定位

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLyric } from "@/composables/useLyric";
import { useSpringValue } from "@/composables/useSpringScroll";
import { usePlayerStore } from "@/stores/player";
import { getKaraokeTokenProgress } from "@/utils/lyricTiming";

const props = withDefaults(
  defineProps<{
    /** 容器高度（px） */
    panelHeight?: number;
    /** 单行基准高度（px），作为 min-height 和 line-height 基准 */
    lineHeight?: number;
  }>(),
  { panelHeight: 400, lineHeight: 36 },
);

const player = usePlayerStore();
const {
  lines,
  activeLineIndex,
  karaokeTokens,
  progressMs,
  loading,
  error,
  hasLyric,
  retry,
  acquireRealtimeUpdates,
  seekTo,
} = useLyric();

// =============== 行高测量 ===============

/**
 * 每行实际渲染高度。用 ResizeObserver 监听每行的尺寸变化。
 * 累加求 targetY 时用"前 N-1 行之和 + 当前行 / 2"得到行中心。
 *
 * key 设计：避免下标漂移导致老行残留——歌切换时整体清空。
 */
const lineHeights = ref<number[]>([]);
const containerRef = ref<HTMLElement | null>(null);

let ro: ResizeObserver | null = null;
let releaseRealtimeUpdates: (() => void) | null = null;

function setLineRef(el: Element | { $el?: Element } | null, idx: number) {
  // v-for + ref=fn 时 el 可能是组件实例(带 $el)或原生 Element
  const target = (el as { $el?: Element } | null)?.$el ?? (el as Element | null);
  if (!(target instanceof HTMLElement)) return;
  // 同步一次初值,让首屏 targetY 不至于 0
  if (lineHeights.value[idx] !== target.offsetHeight) {
    lineHeights.value[idx] = target.offsetHeight;
  }
  ro?.observe(target);
}

function measureAll() {
  // 限定在组件根元素内查询,避免与其他 LyricPanel 实例或同名 class 冲突
  const nodes = containerRef.value?.querySelectorAll<HTMLElement>(".lyric-line");
  if (!nodes) return;
  const heights: number[] = [];
  nodes.forEach((n) => heights.push(n.offsetHeight));
  lineHeights.value = heights;
}

function observeAllLines() {
  if (!ro) return;
  ro.disconnect();
  const nodes = containerRef.value?.querySelectorAll<HTMLElement>(".lyric-line");
  nodes?.forEach((node) => ro?.observe(node));
  measureAll();
}

onMounted(() => {
  ro = new ResizeObserver(measureAll);
  releaseRealtimeUpdates = acquireRealtimeUpdates();
  // 全局引擎可能早已加载完歌词，此时 ref 回调先于 onMounted 执行，
  // 必须主动补绑现有节点。
  void nextTick(observeAllLines);
});

watch(
  lines,
  () => {
    lineHeights.value = []; // 切歌清空
    void nextTick(observeAllLines);
  },
  { flush: "post" },
);

// 行高被 ResizeObserver 异步更新时，targetY 会跳变；
// 若弹簧正在静止，跳变会触发一次弹簧追赶 → 换行后微小抖动。
// 这里在 lineHeights 变化后 snap 到最新 targetY，吸收这个跳变。
watch(
  lineHeights,
  () => {
    void nextTick(() => snapSpringY(targetY.value));
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  releaseRealtimeUpdates?.();
  releaseRealtimeUpdates = null;
});

// 减少动效时直接同步，不走弹簧
const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 期望的 translateY：让 activeLineIndex 行垂直居中
const targetY = computed(() => {
  const idx = activeLineIndex.value;
  if (idx < 0) return 0;
  const heights = lineHeights.value;
  // 测量未完成时：用基准行高估算,避免首帧从 0 弹到正确位置
  const fallback = (i: number) => heights[i] ?? props.lineHeight;
  // 累计到 idx 之前所有行的高度
  let offset = 0;
  for (let i = 0; i < idx; i++) offset += fallback(i);
  const cur = fallback(idx);
  return props.panelHeight / 2 - cur / 2 - offset;
});

const { value: springY, snap: snapSpringY } = useSpringValue(targetY);

const translateY = computed(() =>
  reduceMotion ? targetY.value : springY.value,
);

// 行切换瞬间直接 snap 滚动到新行中心，与卡拉OK 归零同步，
// 避免弹簧追赶期间新行先在偏下位置出现再滑到中心造成的换行闪回。
// 不用 reduceMotion 判断：减少动效时 targetY 本就同步，snap 也是同步效果。
watch(
  activeLineIndex,
  () => {
    snapSpringY(targetY.value);
  },
);

// 只对当前视口附近的行做 GPU blur。远行本来不可见，继续保留 filter 会让
// 浏览器为整首歌词创建昂贵的离屏图层；跳过它不影响行高测量或弹簧定位。
function filterFor(idx: number): string {
  const cur = activeLineIndex.value;
  if (cur < 0 || idx === cur) return "none";
  const absoluteDistance = Math.abs(idx - cur);
  if (absoluteDistance > 8) return "none";
  const dist = Math.max(0, absoluteDistance - 2);
  return dist > 0
    ? `blur(${Math.min(4, dist * 0.5).toFixed(2)}px)`
    : "none";
}

const renderedKaraokeTokens = computed(() => {
  const tokens = karaokeTokens.value;
  if (tokens.length === 0) return [];
  const now = progressMs.value;
  return tokens.map((token) => {
    return { ...token, pct: getKaraokeTokenProgress(token, now) };
  });
});

function onLineClick(timeMs: number) {
  seekTo(timeMs / 1000);
}

const hasSong = computed(() => player.currentSong !== null);
</script>

<template>
  <div
    ref="containerRef"
    class="card p-4 w-full"
    :style="{ minHeight: `${panelHeight}px` }"
  >
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-text-secondary">歌词</h3>
      <div
        v-if="hasSong"
        class="text-xs text-text-secondary truncate ml-3"
      >
        {{ player.currentSong?.name }}
      </div>
    </div>

    <!-- 加载 / 错误 / 空态 -->
    <div
      v-if="!hasSong"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      暂未播放歌曲
    </div>
    <div
      v-else-if="loading"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      歌词加载中…
    </div>
    <div
      v-else-if="error"
      class="flex flex-col gap-2 items-center justify-center text-accent text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      <span>{{ error }}</span>
      <button
        type="button"
        class="px-3 py-1 rounded-md border border-accent/30 hover:bg-accent/10"
        @click="retry"
      >
        重试
      </button>
    </div>
    <div
      v-else-if="!hasLyric"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      暂无歌词
    </div>

    <!-- 歌词内容（视口 + 弹簧平移） -->
    <div
      v-else
      class="relative overflow-hidden"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      <div
        class="absolute left-0 right-0 will-change-transform"
        :style="{ transform: `translate3d(0, ${translateY}px, 0)` }"
      >
        <div
          v-for="(line, idx) in lines"
          :key="`${line.time}-${idx}`"
          v-memo="[
            line.text,
            line.translation,
            idx === activeLineIndex,
            filterFor(idx),
            idx === activeLineIndex ? progressMs : 0,
          ]"
          :ref="(el) => setLineRef(el, idx)"
          class="lyric-line px-2 cursor-pointer"
          :class="{
            'is-active': idx === activeLineIndex,
            'has-karaoke': idx === activeLineIndex && renderedKaraokeTokens.length > 0,
          }"
          :style="{ filter: filterFor(idx) }"
          @click="onLineClick(line.time)"
        >
          <!-- 当前行：每个 YRC 字符独立计算字内擦色，可自然换行。 -->
          <template v-if="idx === activeLineIndex && renderedKaraokeTokens.length > 0">
            <span class="lyric-karaoke" dir="auto" aria-hidden="true">
              <span
                v-for="(token, i) in renderedKaraokeTokens"
                :key="i"
                class="lyric-char"
                :style="{ '--char-pct': `${(token.pct * 100).toFixed(2)}%` }"
              >
                <span class="lyric-char__sung">{{ token.char }}</span>
                <span
                  class="lyric-char__pending"
                >{{ token.char }}</span>
              </span>
            </span>
          </template>
          <span v-else-if="line.text">{{ line.text }}</span>
          <span v-else class="opacity-50">·</span>
          <!-- 翻译：当前行及邻近行显示，小字号半透明 -->
          <span
            v-if="line.translation"
            class="lyric-translation"
            :class="{ 'is-active-translation': idx === activeLineIndex }"
          >{{ line.translation }}</span>
        </div>
      </div>

      <!-- 中央分割线（视觉提示） -->
      <div
        class="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-accent/10"
      />
    </div>
  </div>
</template>

<style scoped>
/* 行基础样式：允许长歌词换行，真实高度由 ResizeObserver 参与居中计算。 */
.lyric-line {
  min-height: v-bind(lineHeight + 'px');
  line-height: 1.6;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: var(--color-text-secondary);
  transition: color 0.3s linear, filter 0.3s linear, font-size 0.2s linear;
}

.lyric-line.is-active {
  color: var(--color-text-primary);
  font-weight: 500;
  font-size: 1rem;
  filter: none !important;
}

.lyric-line.is-active.has-karaoke {
  color: transparent;
}

/* 每个字符各自擦色，inline-block 字符之间仍可自然换行。 */
.lyric-karaoke {
  display: inline;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.lyric-char {
  display: inline-block;
  position: relative;
  white-space: pre;
}

.lyric-char__sung {
  display: inline-block;
  color: var(--color-accent);
  clip-path: inset(0 calc(100% - var(--char-pct, 0%)) 0 0);
  text-shadow: 0 0 8px var(--color-glow);
}

.lyric-char__pending {
  position: absolute;
  inset: 0;
  display: inline-block;
  color: var(--color-text-secondary);
  clip-path: inset(0 0 0 var(--char-pct, 0%));
  pointer-events: none;
}

.lyric-karaoke:dir(rtl) .lyric-char__sung {
  clip-path: inset(0 0 0 calc(100% - var(--char-pct, 0%)));
}

.lyric-karaoke:dir(rtl) .lyric-char__pending {
  clip-path: inset(0 var(--char-pct, 0%) 0 0);
}

.will-change-transform {
  will-change: transform;
}

/* 翻译行：小字号、半透明，当前行更亮。必须显式设 color 覆盖 .is-active 的 transparent */
.lyric-translation {
  display: block;
  font-size: 0.8rem;
  font-style: italic;
  color: var(--color-text-secondary);
  opacity: 0.4;
  margin-top: 2px;
  transition: opacity 0.3s;
}

.lyric-translation.is-active-translation {
  opacity: 0.65;
}
</style>
