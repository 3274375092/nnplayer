<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
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
}

const props = withDefaults(defineProps<Props>(), {
  showIndex: true,
  showAlbum: true,
});

const player = usePlayerStore();

const currentId = computed(() => player.currentSong?.id ?? null);

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
  <div class="song-list-root min-w-0">
    <div class="flex items-center justify-between gap-3 px-3 mb-4">
      <h2 class="text-base font-semibold text-text-primary">
        {{ title ?? "歌曲列表" }}
        <span class="text-xs text-text-tertiary ml-2 font-normal">
          共 {{ songs.length }} 首
        </span>
      </h2>
      <button
        class="btn btn-primary shrink-0 text-xs px-4 py-2"
        :disabled="songs.length === 0"
        @click="playAll"
      >
        <Play :size="14" :stroke-width="1.5" class="mr-1.5" aria-hidden="true" />播放全部
      </button>
    </div>

    <div
      v-if="showIndex"
      class="song-list-header grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2 text-xs text-text-tertiary font-medium mobile-song-grid-header"
    >
      <div>序号</div>
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
        class="song-row song-list-row group relative grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2.5 h-[60px] rounded-md hover:bg-surface-strong transition-all duration-150 items-center mobile-song-grid"
        :class="{
          'bg-accent-subtle': currentId === song.id,
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
            class="text-accent mx-auto animate-play-pulse"
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

    <div v-if="songs.length === 0" class="py-12 text-center text-text-tertiary text-sm">
      这里还没有歌曲
    </div>
  </div>
</template>

<style scoped>
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

@media (max-width: 768px) {
  .song-list-album {
    display: none;
  }
}

/* 容器查询：列表自己的宽度（不是窗口宽度）决定列数。
   固定列 40+44+160+72 + 4×12 间距 = 364px，容器窄于 34rem 时
   标题列会被压到不可读，此时去掉专辑列，把宽度还给标题/艺人。 */
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
</style>
