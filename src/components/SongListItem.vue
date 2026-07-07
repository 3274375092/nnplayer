<script setup lang="ts">
import { Music2, Play } from "lucide-vue-next";
import type { Playlist, Song } from "@/types/music";

interface Props {
  playlist?: Playlist;
  song?: Song;
  variant?: "playlist" | "song";
}

const props = withDefaults(defineProps<Props>(), { variant: "playlist" });

defineEmits<{
  (e: "click"): void;
}>();
</script>

<template>
  <div
    v-if="variant === 'playlist' && playlist"
    class="group bg-[rgba(255,255,255,0.03)] border border-border rounded-2xl p-3.5 cursor-pointer hover:bg-card-hover hover:border-border-strong hover:-translate-y-1 hover:shadow-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
    @click="$emit('click')"
  >
    <div class="aspect-square rounded-xl bg-[rgba(255,255,255,0.04)] mb-3 overflow-hidden ring-1 ring-ring relative">
      <img
        v-if="playlist.coverUrl"
        :src="playlist.coverUrl"
        :alt="playlist.name"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
        <div class="w-12 h-12 rounded-full bg-accent/90 flex items-center justify-center shadow-lg shadow-accent/30 backdrop-blur-sm scale-90 group-hover:scale-100 transition-transform duration-300">
          <Play :size="20" :stroke-width="2.5" class="text-white ml-0.5" />
        </div>
      </div>
    </div>
    <div class="text-sm font-medium truncate text-[rgba(255,255,255,0.8)] group-hover:text-white/90 transition-colors">{{ playlist.name }}</div>
    <div class="text-xs text-[rgba(255,255,255,0.35)] truncate mt-0.5">
      {{ playlist.trackCount }} 首
      <span v-if="playlist.creator"> · {{ playlist.creator }}</span>
    </div>
  </div>

  <div
    v-else-if="variant === 'song' && song"
    class="group bg-[rgba(255,255,255,0.03)] border border-border rounded-2xl p-3.5 cursor-pointer hover:bg-card-hover hover:border-border-strong hover:-translate-y-1 hover:shadow-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
    @click="$emit('click')"
  >
    <div class="aspect-square rounded-xl bg-[rgba(255,255,255,0.04)] mb-3 flex items-center justify-center ring-1 ring-[rgba(255,255,255,0.06)] relative">
      <Music2 :size="48" :stroke-width="1.25" class="text-[rgba(255,255,255,0.15)] group-hover:scale-110 transition-transform duration-300" />
      <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
        <div class="w-12 h-12 rounded-full bg-accent/90 flex items-center justify-center shadow-lg shadow-accent/30 backdrop-blur-sm scale-90 group-hover:scale-100 transition-transform duration-300">
          <Play :size="20" :stroke-width="2.5" class="text-white ml-0.5" />
        </div>
      </div>
    </div>
    <div class="text-sm font-medium truncate text-[rgba(255,255,255,0.8)] group-hover:text-white/90 transition-colors">{{ song.name }}</div>
    <div class="text-xs text-[rgba(255,255,255,0.35)] truncate mt-0.5">{{ song.artists }}</div>
  </div>
</template>
