<script setup lang="ts">
// 标题超出时跑马灯。
// 设计要点（参考 ZeroBit-Player lib/custom_widgets/scroll_text.dart）：
// 1. 测 text 实际宽度 vs 容器宽度，只有超出时才滚动
// 2. hover 才滚（默认静止，避免视觉噪声）
// 3. @media (prefers-reduced-motion: reduce) 时不滚动只截断
// 4. rAF 必须 cleanup

import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
    /** 滚动速度 px/s */
    speed?: number;
  }>(),
  { speed: 30 },
);

const containerRef = ref<HTMLElement | null>(null);
const textRef = ref<HTMLElement | null>(null);
const offset = ref(0);
const needScroll = ref(false);

// 减少动效时直接截断
const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let raf = 0;

function measure() {
  const c = containerRef.value;
  const t = textRef.value;
  if (!c || !t) return;
  // text 实际宽度 > 容器宽度时需要滚动
  needScroll.value = t.scrollWidth > c.clientWidth + 1;
  if (!needScroll.value) offset.value = 0;
}

let hover = false;
function onEnter() {
  hover = true;
  if (needScroll.value && !reduceMotion) startScroll();
}
function onLeave() {
  hover = false;
  stopScroll();
  offset.value = 0;
}

function startScroll() {
  if (raf) cancelAnimationFrame(raf);
  let last = 0;
  const tick = (t: number) => {
    if (!last) last = t;
    const dt = (t - last) / 1000;
    last = t;
    const max = -(textRef.value?.scrollWidth ?? 0);
    offset.value -= props.speed * dt;
    if (offset.value < max) offset.value = 0; // 滚到底回 0 循环
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function stopScroll() {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

watch(() => props.text, () => {
  // 文字变化时重测
  requestAnimationFrame(measure);
});

onMounted(() => {
  measure();
  // 容器大小变化时重测（侧栏折叠、窗口 resize）
  if (typeof ResizeObserver !== "undefined" && containerRef.value) {
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.value);
    onBeforeUnmount(() => ro.disconnect());
  }
});

onBeforeUnmount(() => {
  stopScroll();
});
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden whitespace-nowrap"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <span
      ref="textRef"
      class="inline-block"
      :style="needScroll ? { transform: `translateX(${offset}px)` } : {}"
    >
      {{ text || "—" }}
    </span>
  </div>
</template>
