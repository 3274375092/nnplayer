<script setup lang="ts">
// 歌词面板（阶段3 升级版）。
//   - 弹簧物理滚动：滚动领先卡拉OK 200ms 完成，换行时高亮落在已居中的行上；
//     大跨度跳转（点击远端歌词/拖进度/切歌）直接定位
//   - 卡拉 OK 逐字渐变：每个 YRC token 独立计算并渲染字内进度
//   - 逐字重绘按「量化进度」记忆：33ms 桶下每帧只重渲染真正跨过 1% 的 1–2 个字
//     （见 charPct / KaraokeChar；视觉与每帧写满 20–40 个字时一致）
//   - 行间层级只用 distance-1/2/3 三档墨色（不再逐行 blur，见下）
//   - 减少动效：弹簧退化为直接平移，跳过 rAF
//   - 点击某行歌词 → audioPlayer.seek(行 time)
//
// 行高策略（修复 1.5 行歌词与下一行重叠 bug）：
//   - 不再硬锁 height: lineHeight，而是用 min-height + line-height: 1.6
//   - 偏移量通过 ResizeObserver 测量每行实际高度累加，不再假设等高
//   - 当前行每个字符单 span（background-clip:text 渐变擦色），换行后仍按演唱顺序染色
//   - 当前行按词分组：词级 wrapper 内放逐字 span，英文只在词间断行（不断词），
//     中文仍按字换行；超长行允许换行，并由 ResizeObserver 把真实高度计入滚动定位

import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useLyric } from "@/composables/useLyric";
import { useSpringValue } from "@/composables/useSpringScroll";
import { usePlayerStore } from "@/stores/player";
import { createKaraokeFrameProjector } from "@/lyrics/lyricFrame";
import type { ProjectedKaraokeToken } from "@/lyrics/lyricFrame";
import { groupKaraokeTokensIntoWords } from "@/lyrics/karaokeWords";
import type { KaraokeWordGroup } from "@/lyrics/karaokeWords";
import { langForLyric } from "@/utils/lyricScript";
import {
  buildLyricHeightPrefix,
  getLyricRenderRange,
  getLyricVirtualPadding,
} from "@/lyrics/lyricViewport";
import {
  computeLyricSnapLimitPx,
  computeScrollIndex,
} from "@/lyrics/lyricScroll";

const props = withDefaults(
  defineProps<{
    /** 容器高度（px） */
    panelHeight?: number;
    /** 单行基准高度（px），作为 min-height 和 line-height 基准 */
    lineHeight?: number;
  }>(),
  { panelHeight: 400, lineHeight: 36 },
);
const LYRIC_CHROME_HEIGHT = 40;
const lyricViewportHeight = computed(() =>
  Math.max(0, props.panelHeight - LYRIC_CHROME_HEIGHT),
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

const isVirtual = computed(() => lines.value.length > 160);

const visibleRange = computed(() =>
  getLyricRenderRange(lines.value.length, activeLineIndex.value)
);

/** 行内容派生值：读屏文案与语言判定只随 lines 变化，避免每次渲染对每行
 * 重复执行最多 4 个正则（langForLyric）与字符串拼接。 */
const lineMeta = computed(() =>
  lines.value.map((line) => ({
    ariaLabel: lineAriaLabel(line.text, line.translation),
    lang: langForLyric(line.text),
    translationLang: line.translation
      ? langForLyric(line.translation)
      : undefined,
  })),
);

/** 每行与当前行的视觉距离（0–3）：只随 activeLineIndex/lines 数量变化，模板 O(1) 取用。 */
const lineDistances = computed(() => {
  const current = activeLineIndex.value;
  const count = lines.value.length;
  const result = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    result[index] =
      current < 0 ? 3 : Math.min(3, Math.abs(index - current));
  }
  return result;
});

interface LyricRow {
  idx: number;
  time: number;
  text: string | undefined;
  translation: string | undefined;
  ariaLabel: string;
  lang: string | undefined;
  translationLang: string | undefined;
  distance: number;
  isActive: boolean;
  tabIndex: number;
}

/** 模板行数据：把每行的 class/aria/tabindex 计算集中一次，避免模板里
 * 每行重复调用多个函数（切歌时 120 行 × 多次调用的开销不可忽视）。 */
const visibleRows = computed<LyricRow[]>(() => {
  const { start, end } = visibleRange.value;
  const current = activeLineIndex.value;
  const meta = lineMeta.value;
  const distances = lineDistances.value;
  const rows: LyricRow[] = [];
  for (let idx = start; idx < end; idx += 1) {
    const line = lines.value[idx];
    const lineInfo = meta[idx];
    if (!line || !lineInfo) continue;
    const isActive = idx === current;
    rows.push({
      idx,
      time: line.time,
      text: line.text,
      translation: line.translation,
      ariaLabel: lineInfo.ariaLabel,
      lang: lineInfo.lang,
      translationLang: lineInfo.translationLang,
      distance: distances[idx] ?? 3,
      isActive,
      tabIndex: Math.abs(idx - current) <= 2 ? 0 : -1,
    });
  }
  return rows;
});

const heightPrefix = computed(() =>
  buildLyricHeightPrefix(lines.value.length, lineHeights.value, props.lineHeight)
);

const virtualPadding = computed(() => {
  return getLyricVirtualPadding(heightPrefix.value, visibleRange.value);
});

let ro: ResizeObserver | null = null;
let releaseRealtimeUpdates: (() => void) | null = null;
/** 已观察的歌词行：卸载时用于 unobserve，避免 RO 长期持有游离 DOM。 */
const observedEls = new Map<number, HTMLElement>();

function setLineRef(el: Element | { $el?: Element } | null, idx: number) {
  // v-for + ref=fn 时 el 可能是组件实例(带 $el)或原生 Element
  const target = (el as { $el?: Element } | null)?.$el ?? (el as Element | null);
  const prev = observedEls.get(idx);
  if (!(target instanceof HTMLElement)) {
    // Vue 是在 unmount() 开头就以 null 调用函数 ref、之后才移除 DOM 节点，
    // 此刻 isConnected 仍为 true，所以不能用它判断"真的卸载了"：只要 ref 被
    // 清空就解除观察，否则 RO 会长期持有已移除的歌词节点，其 0×0 尺寸条目
    // 还会经 updateMeasuredEntries 写回 lineHeights，造成累计偏移错位。
    if (prev) {
      ro?.unobserve(prev);
      observedEls.delete(idx);
    }
    return;
  }
  // 同一 index 已是同一节点：Vue 会在每次 patch 后重新调用函数 ref，而当前行
  // 每帧（30fps）都会因 --char-pct 重算而被 patch。这里必须在任何布局读取之前
  // 提前返回，否则 offsetHeight 紧跟同帧的自定义属性写入，等于每帧一次强制同步
  // 布局（read-after-write layout thrashing）。行高变化的唯一权威来源是下面的
  // ResizeObserver（borderBoxSize，不触发强制布局）。
  if (prev === target) return;
  // 同一 index 换成了新节点：旧节点也要解除观察（表项马上被覆盖）
  if (prev) ro?.unobserve(prev);
  observedEls.set(idx, target);
  // 仅首次观察读一次 offsetHeight，让首屏 targetY 不至于为 0。
  const firstHeight = target.offsetHeight;
  if (lineHeights.value[idx] !== firstHeight) {
    lineHeights.value[idx] = firstHeight;
  }
  ro?.observe(target);
}

/** 稳定的行 ref 回调：内联箭头会让 Vue 每次 patch 都为每行解绑/重绑 ref，
 * 切歌时放大成 120 次额外回调；按 idx 缓存闭包后 ref 身份稳定。 */
const lineRefHandlers = new Map<
  number,
  (el: Element | { $el?: Element } | null) => void
>();
function lineRefHandler(index: number) {
  const cached = lineRefHandlers.get(index);
  if (cached) return cached;
  const handler = (el: Element | { $el?: Element } | null) => {
    setLineRef(el, index);
  };
  lineRefHandlers.set(index, handler);
  return handler;
}

function measureAll() {
  // 限定在组件根元素内查询,避免与其他 LyricPanel 实例或同名 class 冲突
  const nodes = containerRef.value?.querySelectorAll<HTMLElement>(".lyric-line");
  if (!nodes) return;
  const next = [...lineHeights.value];
  nodes.forEach((node) => {
    const index = Number(node.dataset.lyricIndex);
    if (Number.isInteger(index) && index >= 0) next[index] = node.offsetHeight;
  });
  lineHeights.value = next;
}

function updateMeasuredEntries(entries: ResizeObserverEntry[]) {
  let next = lineHeights.value;
  let changed = false;

  for (const entry of entries) {
    const index = Number((entry.target as HTMLElement).dataset.lyricIndex);
    if (!Number.isInteger(index) || index < 0) continue;
    const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    if (Math.abs((next[index] ?? 0) - height) < 0.25) continue;
    if (!changed) next = [...next];
    next[index] = height;
    changed = true;
  }

  if (changed) lineHeights.value = next;
}

function observeAllLines() {
  if (!ro) return;
  ro.disconnect();
  const nodes = containerRef.value?.querySelectorAll<HTMLElement>(".lyric-line");
  nodes?.forEach((node) => ro?.observe(node));
  measureAll();
}

onMounted(() => {
  ro = new ResizeObserver(updateMeasuredEntries);
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
  if (firstContentFallbackTimer !== null) {
    clearTimeout(firstContentFallbackTimer);
    firstContentFallbackTimer = null;
  }
  ro?.disconnect();
  ro = null;
  releaseRealtimeUpdates?.();
  releaseRealtimeUpdates = null;
  reduceMotionQuery?.removeEventListener("change", onReduceMotionChange);
  reduceMotionQuery = null;
});

// 减少动效时直接同步，不走弹簧。必须是响应式 ref：用户在应用运行期间打开
// 系统的「减少动效」后，styles.css 的全局规则会把 CSS 过渡压到 0.01ms，
// 这里的弹簧也必须立即退化为直接定位，否则两套动效语义不一致。
const reduceMotion = ref(
  typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
);
let reduceMotionQuery: MediaQueryList | null = null;

function onReduceMotionChange(event: MediaQueryListEvent) {
  reduceMotion.value = event.matches;
}

onMounted(() => {
  reduceMotionQuery =
    window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  if (!reduceMotionQuery) return;
  // setup 快照到 mount 之间系统设置可能已变化，以挂载时的查询结果为准。
  reduceMotion.value = reduceMotionQuery.matches;
  reduceMotionQuery.addEventListener("change", onReduceMotionChange);
});

/**
 * 每行起始时间（ms，与 lines 同源）：只在 Lyric Timeline 整表替换后重算，
 * 避免把 lines 映射成时间数组的执行落到每帧的 scrollIndex 计算里。
 */
const lineStartMs = computed(() => lines.value.map((line) => line.time));

/**
 * 视觉滚动的目标行（见 @/lyrics/lyricScroll）：正常等于 activeLineIndex；
 * 本行剩余时间不足 SCROLL_LEAD_MS 时提前指向下一行（卡拉 OK 仍严格按
 * activeLineIndex 的时间轴走，领先只影响视觉滚动目标，不改变 Lyric Frame）。
 * 暂停时不预滚：当前行保持在中心，恢复播放后恢复领先。
 */
const scrollIndex = computed(() =>
  computeScrollIndex({
    activeLineIndex: activeLineIndex.value,
    lineStartMs: lineStartMs.value,
    progressMs: progressMs.value,
    playing: player.audioState.playing,
  }),
);

// 期望的 translateY：让 scrollIndex 行垂直居中（滚动先行、卡拉OK 后到）
const targetY = computed(() => {
  const idx = scrollIndex.value;
  if (idx < 0) return 0;
  const prefix = heightPrefix.value;
  const offset = prefix[idx];
  const cur = prefix[idx + 1] - offset;
  return lyricViewportHeight.value / 2 - cur / 2 - offset;
});

// 弹簧参数：接近临界阻尼（ζ≈0.99），一行位移约 0.28s 软着陆。
// 默认 170/26 对「换行」这种 36–40px 的短位移太慢（≈0.5s 才停稳），会让人感觉
// 歌词总在追；调硬后既有加速度的柔软感，又能在 200ms 领先窗口内基本归位。
const { value: springY, snap: snapSpringY } = useSpringValue(targetY, {
  stiffness: 450,
  damping: 42,
});

// 运行中开启「减少动效」：立即把弹簧定位到当前目标，避免残留在半路的位移。
watch(reduceMotion, (enabled) => {
  if (enabled) snapSpringY(targetY.value);
});

/** 只在弹簧真正追赶目标时提示合成层（will-change），静止时让引擎回收。 */
const springAnimating = computed(
  () => !reduceMotion.value && springY.value !== targetY.value,
);

const translateY = computed(() =>
  reduceMotion.value ? targetY.value : springY.value,
);

/** 滚动动画：相邻行走弹簧平滑滚动（DESIGN「弹簧退化为直接定位」只在
 *  prefers-reduced-motion 时成立）。只有这几类「大跳」才瞬间到位：
 *  - 首行 / 切歌（prev < 0，此时上一行没有可衔接的位置）；
 *  - 点击远端歌词或拖动进度条后跨度超过 2.5 行——长距离弹簧会变成一大段
 *    快速滑动再急停，反而不如直接定位干净；
 *  - reduce-motion。
 *  「2.5 行」按 heightPrefix（与 targetY 同源）的实际行高换算：带翻译的
 *  行约 57px，阈值约 142px；未测量的行由 buildLyricHeightPrefix 填入
 *  props.lineHeight，首帧仍等价于旧的 90px。
 *  行高被 ResizeObserver 修正的跳变仍由上面的 lineHeights watcher snap，
 *  避免量测抖动触发一次可见的「追赶」。 */
watch(
  scrollIndex,
  (next, prev) => {
    const jumpPx = Math.abs(targetY.value - springY.value);
    const tooFar =
      jumpPx >
      computeLyricSnapLimitPx(
        heightPrefix.value,
        lines.value.length,
        next,
        props.lineHeight,
      );
    if (
      reduceMotion.value ||
      next < 0 ||
      prev == null ||
      prev < 0 ||
      tooFar
    ) {
      snapSpringY(targetY.value);
      return;
    }
    // 其余情况不动 springY：target 变化由 useSpringValue 自己的 watch 启动 rAF，
    // 从当前速度/位置继续追赶；快速连行时会自然连成一段连续滚动。
  },
);

// 2026-11：删掉逐行 filter: blur()。它最多只作用在距离 4 的行（0.5px），
// 但每次换行都会为这些行新建/销毁一个滤镜渲染表面（且处在 mask-image 视口与
// 合成层里）；DESIGN 的层级本来就由 distance-1/2/3 的墨色阶梯承担，模糊是多余的
// 第二套深度机制。

const karaokeFrameProjector = createKaraokeFrameProjector();
// 卡拉OK擦色 30fps 节流：文字擦除在 30fps 与 60fps 下无肉眼差异，
// 但能把逐字样式重算/重绘次数减半（逐字 clip/渐变是歌词渲染的大头）。
const karaokeProgressMs = ref(0);
let lastKaraokePaint = 0;
watch(karaokeTokens, () => {
  // 换行立即投影，避免上一行进度泄漏到新行
  lastKaraokePaint = 0;
  karaokeProgressMs.value = progressMs.value;
});
watch(progressMs, (ms) => {
  const now = performance.now();
  if (now - lastKaraokePaint >= 33) {
    lastKaraokePaint = now;
    karaokeProgressMs.value = ms;
  }
});
const renderedKaraokeFrame = computed(() =>
  karaokeFrameProjector.project(karaokeTokens.value, karaokeProgressMs.value)
);

// 卡拉 OK 当前行按词分组：词级 wrapper 内仍是逐字 span，擦色时间轴不变。
// 逐帧投影复用同一个 token 数组，所以用数组身份缓存分组结果，避免每帧重建。
let karaokeGroupsSource: readonly ProjectedKaraokeToken[] = [];
let karaokeGroupsCache: KaraokeWordGroup<ProjectedKaraokeToken>[] = [];
const karaokeWordGroups = computed(() => {
  const tokens = renderedKaraokeFrame.value.tokens;
  if (tokens !== karaokeGroupsSource) {
    karaokeGroupsSource = tokens;
    karaokeGroupsCache = groupKaraokeTokensIntoWords(tokens);
  }
  return karaokeGroupsCache;
});

/** 量化后的擦色百分比（整数 0–100）。
 *
 *  #11：父级每 33ms 重渲染一次（进度桶），但任一时刻只有 1–2 个字符的进度
 *  真的在变，其余字符不是已唱（100%）就是未唱（0%）。把百分比量化成整数后，
 *  子组件 KaraokeChar 的 props 只在「真的跨过 1% 台阶」时变化：未变的字符
 *  不重新渲染、不重写 --char-pct、也不重绘字形，每帧写入量从 20–40 个字符
 *  降到 1–2 个。1% 台阶最多 0.5% 字宽（15px 字约 0.075px），视觉不变；
 *  33ms 桶保持不变，擦色节奏与改造前一致。 */
function charPct(token: ProjectedKaraokeToken): number {
  const progress = Math.min(1, Math.max(0, token.progress));
  return Math.round(progress * 100);
}

/**
 * 卡拉 OK 单个擦色字符（#11）。
 *
 * 为什么是独立组件而不是给 <span> 加 v-memo：字符渲染在「组」的嵌套 v-for
 * 里，而 Vue 的 v-memo 只在「v-memo 与 v-for 同元素」时才生成按项的 memo
 * 缓存；放在嵌套 v-for 的内部元素上时缓存槽被所有迭代共用，可能复用别的组
 * 的 vnode。独立组件靠 Vue 的 props 等值比较（shouldUpdateComponent）做
 * 逐字记忆：父级重渲染时只有 char / pct 变化的字符会重新渲染。
 * DOM 结构与改造前一致（仍是 <span class="lyric-char" style="--char-pct: N%">字</span>），
 * 唯一差别是百分比取整数（见 charPct，≤0.5% 字宽误差）。
 */
const KaraokeChar = defineComponent({
  name: "KaraokeChar",
  props: {
    char: { type: String, required: true },
    pct: { type: Number, required: true },
  },
  setup(props) {
    return () =>
      h(
        "span",
        { class: "lyric-char", style: { "--char-pct": `${props.pct}%` } },
        props.char,
      );
  },
});

function onLineClick(timeMs: number) {
  seekTo(timeMs / 1000);
}

/** 歌词行按钮的无障碍名称：说明点击会跳到这一句，并带上翻译。 */
function lineAriaLabel(
  text: string | undefined,
  translation: string | undefined,
): string {
  if (!text) return "跳转到这一句";
  return translation
    ? `跳转到歌词：${text}（翻译：${translation}）`
    : `跳转到歌词：${text}`;
}

const hasSong = computed(() => player.currentSong !== null);

// 首播时媒体管线启动与 120 行歌词挂载会竞争主线程，拉长 time-to-first-sound。
// 第一次拿到歌词时先保持「正在加载歌词…」，等播放真正开始（或 800ms 兜底）
// 再挂载歌词内容；只延迟这一次，后续切歌由歌词预取保证即时换行。
// 面板可能是在播放中途才挂载的（切页、暂停后回到正在播放页）：此时首声早已
// 开始、也不会有 playing 变化事件，必须直接用当前播放进度开闸，否则每次挂载
// 都会多显示 800ms 的假「正在加载歌词…」。
const hasShownLyricContent = ref(
  player.audioState.playing || player.audioState.currentTime > 0,
);
const firstContentFallback = ref(false);
let firstContentFallbackTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  hasLyric,
  (ready) => {
    if (!ready || hasShownLyricContent.value || firstContentFallbackTimer) {
      return;
    }
    firstContentFallbackTimer = setTimeout(() => {
      firstContentFallbackTimer = null;
      firstContentFallback.value = true;
      hasShownLyricContent.value = true;
    }, 800);
  },
  { immediate: true },
);

watch(
  () => player.audioState.playing,
  (playing) => {
    if (playing && !hasShownLyricContent.value) {
      hasShownLyricContent.value = true;
    }
  },
);

const firstContentPending = computed(
  () =>
    hasLyric.value &&
    !hasShownLyricContent.value &&
    !firstContentFallback.value,
);
</script>

<template>
  <div
    ref="containerRef"
    class="lyric-panel p-4 w-full"
    :style="{ minHeight: `${panelHeight}px` }"
  >
    <div class="lyric-panel__header flex items-center justify-between mb-2">
      <h3 class="lyric-panel__title text-sm font-medium">歌词</h3>
      <div
        v-if="hasSong"
        class="lyric-panel__song text-xs truncate ml-3"
      >
        {{ player.currentSong?.name }}
      </div>
    </div>

    <!-- 加载 / 错误 / 空态 -->
    <div
      v-if="!hasSong"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${lyricViewportHeight}px` }"
    >
      还没有播放歌曲
    </div>
    <div
      v-else-if="loading"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${lyricViewportHeight}px` }"
      role="status"
    >
      正在加载歌词…
    </div>
    <div
      v-else-if="error"
      class="lyric-error flex flex-col gap-2 items-center justify-center text-sm"
      :style="{ height: `${lyricViewportHeight}px` }"
      role="alert"
    >
      <p class="lyric-error-title">{{ error.title }}</p>
      <p v-if="error.hint" class="lyric-error-hint">{{ error.hint }}</p>
      <button
        v-if="error.retryable"
        type="button"
        class="btn btn-ghost"
        @click="retry"
      >
        重试
      </button>
      <details v-if="error.detail" class="lyric-error-detail">
        <summary>技术详情</summary>
        <code>{{ error.detail }}</code>
      </details>
    </div>
    <div
      v-else-if="firstContentPending"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${lyricViewportHeight}px` }"
      role="status"
    >
      正在加载歌词…
    </div>
    <div
      v-else-if="!hasLyric"
      class="lyric-empty"
      :style="{ height: `${lyricViewportHeight}px` }"
    >
      <!-- 空态要说明「为什么没有」并给出下一步，而不是一句孤立灰字。 -->
      <p class="lyric-empty__title">这首歌没有提供歌词</p>
      <p class="lyric-empty__hint">换一首歌播放后，这里会显示同步歌词</p>
    </div>

    <!-- 歌词内容（视口 + 弹簧平移） -->
    <div
      v-else
      class="lyric-viewport relative overflow-hidden"
      :style="{ height: `${lyricViewportHeight}px` }"
    >
      <div
        class="absolute left-0 right-0"
        :class="{ 'lyric-scroll-animating': springAnimating }"
        :style="{ transform: `translate3d(0, ${translateY}px, 0)` }"
      >
        <div
          v-if="isVirtual"
          aria-hidden="true"
          class="lyric-virtual-spacer"
          :style="{ height: `${virtualPadding.top}px` }"
        />
        <!-- key 固定为行下标（切歌时复用 DOM），因此 v-memo 必须覆盖所有随行
             内容变化的字段：漏掉 time/tabIndex 会命中旧缓存、跳过 patch，留下
             上一首的点击时间（点远端歌词跳到错误位置）与旧 tabindex。 -->
        <button
          v-for="row in visibleRows"
          :key="row.idx"
          v-memo="[
            row.text,
            row.translation,
            row.time,
            row.isActive,
            row.distance,
            row.tabIndex,
            row.isActive ? karaokeProgressMs : 0,
          ]"
          :ref="lineRefHandler(row.idx)"
          :data-lyric-index="row.idx"
          type="button"
          :tabindex="row.tabIndex"
          class="lyric-line px-2 cursor-pointer"
          :class="[
            `distance-${row.distance}`,
            {
              'is-active': row.isActive,
              'has-karaoke': row.isActive && renderedKaraokeFrame.tokens.length > 0,
            },
          ]"
          :aria-current="row.isActive ? 'true' : undefined"
          :aria-label="row.ariaLabel"
          :lang="row.lang"
          @click="onLineClick(row.time)"
        >
          <!-- 当前行：每字符单 span + background-clip:text 渐变擦色（替代双层 clip-path，光栅成本减半）。
               分组渲染：西文词包一层不可断的词级 wrapper（英文不断词），CJK 单字照常按字换行，
               空白作为普通文本空格提供词间断点。 -->
          <template v-if="row.isActive && renderedKaraokeFrame.tokens.length > 0">
            <span
              class="lyric-karaoke"
              dir="auto"
              :lang="row.lang"
              aria-hidden="true"
            >
              <template v-for="(group, gi) in karaokeWordGroups" :key="gi">
                <!-- 空白组：普通文本（不套 inline-block），换行点落在词与词之间。 -->
                <template v-if="group.isSpace">{{ group.tokens.map((token) => token.char).join("") }}</template>
                <!-- 西文词：词级 wrapper 整词不断行，内部仍逐字擦色。 -->
                <span v-else-if="group.nowrap" class="lyric-word">
                  <KaraokeChar
                    v-for="(token, ti) in group.tokens"
                    :key="ti"
                    :char="token.char"
                    :pct="charPct(token)"
                  />
                </span>
                <!-- CJK：单字直接渲染，仍按字换行。 -->
                <template v-else>
                  <KaraokeChar
                    v-for="(token, ti) in group.tokens"
                    :key="ti"
                    :char="token.char"
                    :pct="charPct(token)"
                  />
                </template>
              </template>
            </span>
            <span class="sr-only" :lang="row.lang">{{ row.text }}</span>
          </template>
          <span v-else-if="row.text" :lang="row.lang">{{ row.text }}</span>
          <span v-else>·</span>
          <!-- 翻译：当前行及邻近行显示，小字号半透明 -->
          <span
            v-if="row.translation"
            class="lyric-translation"
            :class="{ 'is-active-translation': row.isActive }"
            :lang="row.translationLang"
          >{{ row.translation }}</span>
        </button>
        <div
          v-if="isVirtual"
          aria-hidden="true"
          class="lyric-virtual-spacer"
          :style="{ height: `${virtualPadding.bottom}px` }"
        />
      </div>

    </div>
  </div>
</template>

<style scoped>
.lyric-panel {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.lyric-panel__header {
  position: relative;
  z-index: 1;
  min-height: 1.5rem;
}

.lyric-panel__title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  /* 面板标题：peat，对四个纸面 7.78:1 起（旧 74% mix 仅 5.88:1）。 */
  color: var(--color-text-secondary);
  letter-spacing: 0;
}

.lyric-panel__song {
  max-width: 62%;
  /* 右上元信息 12px：ash，对四个纸面 5.74:1 起（旧 48% mix 实测 2.79:1）。 */
  color: var(--color-text-tertiary);
}

/* 歌词空态：说明原因 + 下一步；文字守住 ≥70% 墨色下限（DESIGN 歌词行最低一档），
   仍是同一张浅纸上的正文，不引入深色面板或描边来「显得有事发生」。 */
.lyric-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  box-sizing: border-box;
  padding: 0 0.5rem;
  text-align: center;
}

.lyric-empty__title {
  margin: 0;
  /* 邻近行一档（90% 炭墨，raised 卡上约 9.3:1），高于 70% 墨的歌词行下限；
     字号守 14px 上限（Weight-Not-Size：空态不是歌词行，不借用 0.975rem）。 */
  color: color-mix(in srgb, var(--color-text-primary) 90%, transparent);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.6;
}

.lyric-empty__hint {
  margin: 0;
  /* 70% 炭墨：DESIGN 歌词行的最低一档，raised 卡上约 5.4:1。 */
  color: color-mix(in srgb, var(--color-text-primary) 70%, transparent);
  font-size: 0.75rem;
  line-height: 1.5;
}

/* 歌词失败态：标题说明原因、提示恢复方式，后端原文只在展开后出现。 */
.lyric-error {
  padding: 0 1rem;
  overflow-y: auto;
  text-align: center;
}

.lyric-error-title {
  margin: 0;
  /* 与页内错误（InlineError）同一套：14px/600 炭墨标题，不再用强调色当正文。 */
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.lyric-error-hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.lyric-error-detail {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.lyric-error-detail summary {
  cursor: pointer;
}

.lyric-error-detail summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 6px;
}

.lyric-error-detail code {
  display: block;
  max-height: 80px;
  margin-top: 4px;
  overflow: auto;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--color-surface-soft);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-align: left;
}

.lyric-viewport {
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 12%,
    #000 88%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 12%,
    #000 88%,
    transparent 100%
  );
}

.lyric-virtual-spacer {
  display: block;
  width: 100%;
  pointer-events: none;
}

/* 行基础样式：允许长歌词换行，真实高度由 ResizeObserver 参与居中计算。
   色阶必须同时满足"阅读层级"和"4.5:1 正文下限"：
   旧 46% / 58% mix 在纸上只有 2.67 / 3.67:1，是评审判定的低对比来源。
   现在用 charcoal 墨色的 70% → 90% → 实底三档，动态染色纸最暗端点
   （#f2e5bc）最差值 4.95 / 6.64 / 8.93:1，raised 卡上 5.4 / 7.5 / 10.4:1；
   当前行再叠加 600 字重与 accent 洗色。 */
.lyric-line {
  position: relative;
  display: block;
  width: 100%;
  min-height: v-bind(lineHeight + 'px');
  border: 0;
  line-height: 1.6;
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
  white-space: normal;
  /* 英文按词换行：word-break: normal 不再逐字符断词（旧 overflow-wrap: anywhere
     会把 when 拆成 wh / en）；只有真正超长且不可断的词才用 break-word 兜底。
     中文没有空格，normal 下仍按字正常换行。 */
  word-break: normal;
  overflow-wrap: break-word;
  border-radius: 6px;
  /* 远行（距离 ≥3）：最低一档，最暗染色纸 4.95:1（≥ DESIGN 4.65 正文下限）。 */
  color: color-mix(in srgb, var(--color-text-primary) 70%, transparent);
  font-family: inherit;
  font-size: 0.975rem;
  font-weight: 500;
  text-align: left;
  transition:
    color 0.28s linear,
    background-color 0.2s ease;
}

.lyric-line.distance-2 {
  color: color-mix(in srgb, var(--color-text-primary) 80%, transparent);
}

.lyric-line.distance-1 {
  color: color-mix(in srgb, var(--color-text-primary) 90%, transparent);
}

.lyric-line:not(.is-active):hover {
  color: var(--color-text-primary);
  background-color: color-mix(in srgb, var(--color-accent) 5%, transparent);
}

/* 焦点环用设计系统的 2px 陶土 outline（DESIGN 组件规则），不再落到浏览器
   UA 的淡蓝环。用 -2px 内嵌偏移：歌词视口有上下渐隐 mask，外扩的环会被裁掉。 */
.lyric-line:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.lyric-line.is-active {
  /* 当前行：实底炭墨 + 600 字重 + accent 洗色，保持最强层级（12.99:1 起）。 */
  color: var(--color-text-primary);
  font-weight: 600;
}

/* accent 洗色放在独立伪元素上并按 opacity 过渡：background-image 的渐变无法
   直接补间，换行时洗色会硬切；淡入 220ms 与行间墨色 0.28s 的色阶过渡同步，
   换行时高亮「亮起来」而不是闪一下。z-index:-1 让洗色位于本行文字之下，
   面板本身是透明底（isolation:isolate），不会掉到面板背景后面。 */
.lyric-line::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: 6px;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-accent) 8%, transparent),
    transparent 78%
  );
  opacity: 0;
  transition: opacity 0.22s ease;
}

.lyric-line.is-active::before {
  opacity: 1;
}

.lyric-line.is-active.has-karaoke {
  color: transparent;
}

/* 每个字符各自擦色；按词分组后，词内字符由 .lyric-word 兜住，不再逐字符断行。 */
.lyric-karaoke {
  display: inline;
  white-space: normal;
  /* 与 .lyric-line 同一策略：按词换行，不逐字符断词。 */
  word-break: normal;
  overflow-wrap: break-word;
}

/* 词级 wrapper（卡拉 OK 当前行按词换行）。
   整词 shrink-to-fit 成一个原子内联盒：词宽够放时整词不可断，断点只落在词与词
   之间的空格文本上；只有单词本身宽过卡片时才被 max-width 收住，退回到字间换行，
   因此长行换行后不会横向溢出、也不会缩小字号。内部逐字 .lyric-char 的擦色不受影响。 */
.lyric-word {
  display: inline-block;
  max-width: 100%;
  white-space: normal;
}

/* 卡拉OK擦色：每字符单 span，用 background-clip:text 渐变硬停实现字内擦除。
   相比旧的"双层 span + clip-path"：节点减半、去掉绝对定位层，
   渐变擦色与 clip-path 视觉一致。不打 per-char 阴影（逐字光栅大头），
   当前行本身已有 accent 高亮 + 背景渐变，视觉层级足够。
   不加 transition：rAF 每帧更新 pct，CSS 补间反而会引入延迟让逐字失同步。
   未唱部分用实底 charcoal：旧 62% mix 只有 4.11:1，是当前行待唱文字
   在纸上的低对比来源；实底后对染色纸仍有 11.56:1。 */
.lyric-char {
  display: inline-block;
  white-space: pre;
  /* 逐字擦色会按帧改写 --char-pct 并重绘字形：把每个字的重绘范围收在自身盒内，
     避免重绘溢出到同一行的其他字/行（布局、样式、绘制三重 containment）。
     只影响渲染作用域，不改变字形与渐变视觉。 */
  contain: layout style paint;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--color-accent) var(--char-pct, 0%),
    var(--color-text-primary) var(--char-pct, 0%)
  );
  -webkit-background-clip: text;
  background-clip: text;
}

.lyric-karaoke:dir(rtl) .lyric-char {
  background-image: linear-gradient(
    270deg,
    var(--color-accent) var(--char-pct, 0%),
    var(--color-text-primary) var(--char-pct, 0%)
  );
}

/* 弹簧只在面板高度变化等少数场景真正运行：仅在追赶目标时提示合成层，
   静止时不再常驻保留（否则整层合成层一直活着，还会挡住引擎回收）。 */
.lyric-scroll-animating {
  will-change: transform;
}

/* 翻译行：小字号、次级但不低于正文下限。旧实现是 0.3–0.68 的 opacity
   （1.82–4.90:1），现在统一用 70% 墨色（最暗染色纸 4.95:1），当前行翻译
   回到实底 charcoal，保持"当前行更亮"的层级。必须显式设 color 覆盖
   .is-active 的 transparent。 */
.lyric-translation {
  display: block;
  font-size: 0.78rem;
  font-style: normal;
  line-height: 1.5;
  color: color-mix(in srgb, var(--color-text-primary) 70%, transparent);
  margin-top: 3px;
  transition: color 0.3s;
}

.lyric-translation.is-active-translation {
  color: var(--color-text-primary);
}

@media (prefers-reduced-motion: reduce) {
  .lyric-line,
  .lyric-translation {
    transition: none;
  }
}
</style>
