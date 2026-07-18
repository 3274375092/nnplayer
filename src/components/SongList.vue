<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { Play, Music2 } from "lucide-vue-next";
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

function playAt(idx: number) {
  void player.playList(props.songs, idx);
}

function playAll() {
  if (props.songs.length === 0) return;
  void player.playList(props.songs, 0);
}
</script>

<template>
  <div class="bg-[rgba(255,255,255,0.03)] border border-border rounded-2xl p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-base font-semibold text-[rgba(255,255,255,0.9)]">
        {{ title ?? "歌曲列表" }}
        <span class="text-xs text-[rgba(255,255,255,0.3)] ml-2 font-normal">
          共 {{ songs.length }} 首
        </span>
      </h2>
      <button
        class="btn btn-primary rounded-xl text-xs px-4 py-2"
        :disabled="songs.length === 0"
        @click="playAll"
      >
        <Play :size="14" :stroke-width="1.5" class="mr-1.5" />播放全部
      </button>
    </div>

    <div
      v-if="showIndex"
      class="grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2 text-xs text-text-tertiary border-b border-border font-medium mobile-song-grid-header"
    >
      <div>#</div>
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
        class="grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2.5 h-[60px] rounded-xl hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-all duration-150 items-center group relative mobile-song-grid"
        :class="{
          'bg-[rgba(232,93,58,0.06)]': currentId === song.id,
        }"
        :aria-posinset="idx + 1"
        :aria-setsize="songs.length"
        @dblclick="playAt(idx)"
      >
        <!-- 左侧 accent 指示线 -->
        <div
          v-if="currentId === song.id"
          class="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r"
        />

        <div class="relative text-xs text-[rgba(255,255,255,0.3)] font-medium tabular-nums text-center">
          <Play
            v-if="currentId === song.id && player.audioState.playing"
            :size="12"
            :stroke-width="2"
            class="text-accent mx-auto animate-play-pulse"
          />
          <span v-else-if="currentId === song.id" class="text-accent font-semibold">{{ idx + 1 }}</span>
          <span v-else class="group-hover:opacity-0 transition-opacity">{{ idx + 1 }}</span>
          <Play
            v-if="currentId !== song.id"
            :size="12"
            :stroke-width="1.75"
            class="text-white/40 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>

        <!-- 封面缩略图 -->
        <div class="w-10 h-10 rounded-lg bg-[rgba(255,255,255,0.04)] overflow-hidden shrink-0 ring-1 ring-ring">
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
            <Music2 :size="14" :stroke-width="1.25" class="text-white/15" />
          </div>
        </div>

        <!-- 标题 + 艺人 -->
        <div class="min-w-0">
          <div class="text-sm truncate" :class="currentId === song.id ? 'text-accent font-medium' : 'text-[rgba(255,255,255,0.8)]'">
            {{ song.name }}
          </div>
          <div class="text-xs text-[rgba(255,255,255,0.35)] truncate">
            {{ song.artists }}
          </div>
        </div>

        <!-- 专辑 -->
        <div v-if="showAlbum" class="song-list-album text-xs text-[rgba(255,255,255,0.35)] truncate">
          {{ song.album }}
        </div>

        <!-- 时长 -->
        <div class="text-xs text-[rgba(255,255,255,0.3)] text-right tabular-nums font-medium">
          {{ fmtDurationMs(song.duration) }}
        </div>
      </li>
    </ul>

    <div v-if="songs.length === 0" class="py-12 text-center text-[rgba(255,255,255,0.3)] text-sm">
      暂无歌曲
    </div>
  </div>
</template>

<style scoped>
.virtual-song-list {
  overflow-anchor: none;
}

@media (max-width: 768px) {
  .song-list-album {
    display: none;
  }
}
</style>
