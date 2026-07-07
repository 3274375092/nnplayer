<script setup lang="ts">
import { computed } from "vue";
import { Play, Music2 } from "lucide-vue-next";
import type { Song } from "@/types/music";
import { usePlayerStore } from "@/stores/player";
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
      <div v-if="showAlbum">专辑</div>
      <div class="text-right">时长</div>
    </div>

    <ul>
      <li
        v-for="(song, idx) in songs"
        :key="song.id"
        class="grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2.5 rounded-xl hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-all duration-150 items-center group relative mobile-song-grid"
        :class="{
          'bg-[rgba(232,93,58,0.06)]': currentId === song.id,
        }"
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
            :src="song.picUrl"
            class="w-full h-full object-cover"
            loading="lazy"
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
        <div v-if="showAlbum" class="text-xs text-[rgba(255,255,255,0.35)] truncate">
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
