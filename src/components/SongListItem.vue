<script setup lang="ts">
import { computed } from "vue";
import { ChevronRight, Music2, Play } from "@lucide/vue";
import type { Playlist, Song } from "@/types/music";
import { coverImageUrl } from "@/utils/coverImage";

interface Props {
  playlist?: Playlist;
  song?: Song;
  variant?: "playlist" | "song";
}

const props = withDefaults(defineProps<Props>(), { variant: "playlist" });
const playlistCover = computed(() =>
  coverImageUrl(props.playlist?.coverUrl, 240),
);
const playlistName = computed(() => {
  const name = typeof props.playlist?.name === "string"
    ? props.playlist.name.trim()
    : "";
  return name && !/^(null|undefined)$/i.test(name) ? name : "未命名歌单";
});
/** 整卡的唯一动作是「打开歌单」：无障碍名称写成动作 + 可见元信息。 */
const openLabel = computed(() => {
  const creator = typeof props.playlist?.creator === "string"
    ? props.playlist.creator.trim()
    : "";
  const count = typeof props.playlist?.trackCount === "number"
    ? `，${props.playlist.trackCount} 首`
    : "";
  return `打开歌单：${playlistName.value}${count}${creator ? `，${creator}` : ""}`;
});

defineEmits<{
  (e: "click"): void;
}>();
</script>

<template>
  <button
    v-if="variant === 'playlist' && playlist"
    type="button"
    class="playlist-tile group block w-full border-0 bg-transparent p-0 pb-0.5 text-left transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 focus-visible:-translate-y-0.5 active:translate-y-0 active:scale-[0.985]"
    :aria-label="openLabel"
    title="打开歌单"
    @click="$emit('click')"
  >
    <span class="playlist-cover relative block aspect-square w-full overflow-hidden rounded-[18px] bg-surface-soft transition-shadow duration-300">
      <img
        v-if="playlist.coverUrl"
        :src="playlistCover"
        alt=""
        class="block h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.045] group-focus-visible:scale-[1.045]"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
      />
      <span v-else class="flex h-full w-full items-center justify-center bg-surface-soft text-tertiary" aria-hidden="true">
        <Music2 :size="44" :stroke-width="1.25" />
      </span>
      <!-- 悬停/聚焦：暖色 scrim（炭墨 → 陶土洗色），不用纯黑渐变。 -->
      <span class="playlist-scrim absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
      <!-- 「打开歌单」提示：整卡仍是唯一交互元素，这里只是方向图标。 -->
      <span class="playlist-open-hint" aria-hidden="true">
        <ChevronRight :size="18" :stroke-width="1.75" />
      </span>
    </span>
    <span class="playlist-title mt-3 block px-0.5 text-sm font-semibold leading-[1.35] text-text-primary">{{ playlistName }}</span>
    <span class="mt-1 block truncate px-0.5 text-xs text-tertiary transition-colors duration-200 group-hover:text-text-secondary group-focus-visible:text-text-secondary">
      {{ playlist.trackCount }} 首
      <span v-if="playlist.creator"> · {{ playlist.creator }}</span>
    </span>
  </button>

  <button
    v-else-if="variant === 'song' && song"
    type="button"
    class="group block w-full bg-surface-soft rounded-md p-3.5 cursor-pointer text-left hover:bg-surface-strong hover:-translate-y-1 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
    @click="$emit('click')"
  >
    <div class="aspect-square rounded-md bg-surface-soft mb-3 flex items-center justify-center relative">
      <Music2 :size="48" :stroke-width="1.25" class="text-text-tertiary group-hover:scale-110 transition-transform duration-300" />
      <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
        <div class="w-12 h-12 rounded-full bg-accent text-on-accent flex items-center justify-center shadow-[0_8px_24px_var(--color-glow)] scale-90 group-hover:scale-100 transition-transform duration-300">
          <Play :size="20" :stroke-width="2.5" class="ml-0.5" />
        </div>
      </div>
    </div>
    <div class="text-sm font-medium truncate text-text-primary group-hover:text-accent transition-colors">{{ song.name }}</div>
    <div class="text-xs text-text-secondary truncate mt-0.5">{{ song.artists }}</div>
  </button>
</template>

<style scoped>
.playlist-title {
  display: -webkit-box;
  min-height: 2.7em;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* 封面悬停遮罩：用调色板内的炭墨与陶土洗色叠出暖色 scrim，
   代替原先的纯黑渐变（DESIGN 只允许遮罩/桌面歌词板/窄窗侧栏浮层用黑，
   且纸面上不再新增第三块黑色表面）。 */
.playlist-scrim {
  background-image: linear-gradient(
    to top,
    color-mix(in srgb, var(--color-text-primary) 28%, transparent) 0%,
    color-mix(in srgb, var(--color-accent) 14%, transparent) 44%,
    transparent 76%
  );
}

/* 「打开歌单」提示：纸面小方块 + 18px/1.75 的 ChevronRight。
   整体仍是同一个按钮，所以点击提示与点击封面都执行导航。 */
.playlist-open-hint {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  visibility: hidden;
  border-radius: 6px;
  color: var(--color-text-primary);
  background: var(--color-raised);
  opacity: 0;
  box-shadow: var(--shadow-raised);
  transform: translateY(0.375rem) scale(0.94);
  transition:
    opacity 200ms ease,
    transform 260ms cubic-bezier(0.32, 0.72, 0, 1),
    visibility 0s linear 260ms;
}

.playlist-tile:hover .playlist-open-hint,
.playlist-tile:focus-visible .playlist-open-hint {
  visibility: visible;
  opacity: 1;
  transform: translateY(0) scale(1);
  transition-delay: 0s;
}

/* 触摸/笔没有 hover：把「打开歌单」提示常显——整卡只有一个点击目标，
   不能让导航提示只能靠悬停才出现。 */
@media (hover: none) {
  .playlist-open-hint {
    visibility: visible;
    opacity: 1;
    transform: none;
    transition: none;
  }
}

.playlist-tile:hover .playlist-cover {
  box-shadow: var(--shadow-floating);
}

/* 焦点走 true outline（forced-colors 下可见），封面上的暗色 shadow ring 只作装饰；
   整卡（封面 + 两行文字）都是同一个按钮，焦点环包住整卡而不是只圈封面。 */
.playlist-tile {
  border-radius: 18px;
}

.playlist-tile:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.playlist-tile:focus-visible .playlist-cover {
  box-shadow:
    0 0 0 2px var(--color-bg),
    0 0 0 4px var(--color-accent),
    var(--shadow-floating);
}
</style>
