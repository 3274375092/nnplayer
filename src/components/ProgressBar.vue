<script setup lang="ts">
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

/** 键盘步进：方向键 1s，Shift+方向键 5s，PageUp/PageDown 10s，Home/End 两端。 */
const ARROW_STEP = 1;
const SHIFT_ARROW_STEP = 5;
const PAGE_STEP = 10;

const dragging = ref(false);
const localValue = ref(props.value);
const hovering = ref(false);

const ratio = computed(() => {
  if (!props.max || props.max <= 0) return 0;
  return Math.max(0, Math.min(100, (localValue.value / props.max) * 100));
});

const maxValue = computed(() =>
  Number.isFinite(props.max) && props.max > 0 ? props.max : 0,
);

const valueText = computed(() =>
  maxValue.value > 0
    ? `已播放 ${fmtDuration(localValue.value)}，共 ${fmtDuration(maxValue.value)}`
    : "尚未播放",
);

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
  // re-sync from the source of truth once the drag/commit is done
  const max = Number.isFinite(props.max) ? props.max : 0;
  localValue.value = Math.max(0, Math.min(max, props.value));
}

function commitValue(next: number) {
  localValue.value = next;
  emit("update:value", next);
  emit("change", next);
}

function onKey(e: KeyboardEvent) {
  const max = maxValue.value;
  const current = Number.isFinite(localValue.value) ? localValue.value : 0;
  const arrowStep = e.shiftKey ? SHIFT_ARROW_STEP : ARROW_STEP;
  let next: number;
  switch (e.key) {
    case "ArrowLeft":
    case "ArrowDown":
      next = current - arrowStep;
      break;
    case "ArrowRight":
    case "ArrowUp":
      next = current + arrowStep;
      break;
    case "PageDown":
      next = current - PAGE_STEP;
      break;
    case "PageUp":
      next = current + PAGE_STEP;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = max;
      break;
    default:
      return;
  }
  // 阻止原生 range 的 0.1s/步与 PageUp 滚动页面，统一走上面的步进语义。
  e.preventDefault();
  if (max === 0) return;
  const clamped = Math.max(0, Math.min(max, next));
  if (clamped === current) return;
  commitValue(clamped);
}
</script>

<template>
  <div
    class="progress-bar relative h-3 group cursor-pointer"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <div
      class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-track rounded-full overflow-hidden"
    />
    <div
      class="absolute top-1/2 -translate-y-1/2 h-1 rounded-full transition-[width] duration-75 ease-linear"
      :style="{ background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-secondary))', width: ratio + '%' }"
    />
    <input
      type="range"
      class="progress-range absolute inset-0 w-full h-full cursor-pointer"
      :min="0"
      :max="max"
      step="0.1"
      :value="localValue"
      :disabled="maxValue <= 0"
      :aria-label="'播放进度'"
      :aria-valuetext="valueText"
      @input="onInput"
      @change="onChange"
      @keydown="onKey"
    />
    <div
      class="progress-thumb absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-thumb rounded-full pointer-events-none transition-all duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]"
      :class="dragging ? 'opacity-100 scale-110' : 'opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100'"
      :style="{
        left: `calc(${ratio}% - 5px)`,
      }"
    />
    <div
      v-if="dragging || hovering"
      class="progress-tooltip absolute -top-9 px-2.5 py-1 bg-glass text-xs text-text-primary rounded-lg pointer-events-none whitespace-nowrap backdrop-blur-xl"
      :style="{ left: `calc(${ratio}% - 24px)` }"
    >
      {{ fmtDuration(localValue) }}
    </div>
  </div>
</template>

<style scoped>
/* 原生 range 的外观全部收起，进度与滑块由上方自绘元素承担；
   键盘聚焦时把 input 显示出来，只露出 2px 陶土焦点环。 */
.progress-range {
  -webkit-appearance: none;
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  opacity: 0;
  outline: none;
}

.progress-range:focus-visible {
  opacity: 1;
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 999px;
}

.progress-range::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
}

.progress-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 1px;
  height: 1px;
  border: 0;
  background: transparent;
}

.progress-range::-moz-range-track {
  height: 100%;
  background: transparent;
}

.progress-range::-moz-range-thumb {
  width: 1px;
  height: 1px;
  border: 0;
  background: transparent;
}

/* 键盘聚焦时也把滑块露出来，方便确认当前位置。 */
.progress-bar:has(.progress-range:focus-visible) .progress-thumb {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}

/* 滑块与时间气泡只用 DESIGN 的两种纸面阴影，不再借用 Tailwind shadow-lg。 */
.progress-thumb {
  box-shadow: var(--shadow-raised);
}

.progress-tooltip {
  box-shadow: var(--shadow-floating);
}
</style>
