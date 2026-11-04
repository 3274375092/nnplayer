<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import { Play, Music2 } from "@lucide/vue";
import type { Song } from "@/types/music";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";
import { fmtDurationMs } from "@/utils/format";

interface Props {
  songs: Song[];
  title?: string;
  showIndex?: boolean;
  showAlbum?: boolean;
  /** 空状态文案由页面决定：同样是没有歌曲，每日推荐与歌单的“为什么空”不同。 */
  emptyTitle?: string;
  emptyHint?: string;
  /** 结果总量（如搜索命中数）；大于已加载 songs 时说明只显示了前 N 首。 */
  totalCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  showIndex: true,
  showAlbum: true,
  emptyTitle: "这里还没有歌曲",
  emptyHint: "从每日推荐或搜索里挑一首",
});

const player = usePlayerStore();

const currentId = computed(() => player.currentSong?.id ?? null);

// ===== 侧栏宽度过渡期间冻结容器查询（FIX-CONTEXT-2 #13） =====
//
// 跨文件契约：`App.vue` 用同一个字符串键 provide「侧栏宽度过渡中」的 ref。
// 侧栏折叠/展开/断点切换有 220ms 宽度过渡（DESIGN 规定），列表容器宽度连续变化：
// 下面的 @container 查询会在中途翻转「专辑列显示/隐藏」（列集合变化 → 每行重新
// 计算列宽与显隐），即使不翻转，1fr 宽度也逐帧重算。这里在过渡开始时按当时的
// 宽度钉住宽/窄两种列策略之一，并用 contain 把连续重排限制在列表盒子内；过渡
// 结束后立刻解除，让容器查询按最终宽度只重排一次（唯一一次列翻转）。
const SIDEBAR_TRANSITION_KEY = "nnplayer.sidebarTransitioning";
const sidebarTransitioning = inject<Ref<boolean>>(
  SIDEBAR_TRANSITION_KEY,
  ref(false),
);

/** 与 @container song-list (max-width: 34rem) 完全相同的阈值（34rem = 544px）。 */
const NARROW_CONTAINER_MAX_PX = 34 * 16;

const rootRef = ref<HTMLElement | null>(null);
type PinnedGrid = "wide" | "narrow" | null;
const pinnedGrid = ref<PinnedGrid>(null);

/**
 * flush:"sync"：在 App 把共享状态置为 true 的同一轮里测量，此时侧栏的 DOM/宽度
 * 还是过渡前的值（也就是动画中不会翻转的那个列策略），读到的是正确的冻结目标。
 * 连续切换时共享状态保持 true、不会重复测量：沿用第一次钉住的策略直到整段动画结束。
 */
watch(
  sidebarTransitioning,
  (transitioning) => {
    if (transitioning) {
      // 用 getBoundingClientRect 取小数宽度：容器查询按 CSS px 的连续值比较，
      // clientWidth 会取整，在 544px 边界上可能钉错一档。根节点无 padding/border，
      // border-box 宽度即容器查询用的内容盒 inline-size。
      const width =
        rootRef.value?.getBoundingClientRect().width ?? window.innerWidth;
      // @container 的 `max-width: 34rem` 含等号：宽于阈值才保留专辑列。
      pinnedGrid.value = width > NARROW_CONTAINER_MAX_PX ? "wide" : "narrow";
      return;
    }
    // 过渡结束：解除冻结，容器查询按最终宽度重排一次（唯一一次翻转）。
    pinnedGrid.value = null;
  },
  { flush: "sync" },
);

const VIRTUAL_THRESHOLD = 160;
const ROW_HEIGHT = 60;
const OVERSCAN_ROWS = 8;
const INITIAL_ROWS = 24;

const listRef = ref<HTMLElement | null>(null);
const rangeStart = ref(0);
const rangeEnd = ref(Math.min(props.songs.length, INITIAL_ROWS));
const isVirtual = computed(() => props.songs.length > VIRTUAL_THRESHOLD);

const visibleSongs = computed(() => {
  const start = isVirtual.value
    ? Math.min(rangeStart.value, props.songs.length)
    : 0;
  const end = isVirtual.value
    ? Math.max(start, Math.min(rangeEnd.value, props.songs.length))
    : props.songs.length;
  return props.songs.slice(start, end).map((song, offset) => ({
    song,
    index: start + offset,
  }));
});

const virtualPadding = computed(() => {
  if (!isVirtual.value) return undefined;
  const start = Math.min(rangeStart.value, props.songs.length);
  const end = Math.max(start, Math.min(rangeEnd.value, props.songs.length));
  return {
    paddingTop: `${start * ROW_HEIGHT}px`,
    paddingBottom: `${(props.songs.length - end) * ROW_HEIGHT}px`,
  };
});

let scrollParent: HTMLElement | Window | null = null;
let resizeObserver: ResizeObserver | null = null;
let updateFrame = 0;

function findScrollParent(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY)) return parent;
    parent = parent.parentElement;
  }
  return window;
}

function updateVisibleRange() {
  updateFrame = 0;
  const element = listRef.value;
  if (!element || !isVirtual.value || !scrollParent) {
    rangeStart.value = 0;
    rangeEnd.value = props.songs.length;
    return;
  }

  const listRect = element.getBoundingClientRect();
  const viewport =
    scrollParent instanceof HTMLElement
      ? scrollParent.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };
  const totalHeight = props.songs.length * ROW_HEIGHT;
  const visibleTop = Math.max(
    0,
    Math.min(totalHeight, viewport.top - listRect.top),
  );
  const visibleBottom = Math.max(
    0,
    Math.min(totalHeight, viewport.bottom - listRect.top),
  );
  const start = Math.max(
    0,
    Math.floor(Math.min(visibleTop, visibleBottom) / ROW_HEIGHT) -
      OVERSCAN_ROWS,
  );
  const end = Math.min(
    props.songs.length,
    Math.max(
      start + 1,
      Math.ceil(Math.max(visibleTop, visibleBottom) / ROW_HEIGHT) +
        OVERSCAN_ROWS,
    ),
  );

  rangeStart.value = start;
  rangeEnd.value = end;
}

function scheduleVisibleRangeUpdate() {
  if (updateFrame !== 0) return;
  updateFrame = window.requestAnimationFrame(updateVisibleRange);
}

function unbindVirtualScroller() {
  scrollParent?.removeEventListener("scroll", scheduleVisibleRangeUpdate);
  window.removeEventListener("resize", scheduleVisibleRangeUpdate);
  resizeObserver?.disconnect();
  resizeObserver = null;
  scrollParent = null;
  if (updateFrame !== 0) {
    window.cancelAnimationFrame(updateFrame);
    updateFrame = 0;
  }
}

function bindVirtualScroller() {
  unbindVirtualScroller();
  if (!isVirtual.value || !listRef.value) {
    rangeStart.value = 0;
    rangeEnd.value = props.songs.length;
    return;
  }

  scrollParent = findScrollParent(listRef.value);
  scrollParent.addEventListener("scroll", scheduleVisibleRangeUpdate, {
    passive: true,
  });
  window.addEventListener("resize", scheduleVisibleRangeUpdate, {
    passive: true,
  });
  if (scrollParent instanceof HTMLElement) {
    resizeObserver = new ResizeObserver(scheduleVisibleRangeUpdate);
    resizeObserver.observe(scrollParent);
  }
  updateVisibleRange();
}

watch(
  () => [isVirtual.value, props.songs.length] as const,
  async () => {
    await nextTick();
    bindVirtualScroller();
  },
  { flush: "post" },
);

onMounted(async () => {
  await nextTick();
  bindVirtualScroller();
});

onBeforeUnmount(unbindVirtualScroller);

/**
 * 单击播放与双击快捷共用同一个入口。双击在浏览器里会先派发两次 click 再派发
 * dblclick，如果每次都重建队列并重新加载音频，会出现重复取 URL 与听感抖动；
 * 因此同一首歌在双击窗口内的重复触发直接忽略。单击本身仍然立即播放。
 */
const REPEAT_ACTIVATION_MS = 400;
let lastActivatedSongId: number | null = null;
let lastActivatedAt = 0;

function playAt(idx: number) {
  const song = props.songs[idx];
  if (!song) return;
  const now = performance.now();
  if (
    song.id === lastActivatedSongId &&
    now - lastActivatedAt < REPEAT_ACTIVATION_MS
  ) {
    return;
  }
  lastActivatedSongId = song.id;
  lastActivatedAt = now;
  void player.playList(props.songs, idx);
}

function playAll() {
  if (props.songs.length === 0) return;
  void player.playList(props.songs, 0);
}

/** 整行播放按钮的无障碍名称：动作 + 歌名 + 艺人。 */
function playLabel(song: Song) {
  return `播放歌曲 ${song.name}，艺人 ${song.artists}`;
}
</script>

<template>
  <div
    ref="rootRef"
    class="song-list-root min-w-0"
    :class="{
      'song-list-root--pinned-wide': pinnedGrid === 'wide',
      'song-list-root--pinned-narrow': pinnedGrid === 'narrow',
    }"
  >
    <!-- 区块头与页面标题同一条左缘（不再额外缩进 12px），列头与行仍保留 px-3：
         数据列与行 hover 底色共用同一条内边距，表格不贴页边。 -->
    <div class="flex items-center justify-between gap-3 px-0 mb-4">
      <h2 class="song-list-heading min-w-0 text-base font-semibold text-text-primary">
        <span>{{ title ?? "歌曲列表" }}</span>
        <!-- 计数整体换行：宽列表里与标题同排，窄列表（960 下带歌词卡的详情/搜索）
             整块落到第二行，不会把「首」单独折行成孤字。 -->
        <span class="song-list-heading__count text-xs text-text-tertiary font-normal tabular-nums">
          <template v-if="totalCount !== undefined && totalCount > songs.length">
            找到 {{ totalCount }} 首，显示前 {{ songs.length }} 首
          </template>
          <template v-else>共 {{ songs.length }} 首</template>
        </span>
      </h2>
      <button
        class="btn btn-primary shrink-0 text-sm px-4 py-2"
        :disabled="songs.length === 0"
        @click="playAll"
      >
        <Play :size="14" :stroke-width="1.5" class="mr-1.5" aria-hidden="true" />播放全部
      </button>
    </div>

    <div
      v-if="showIndex"
      class="song-list-header grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2 text-xs text-text-tertiary font-medium"
    >
      <div class="text-center">序号</div>
      <div></div>
      <div>标题</div>
      <div v-if="showAlbum" class="song-list-album">专辑</div>
      <div class="text-right">时长</div>
    </div>

    <ul
      ref="listRef"
      :class="{ 'virtual-song-list': isVirtual }"
      :style="virtualPadding"
    >
      <li
        v-for="{ song, index: idx } in visibleSongs"
        :key="`${song.id}:${idx}`"
        class="song-row song-list-row group relative grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2.5 h-[60px] rounded-md transition-all duration-150 items-center"
        :class="{
          'bg-accent-subtle': currentId === song.id,
          // 当前行 hover 不能被墨色 hover 覆盖：暂停态的当前行没有逐字/脉冲，
          // 洗色是它唯一的「当前」提示（DESIGN：当前行整行铺 terracotta-wash）。
          'hover:bg-surface-strong': currentId !== song.id,
        }"
        :aria-posinset="idx + 1"
        :aria-setsize="songs.length"
        @dblclick="playAt(idx)"
      >
        <div class="relative text-xs text-text-tertiary font-medium tabular-nums text-center">
          <Play
            v-if="currentId === song.id && player.audioState.playing"
            :size="12"
            :stroke-width="2"
            class="text-accent mx-auto animate-pulse-fade"
            aria-hidden="true"
          />
          <span v-else-if="currentId === song.id" class="text-text-primary font-semibold">{{ idx + 1 }}</span>
          <span v-else class="song-row-index transition-opacity">{{ idx + 1 }}</span>
        </div>

        <!-- 封面缩略图 -->
        <div class="w-10 h-10 rounded-md bg-surface-soft overflow-hidden shrink-0">
          <img
            v-if="song.picUrl"
            :src="coverImageUrl(song.picUrl, 40)"
            class="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            fetchpriority="low"
            alt=""
          />
          <div v-else class="w-full h-full flex items-center justify-center">
            <Music2 :size="14" :stroke-width="1.25" class="text-text-tertiary" aria-hidden="true" />
          </div>
        </div>

        <!-- 标题 + 艺人 -->
        <div class="min-w-0">
          <div class="text-sm truncate text-text-primary" :class="{ 'font-medium': currentId === song.id }">
            {{ song.name }}
          </div>
          <div class="text-xs text-text-secondary truncate">
            {{ song.artists }}
          </div>
        </div>

        <!-- 专辑 -->
        <div v-if="showAlbum" class="song-list-album text-xs text-text-secondary truncate">
          {{ song.album }}
        </div>

        <!-- 时长 -->
        <div class="text-xs text-text-tertiary text-right tabular-nums font-medium">
          {{ fmtDurationMs(song.duration) }}
        </div>

        <!-- 整行覆盖的真实播放按钮：单击行内任意位置播放，Tab 可聚焦整行，
             Enter/Space 触发；hover/focus 时在序号位列露出播放图标。 -->
        <button
          type="button"
          class="song-row-play absolute inset-0 z-10 cursor-pointer rounded-md border-0 bg-transparent p-0"
          :aria-label="playLabel(song)"
          :aria-current="currentId === song.id ? 'true' : undefined"
          @click="playAt(idx)"
        >
          <span
            v-if="currentId !== song.id"
            class="absolute inset-y-0 left-3 w-10 flex items-center justify-center"
            aria-hidden="true"
          >
            <Play
              :size="12"
              :stroke-width="1.75"
              class="song-row-play-icon text-text-secondary transition-opacity"
            />
          </span>
        </button>
      </li>
    </ul>

    <div v-if="songs.length === 0" class="py-12 text-center text-text-tertiary">
      <p class="text-sm">{{ emptyTitle }}</p>
      <p class="mt-1 text-xs">{{ emptyHint }}</p>
    </div>
  </div>
</template>

<style scoped>
/* 区块标题 + 计数：默认同排；列表列窄到放不下时，计数整块换到第二行
   （white-space: nowrap 禁止在「50 首」中间断行，避免出现孤字「首」）。 */
.song-list-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 0.5rem;
}

.song-list-heading__count {
  white-space: nowrap;
}

.virtual-song-list {
  overflow-anchor: none;
}

/* 焦点指示只能靠焦点环：行内按钮铺满整行，聚焦即整行轮廓可见。 */
.song-row-play {
  outline: none;
}

.song-row-play:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* 序号在鼠标悬停或键盘聚焦时让位给播放图标。 */
.song-row-play-icon {
  opacity: 0;
}

.song-row:hover .song-row-index,
.song-row:focus-within .song-row-index {
  opacity: 0;
}

.song-row:hover .song-row-play-icon,
.song-row:focus-within .song-row-play-icon {
  opacity: 1;
}

/* 容器查询：列表自己的宽度（不是窗口宽度）决定列数，这是唯一的列策略判据。
   固定列 40+44+160+72 + 4×12 间距 = 364px（加行内边距 24px 共 388px），
   容器窄于 34rem（544px）时标题列会被压到不可读，此时去掉专辑列，
   把宽度还给标题/艺人；768 CSS 下列表容器 ≈674px，专辑列正常显示。 */
.song-list-root {
  container-name: song-list;
  container-type: inline-size;
}

@container song-list (max-width: 34rem) {
  .song-list-header,
  .song-list-row {
    grid-template-columns: 36px 40px minmax(0, 1fr) 52px;
  }

  .song-list-album {
    display: none;
  }
}

/* ===== 侧栏宽度过渡期间冻结容器查询（FIX-CONTEXT-2 #13） =====
   220ms 里列表宽度连续变化，容器查询会在中途翻转专辑列显隐并让每行重算列宽。
   过渡开始时按当时宽度钉住宽/窄列策略（类名由 App provide 的共享过渡状态驱动），
   contain 把内部重排限制在列表盒子内（行内标题是单行 truncate，不会换行）；
   `container-type: normal` 停掉逐帧的容器查询重算（结果已由下面的列策略固定）。
   过渡结束后类名移除，容器查询按最终宽度只重排一次。 */
.song-list-root--pinned-wide,
.song-list-root--pinned-narrow {
  contain: layout paint;
  container-type: normal;
}

/* 与 @container 的两个分支逐字一致，保证冻结期间视觉不跳变。 */
.song-list-root--pinned-wide .song-list-header,
.song-list-root--pinned-wide .song-list-row {
  grid-template-columns: 40px 44px 1fr 160px 72px;
}

.song-list-root--pinned-narrow .song-list-header,
.song-list-root--pinned-narrow .song-list-row {
  grid-template-columns: 36px 40px minmax(0, 1fr) 52px;
}

/* 专辑列的显隐也必须固定，否则 @container 失效后仍会按基础类显示。 */
.song-list-root--pinned-wide .song-list-album {
  display: block;
}

.song-list-root--pinned-narrow .song-list-album {
  display: none;
}
</style>
