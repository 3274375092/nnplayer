<script setup lang="ts">
// 标题超出时跑马灯。
// 设计要点（参考 ZeroBit-Player lib/custom_widgets/scroll_text.dart）：
// 1. 测 text 实际宽度 vs 容器宽度，只有超出时才滚动
// 2. hover 或键盘聚焦（reveal）才滚（默认静止，避免视觉噪声）
// 3. 文本始终带原生 title：任何溢出都有一条不依赖动画的完整文本出口；
//    触摸/键盘用户不会因为“看不到跑马灯”而永远读不到歌名
// 4. @media (prefers-reduced-motion: reduce) 时不滚动只截断
// 5. rAF 必须 cleanup

import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
    /** 滚动速度 px/s */
    speed?: number;
    /** 由外部（键盘焦点）触发滚动：与 hover 共用同一条 rAF 路径。 */
    reveal?: boolean;
  }>(),
  { speed: 30, reveal: false },
);

const containerRef = ref<HTMLElement | null>(null);
const textRef = ref<HTMLElement | null>(null);
const offset = ref(0);
const needScroll = ref(false);
/** 跑马灯位移终点（正值：scrollWidth - clientWidth）；0 = 无需滚动。 */
const maxOffset = ref(0);

// 减少动效时直接截断
const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let raf = 0;
let hover = false;

function measure() {
  const c = containerRef.value;
  const t = textRef.value;
  if (!c || !t) return;
  // text 实际宽度 > 容器宽度时需要滚动
  needScroll.value = t.scrollWidth > c.clientWidth + 1;
  // 终点是「文字右缘贴到容器右缘」，即 scrollWidth - clientWidth。
  // 旧实现把 max 取成 -scrollWidth，会在每轮末尾把整段文字送出容器、
  // 留下一整槽空白后才瞬跳回起点。
  maxOffset.value = needScroll.value
    ? Math.max(0, t.scrollWidth - c.clientWidth)
    : 0;
  if (!needScroll.value) offset.value = 0;
  // 重测可能改变 needScroll（切歌、侧栏折叠、窗口 resize）：若 hover/reveal 已经
  // 成立，跑马灯要按新的文本宽度起停，否则键盘用户聚焦时只能看到截断的新歌名。
  syncScroll();
}

function syncScroll() {
  const shouldScroll = needScroll.value && !reduceMotion && (hover || props.reveal);
  if (shouldScroll) startScroll();
  else {
    stopScroll();
    offset.value = 0;
  }
}

function onEnter() {
  hover = true;
  syncScroll();
}
function onLeave() {
  hover = false;
  syncScroll();
}

function startScroll() {
  if (raf) return;
  let last = 0;
  const tick = (t: number) => {
    if (!last) last = t;
    const dt = (t - last) / 1000;
    last = t;
    offset.value -= props.speed * dt;
    if (offset.value < -maxOffset.value) offset.value = 0; // 滚到字尾贴右缘后回 0 循环
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

watch(() => props.reveal, syncScroll);

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
    :title="text || undefined"
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
