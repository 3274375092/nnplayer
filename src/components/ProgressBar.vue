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
/** 悬停指针在轨道上的比例（0–1）；null = 无指针预览（键盘/离开）。 */
const hoverRatio = ref<number | null>(null);

const ratio = computed(() => {
  if (!props.max || props.max <= 0) return 0;
  return Math.max(0, Math.min(100, (localValue.value / props.max) * 100));
});

/** 已播段用 scaleX 表达进度：0–1 的合成器属性，不再逐帧改 width。 */
const ratioScale = computed(() => (ratio.value / 100).toFixed(4));

/** 悬停时滑块与时间气泡跟随指针预览落点，而不是停在当前播放位置：
 *  进度条是「跳到某处」的控件，气泡必须回答「点下去会到哪」。 */
const previewRatio = computed(() => {
  if (dragging.value || hoverRatio.value === null) return ratio.value;
  return Math.max(0, Math.min(100, hoverRatio.value * 100));
});

/** 气泡读数：悬停显示落点时间，拖动显示拖动值，其余显示当前进度。 */
const previewValue = computed(() => {
  if (dragging.value || hoverRatio.value === null) return localValue.value;
  return Math.max(0, Math.min(maxValue.value, hoverRatio.value * maxValue.value));
});

function onPointerMove(e: PointerEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (rect.width <= 0) return;
  hoverRatio.value = Math.max(
    0,
    Math.min(1, (e.clientX - rect.left) / rect.width),
  );
}

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
    class="progress-bar relative h-3 cursor-pointer"
    :class="{ 'progress-bar--disabled': maxValue <= 0 }"
    @mouseenter="hovering = true"
    @pointermove="onPointerMove"
    @mouseleave="hovering = false; hoverRatio = null"
  >
    <div
      class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-track rounded-full overflow-hidden"
    />
    <!-- 已播段：整宽元素 + scaleX（合成器属性）。渐变随整体缩放压缩，
         视觉与原来的 width:% 一致，但不再触发宽度过渡/重排。 -->
    <div
      class="progress-fill absolute inset-x-0 top-1/2 h-1 rounded-full"
      :style="{ transform: `translateY(-50%) scaleX(${ratioScale})` }"
    />
    <!-- 交互盒放大到 24px 高（WCAG 2.5.8）：输入框绝对定位、不参与行高，
         视觉 4px 轨道仍由上面的自绘元素居中承载。 -->
    <input
      type="range"
      class="progress-range"
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
    <!-- 滑块轴与轨道等宽：translateX 的百分比因此等于轨道百分比，
         滑块位置不再用 left 布局属性。悬停时跟随指针预览落点。 -->
    <div
      class="progress-thumb-anchor"
      :style="{ transform: `translateX(${previewRatio}%)` }"
    >
      <div
        class="progress-thumb"
        :class="{ 'is-dragging': dragging }"
      />
    </div>
    <div
      v-if="maxValue > 0 && (dragging || (hovering && hoverRatio !== null))"
      class="progress-tooltip absolute px-2.5 py-1 bg-glass text-xs text-text-primary rounded-lg pointer-events-none whitespace-nowrap"
      :style="{
        left: `${previewRatio}%`,
        bottom: 'calc(100% + 60px)',
        transform: 'translateX(-50%)',
      }"
    >
      {{ fmtDuration(previewValue) }}
    </div>
  </div>
</template>

<style scoped>
/* 原生 range 的外观全部收起，进度与滑块由上方自绘元素承担；
   键盘聚焦时把 input 显示出来，只露出 2px 陶土焦点环。
   命中框 24px 高（视觉轨道 4px），绝对定位、不撑高行：所在进度行仍是 12px。
   #9 几何（窄窗 74px 播放条，中央列 40+8+12=60 居中）：进度行 55–67，
   命中框 49–73，完整落在条内；圆心 61 ↔ 播放键圆心 27 = 34px ≥ 20+12 = 32px，
   目标本身即 24px（不再依赖 WCAG 2.5.8 的间距例外）。
   见 PlayerBarFloating 的窄窗契约与 tests/playerBarGeometry.test.mjs。 */
.progress-range {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 24px;
  transform: translateY(-50%);
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  opacity: 0;
  outline: none;
}

/* 环内嵌 2px，保持 24px 交互盒里可见，不外扩压到上方传输按钮。 */
.progress-range:focus-visible {
  opacity: 1;
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
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

/* 已播段：整宽 + scaleX，从左边增长；75ms 线性只是把低频 timeupdate
   的台阶抹平，作用在合成器属性上，不产生布局。 */
.progress-fill {
  transform-origin: left center;
  background: linear-gradient(
    90deg,
    var(--color-accent),
    var(--color-accent-secondary)
  );
  transition: transform 75ms linear;
}

/* 滑块轴与轨道等宽；translateX 的百分比相对自身宽度 = 相对轨道宽度。 */
.progress-thumb-anchor {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: transform 75ms linear;
}

/* 纸色 10px 滑块：Raised 阴影之外再加 1px 陶土描边作为对比边界
   （纸色 vs 纸面仅 1.04:1，悬停/聚焦时靠这圈边界才读得出位置）。 */
.progress-thumb {
  position: absolute;
  top: 50%;
  left: 0;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  border: 1px solid var(--color-accent);
  background: var(--color-thumb);
  box-shadow: var(--shadow-raised);
  transform: translate(-50%, -50%) scale(0.75);
  opacity: 0;
  transition:
    transform 150ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 150ms ease;
}

/* 悬停整条进度（含放大后的输入盒，:hover 命中祖先）或键盘聚焦时露出滑块。 */
.progress-bar:hover .progress-thumb,
.progress-bar:has(.progress-range:focus-visible) .progress-thumb {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

/* 拖拽中放大：选择器比上面的 :hover 规则更靠后，保证拖动时不被覆盖。 */
.progress-bar .progress-thumb.is-dragging {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1.1);
}

/* 气泡浮在播放条上方：播放条 76/74px 内进度行只占底部 12px，气泡若留在条内
   会压住传输控件行（实测 28% 处即与播放键光环相撞）。底边 = 进度条底 −(12+60)，
   在 76px 与 74px 两档下都落在播放条顶缘上方约 5px（气泡是 Floating 层，
   DESIGN Elevation）。播放条已改为 overflow: visible 让气泡可以探出条外。 */
.progress-tooltip {
  box-shadow: var(--shadow-floating);
}

.progress-bar--disabled {
  cursor: default;
}

.progress-bar--disabled .progress-thumb {
  display: none;
}
</style>
