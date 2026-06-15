<script setup lang="ts">
// 通用歌曲列表组件。
// 接收 songs 数组 + 可选标题；点击行触发 playAt(index)。
// 当前播放歌曲行高亮。

import { computed } from "vue";
import { Play } from "lucide-vue-next";
import type { Song } from "@/types/music";
import { usePlayerStore } from "@/stores/player";

interface Props {
  songs: Song[];
  /** 列表标题 */
  title?: string;
  /** 是否显示序号（歌单详情等场景可关闭） */
  showIndex?: boolean;
  /** 是否显示专辑列 */
  showAlbum?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showIndex: true,
  showAlbum: true,
});

const player = usePlayerStore();

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 当前播放歌曲 id
const currentId = computed(() => player.currentSong?.id ?? null);

// 点击单首歌曲播放
function playAt(idx: number) {
  void player.playList(props.songs, idx);
}

// 播放全部（直接从头开始）
function playAll() {
  if (props.songs.length === 0) return;
  void player.playList(props.songs, 0);
}
</script>

<template>
  <div class="card p-4">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold">
        {{ title ?? "歌曲列表" }}
        <span class="text-xs text-text-secondary ml-2">
          共 {{ songs.length }} 首
        </span>
      </h2>
      <button
        class="btn btn-primary"
        :disabled="songs.length === 0"
        @click="playAll"
      >
        播放全部
      </button>
    </div>

    <!-- 表头 -->
    <div
      v-if="showIndex"
      class="grid grid-cols-[40px_1fr_180px_80px] gap-3 px-2 py-2 text-xs text-text-secondary border-b border-hover"
    >
      <div>#</div>
      <div>标题</div>
      <div v-if="showAlbum">专辑</div>
      <div class="text-right">时长</div>
    </div>

    <!-- 列表 -->
    <ul>
      <li
        v-for="(song, idx) in songs"
        :key="song.id"
        class="grid grid-cols-[40px_1fr_180px_80px] gap-3 px-2 py-2 rounded-btn hover:bg-hover cursor-pointer transition-colors items-center"
        :class="{
          'bg-hover': currentId === song.id,
        }"
        @dblclick="playAt(idx)"
      >
        <div class="text-xs text-text-secondary">
          <Play
            v-if="currentId === song.id && player.audioState.playing"
            :size="12"
            :stroke-width="2"
            class="text-accent"
          />
          <span v-else>{{ idx + 1 }}</span>
        </div>
        <div class="min-w-0">
          <div class="text-sm truncate" :class="{ 'text-accent': currentId === song.id }">
            {{ song.name }}
          </div>
          <div class="text-xs text-text-secondary truncate">
            {{ song.artists }}
          </div>
        </div>
        <div v-if="showAlbum" class="text-xs text-text-secondary truncate">
          {{ song.album }}
        </div>
        <div class="text-xs text-text-secondary text-right tabular-nums">
          {{ fmt(song.duration) }}
        </div>
      </li>
    </ul>

    <div v-if="songs.length === 0" class="py-10 text-center text-text-secondary text-sm">
      暂无歌曲
    </div>
  </div>
</template>
