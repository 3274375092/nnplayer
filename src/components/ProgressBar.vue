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

const dragging = ref(false);
const localValue = ref(props.value);
const hovering = ref(false);

const ratio = computed(() => {
  if (!props.max || props.max <= 0) return 0;
  return Math.max(0, Math.min(100, (localValue.value / props.max) * 100));
});

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
    class="relative h-3 group cursor-pointer"
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
    <div
      class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-thumb rounded-full shadow-lg ring-1 ring-border-strong pointer-events-none transition-all duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]"
      :class="dragging ? 'opacity-100 scale-110' : 'opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100'"
      :style="{
        left: `calc(${ratio}% - 5px)`,
      }"
    />
    <div
      v-if="dragging || hovering"
      class="absolute -top-9 px-2.5 py-1 bg-glass text-xs text-text-primary rounded-lg shadow-lg pointer-events-none whitespace-nowrap border border-border-strong backdrop-blur-xl"
      :style="{ left: `calc(${ratio}% - 24px)` }"
    >
      {{ fmtDuration(localValue) }}
    </div>
  </div>
</template>
