<script setup lang="ts">
import { computed } from "vue";
import { Music2, Play } from "@lucide/vue";
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

defineEmits<{
  (e: "click"): void;
}>();
</script>

<template>
  <button
    v-if="variant === 'playlist' && playlist"
    type="button"
    class="playlist-tile group block w-full border-0 bg-transparent p-0 pb-0.5 text-left outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 focus-visible:-translate-y-0.5 active:translate-y-0 active:scale-[0.985]"
    @click="$emit('click')"
  >
    <span class="playlist-cover relative block aspect-square w-full overflow-hidden rounded-[18px] bg-surface-soft ring-1 ring-ring transition-shadow duration-300 group-hover:shadow-[0_18px_38px_rgba(0,0,0,0.38)] group-focus-visible:shadow-[0_18px_38px_rgba(0,0,0,0.38)]">
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
      <span class="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
      <span class="playlist-play-overlay" aria-hidden="true">
        <Play :size="19" :stroke-width="2.5" />
      </span>
    </span>
    <span class="playlist-title mt-3 block px-0.5 text-sm font-semibold leading-[1.35] tracking-[-0.01em] text-text-primary">{{ playlistName }}</span>
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

.playlist-play-overlay {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  visibility: hidden;
  border-radius: 999px;
  color: var(--color-on-accent);
  background: var(--color-accent);
  opacity: 0;
  box-shadow: none;
  transform: translateY(0.375rem) scale(0.95);
  transition:
    opacity 200ms ease,
    transform 260ms cubic-bezier(0.32, 0.72, 0, 1),
    visibility 0s linear 260ms;
}

.playlist-tile:hover .playlist-play-overlay,
.playlist-tile:focus-visible .playlist-play-overlay {
  visibility: visible;
  opacity: 1;
  transform: translateY(0) scale(1);
  transition-delay: 0s;
}

.playlist-tile:focus-visible .playlist-cover {
  box-shadow:
    0 0 0 2px var(--color-bg),
    0 0 0 4px var(--color-accent);
}
</style>
