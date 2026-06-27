<script setup lang="ts">
// 歌词面板（阶段3 升级版）。
//   - 弹簧物理滚动：useSpringScroll 跟踪 activeLineIndex
//   - 卡拉OK 逐字渐变（伪）：双层 span + clip-path 模拟单行渐变
//   - 行间距离模糊：距当前 3 行外开始模糊
//   - 减少动效：弹簧退化为直接平移，跳过 rAF
//   - 点击某行歌词 → audioPlayer.seek(行 time)
//
// 行高策略（修复 1.5 行歌词与下一行重叠 bug）：
//   - 不再硬锁 height: lineHeight，而是用 min-height + line-height: 1.6
//   - 偏移量通过 ResizeObserver 测量每行实际高度累加，不再假设等高
//   - 当前行卡拉OK 字符用双层 span + clip-path，字符始终是单行 inline，撑不高父容器
//   - 超长行用 white-space: nowrap + ellipsis 截断，避免无止境换行

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLyric } from "@/composables/useLyric";
import { useSpringValue } from "@/composables/useSpringScroll";
import { usePlayerStore } from "@/stores/player";

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
  source,
  seekTo,
} = useLyric();

/** 本地歌用了 NCM 在线歌词 → 时间轴可能错位，提示用户放 .lrc 覆盖 */
const showOnlineHint = computed(
  () => source.value === "online" && !!player.currentSong?.localPath,
);

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

onMounted(() => {
  ro = new ResizeObserver(measureAll);
});

watch(
  lines,
  () => {
    lineHeights.value = []; // 切歌清空
    void nextTick(measureAll);
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
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

// 行切换瞬间直接 snap 滚动到新行中心，与卡拉OK 归零同步
watch(
  activeLineIndex,
  () => {
    snapSpringY(targetY.value);
  },
);

// 行高被 ResizeObserver 异步更新时，targetY 会跳变，snap 吸收
watch(
  lineHeights,
  () => {
    void nextTick(() => snapSpringY(targetY.value));
  },
  { flush: "post" },
);

// 行间距离模糊：距当前 3 行外开始模糊，每多 1 行 +0.5px，最大 4px
function blurFor(idx: number): string {
  const cur = activeLineIndex.value;
  if (cur < 0) return "0px";
  const dist = Math.max(0, Math.abs(idx - cur) - 2);
  return `${Math.min(4, dist * 0.5).toFixed(2)}px`;
}

/**
 * 卡拉OK 已唱百分比：写入 CSS 自定义属性 --lyric-pct,
 * 让 CSS 通过 clip-path: inset(0 calc(100% - var(--lyric-pct)) 0 0) 裁出已唱区域。
 */
function activeLineStyle() {
  const idx = activeLineIndex.value;
  if (idx < 0) return {};
  const cur = lines.value[idx];
  if (!cur) return {};
  const next = lines.value[idx + 1];
  const span = Math.max(1, (next?.time ?? cur.time + 5000) - cur.time);
  const pct = Math.max(0, Math.min(1, progressMs.value / span));
  return { "--lyric-pct": `${(pct * 100).toFixed(1)}%` };
}

function onLineClick(timeMs: number) {
  seekTo(Math.floor(timeMs / 1000));
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

    <!-- 本地歌用了 NCM 在线歌词：时间轴可能与本地歌曲不完全同步，提示用户放 .lrc 覆盖 -->
    <div
      v-if="showOnlineHint"
      class="text-[11px] text-text-secondary/80 mb-2 px-2 py-1 rounded bg-accent/5 border border-accent/15 leading-snug"
    >
      歌词来源：网易云音乐 · 时间轴可能与本地歌曲不完全同步，可放置同名 .lrc 文件覆盖
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
      class="flex items-center justify-center text-accent text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      {{ error }}
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
          :ref="(el) => setLineRef(el, idx)"
          class="lyric-line px-2 cursor-pointer"
          :class="{ 'is-active': idx === activeLineIndex }"
          :style="idx === activeLineIndex ? activeLineStyle() : { filter: `blur(${blurFor(idx)})` }"
          @click="onLineClick(line.time)"
        >
          <!-- 当前行：双层 span 实现卡拉OK 单行渐变（不影响行高） -->
          <template v-if="idx === activeLineIndex && karaokeTokens.length > 0">
            <span class="lyric-karaoke" aria-hidden="true">
              <!-- 底层：已唱部分 accent 色，靠 clip-path 裁出 -->
              <span class="lyric-karaoke__sung">
                <span
                  v-for="(tk, i) in karaokeTokens"
                  :key="i"
                >{{ tk.char }}</span>
              </span>
              <!-- 上层：未唱部分覆盖在灰色（绝对定位，clip-path 反向） -->
              <span class="lyric-karaoke__pending">
                <span
                  v-for="(tk, i) in karaokeTokens"
                  :key="i"
                >{{ tk.char }}</span>
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
/* 行基础样式：不锁 height，单行截断（避免无止境换行），用 min-height 保证行间距 */
.lyric-line {
  min-height: v-bind(lineHeight + 'px');
  line-height: 1.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-secondary);
  transition: color 0.3s linear, filter 0.3s linear, font-size 0.2s linear;
}

.lyric-line.is-active {
  color: transparent; /* 主层透明让卡拉OK 透出 */
  font-weight: 500;
  font-size: 1rem;
  filter: none !important;
}

/* 卡拉OK：双层 span 模拟单行渐变，字符始终是单行 inline,不会撑高父行 */
.lyric-karaoke {
  display: inline-block; /* 需要块级 box,子 absolute 元素才能用 inset 定位 */
  position: relative;
  white-space: nowrap;
}

.lyric-karaoke__sung,
.lyric-karaoke__pending {
  display: inline-block;
  white-space: nowrap;
}

.lyric-karaoke__sung {
  color: var(--color-accent);
  /* 已唱部分按 --lyric-pct 显示：靠 clip-path 从左裁出已唱 */
  clip-path: inset(0 calc(100% - var(--lyric-pct, 0%)) 0 0);
  transition: clip-path 0.1s linear;
}

.lyric-karaoke__pending {
  position: absolute;
  inset: 0;
  color: var(--color-text-secondary);
  /* 关键：只覆盖"未唱"区域,左边已唱部分让底层 accent 透出 */
  clip-path: inset(0 0 0 var(--lyric-pct, 0%));
  pointer-events: none;
}

.will-change-transform {
  will-change: transform;
}

/* 翻译行：小字号、半透明，当前行更亮。必须显式设 color 覆盖 .is-active 的 transparent */
.lyric-translation {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  opacity: 0.35;
  margin-top: 1px;
  transition: opacity 0.3s;
}

.lyric-translation.is-active-translation {
  opacity: 0.55;
}
</style>
