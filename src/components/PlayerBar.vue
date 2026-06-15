<script setup lang="ts">
// 底部 80px 固定播放栏（已弃用,保留以便阶段 2 移动端回退）。
// 当前默认使用 PlayerBarFloating.vue。本组件不再维护图标系统。

import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const cur = computed(() => fmt(player.audioState.currentTime));
const dur = computed(() => fmt(player.audioState.duration));

const progress = computed(() => {
  const d = player.audioState.duration;
  if (!d) return 0;
  return (player.audioState.currentTime / d) * 100;
});

function onSeek(e: Event) {
  const target = e.target as HTMLInputElement;
  const ratio = Number(target.value) / 100;
  player.seek(player.audioState.duration * ratio);
}

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  player.setVolume(v);
}

const modeIcon = computed(() => {
  switch (player.playMode) {
    case "loop-one":
      return "单曲";
    case "shuffle":
      return "随机";
    default:
      return "列表";
  }
});
</script>

<template>
  <footer
    class="bg-card/80 backdrop-blur-lg border-t border-hover px-6 flex items-center gap-6"
    style="--tw-bg-opacity: 0.85"
  >
    <!-- 左侧：当前歌曲信息 -->
    <div class="flex items-center gap-3 w-[300px] shrink-0">
      <div
        class="w-12 h-12 rounded-full bg-hover flex items-center justify-center text-text-secondary text-xs shrink-0 overflow-hidden"
        :class="{ 'animate-spin-slow': player.audioState.playing }"
      >
        <img
          v-if="player.currentSong?.picUrl"
          :src="player.currentSong.picUrl"
          class="w-full h-full object-cover"
          alt=""
        />
        <span v-else>♪</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium truncate">
          {{ player.currentSong?.name ?? "尚未播放" }}
        </div>
        <div class="text-xs text-text-secondary truncate">
          {{ player.currentSong?.artists ?? "—" }}
        </div>
      </div>
    </div>

    <!-- 中间：控制 + 进度 -->
    <div class="flex-1 flex flex-col items-center gap-1">
      <div class="flex items-center gap-4">
        <button
          class="btn btn-ghost px-2"
          :title="`播放模式：${modeIcon}`"
          @click="player.togglePlayMode"
        >
          <span class="text-xs">{{ modeIcon }}</span>
        </button>

        <button
          class="btn btn-ghost px-2"
          :disabled="!player.hasPrev"
          @click="player.prev"
        >
          ⏮
        </button>

        <button
          class="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50"
          :disabled="!player.currentSong"
          @click="player.togglePlay"
        >
          <span v-if="player.audioState.loading">…</span>
          <span v-else-if="player.audioState.playing">⏸</span>
          <span v-else>▶</span>
        </button>

        <button
          class="btn btn-ghost px-2"
          :disabled="!player.hasNext"
          @click="player.next"
        >
          ⏭
        </button>
      </div>

      <!-- 进度条 -->
      <div class="w-full flex items-center gap-2">
        <span class="text-xs text-text-secondary tabular-nums w-10 text-right">
          {{ cur }}
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          :value="progress"
          class="flex-1 accent-accent"
          @input="onSeek"
        />
        <span class="text-xs text-text-secondary tabular-nums w-10">
          {{ dur }}
        </span>
      </div>
    </div>

    <!-- 右侧：音量 -->
    <div class="w-[180px] flex items-center gap-2 shrink-0">
      <span class="text-sm text-text-secondary">🔊</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.audioState.volume"
        class="flex-1 accent-accent"
        @input="onVolume"
      />
    </div>
  </footer>
</template>