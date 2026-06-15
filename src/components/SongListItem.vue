<script setup lang="ts">
// 单个歌单元（卡片网格视图）。
// 用于"我的歌单"封面墙和歌单详情头部信息卡。

import type { Playlist, Song } from "@/types/music";

interface Props {
  /** 当为歌单时显示 playlist */
  playlist?: Playlist;
  /** 当为歌曲时显示 song（用于迷你推荐） */
  song?: Song;
  /** 点击事件，由父组件决定行为 */
  variant?: "playlist" | "song";
}

withDefaults(defineProps<Props>(), { variant: "playlist" });

defineEmits<{
  (e: "click"): void;
}>();
</script>

<template>
  <!-- 歌单卡片 -->
  <div
    v-if="variant === 'playlist' && playlist"
    class="card p-3 cursor-pointer hover:shadow-card transition-shadow"
    @click="$emit('click')"
  >
    <div class="aspect-square rounded-btn bg-hover mb-3 overflow-hidden">
      <img
        v-if="playlist.coverUrl"
        :src="playlist.coverUrl"
        :alt="playlist.name"
        class="w-full h-full object-cover"
      />
    </div>
    <div class="text-sm font-medium truncate">{{ playlist.name }}</div>
    <div class="text-xs text-text-secondary truncate">
      {{ playlist.trackCount }} 首
      <span v-if="playlist.creator"> · {{ playlist.creator }}</span>
    </div>
  </div>

  <!-- 单曲卡片 -->
  <div
    v-else-if="variant === 'song' && song"
    class="card p-3 cursor-pointer hover:shadow-card transition-shadow"
    @click="$emit('click')"
  >
    <div class="aspect-square rounded-btn bg-hover mb-3 flex items-center justify-center text-3xl">
      ♪
    </div>
    <div class="text-sm font-medium truncate">{{ song.name }}</div>
    <div class="text-xs text-text-secondary truncate">{{ song.artists }}</div>
  </div>
</template>