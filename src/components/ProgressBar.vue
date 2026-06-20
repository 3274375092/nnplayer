<script setup lang="ts">
// 自定义进度条组件。
// 设计要点（参考 ZeroBit-Player lib/components/play_bar.dart:33-82）：
// 1. 双层叠加：底层 hover 灰色背景 + 顶层 accent 进度
// 2. 拖拽时显式区分"输入中"与"松手"：
//    - update:value 在拖拽时实时（不直接 seek，避免抖动）
//    - change 事件在松手时触发实际 seek
// 3. 键盘 ←/→ 微调 ±5 秒（onKey 处理 e.preventDefault 后调 value）
// 4. 拖拽 thumb 显隐：group-hover 时 scale 1.1，拖拽中始终显示
// 5. 工具提示：拖拽时显示当前时间

import { computed, ref, watch } from "vue";
import { fmtDuration } from "@/utils/format";

const props = withDefaults(
  defineProps<{
    value: number;
    max: number;
  }>(),
  {},
);

const emit = defineEmits<{
  "update:value": [v: number];
  change: [v: number];
}>();

const ratio = computed(() => {
  if (!props.max || props.max <= 0) return 0;
  return Math.max(0, Math.min(100, (props.value / props.max) * 100));
});

const dragging = ref(false);
const localValue = ref(props.value);
const hovering = ref(false);

// 同步外部 value 到 local（避免父组件频繁 setValue 时重置拖拽中的位置）
// 只在非拖拽时同步
watch(
  () => props.value,
  (v) => {
    if (!dragging.value) localValue.value = v;
  },
);

function onInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  localValue.value = v;
  dragging.value = true;
  emit("update:value", v);
}

function onChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  dragging.value = false;
  emit("change", v);
}

function onKey(e: KeyboardEvent) {
  // 键盘微调 ±5 秒：仅处理方向键
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const step = e.key === "ArrowRight" ? 5 : -5;
  const next = Math.max(0, Math.min(props.max, localValue.value + step));
  localValue.value = next;
  emit("update:value", next);
  emit("change", next);
}
</script>

<template>
  <div
    class="relative h-3 group"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <!-- 底层轨道 -->
    <div
      class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-hover rounded-full overflow-hidden"
    />

    <!-- 进度填充（顶层） -->
    <div
      class="absolute top-1/2 -translate-y-1/2 h-1 bg-accent rounded-full transition-[width] duration-100"
      :style="{ width: ratio + '%' }"
    />

    <!-- 透明 range 输入层 -->
    <input
      type="range"
      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer focus-visible:opacity-100 focus-visible:ring-2 ring-accent rounded outline-none"
      :min="0"
      :max="max"
      step="0.1"
      :value="localValue"
      @input="onInput"
      @change="onChange"
      @keydown="onKey"
      aria-label="播放进度"
    />

    <!-- 菱形 thumb -->
    <div
      class="absolute top-1/2 -translate-y-1/2 w-2 h-4 bg-accent shadow-md pointer-events-none transition-transform group-hover:scale-110 motion-reduce:transition-none"
      :class="dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      :style="{
        left: `calc(${ratio}% - 4px)`,
        clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
      }"
    />

    <!-- 拖拽 / hover 时显示的时间 tooltip -->
    <div
      v-if="dragging || hovering"
      class="absolute -top-9 px-2 py-1 bg-card text-xs rounded shadow pointer-events-none whitespace-nowrap"
      :style="{ left: `calc(${ratio}% - 24px)` }"
    >
      {{ fmtDuration(localValue) }}
    </div>
  </div>
</template>
