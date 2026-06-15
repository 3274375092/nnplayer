<script setup lang="ts">
// 通用播放控制按钮组（不含进度条）。
// 用于"播放全部"按钮区域或弹出卡片。

import { usePlayerStore } from "@/stores/player";

interface Props {
  /** 是否禁用所有按钮（如队列为空） */
  disabled?: boolean;
}
withDefaults(defineProps<Props>(), { disabled: false });

const player = usePlayerStore();
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      class="btn btn-ghost"
      :disabled="disabled"
      @click="player.togglePlay"
    >
      {{ player.audioState.playing ? "暂停" : "播放" }}
    </button>
    <button
      class="btn btn-ghost"
      :disabled="disabled || !player.hasPrev"
      @click="player.prev"
    >
      上一首
    </button>
    <button
      class="btn btn-ghost"
      :disabled="disabled || !player.hasNext"
      @click="player.next"
    >
      下一首
    </button>
    <button class="btn btn-ghost" @click="player.togglePlayMode">
      模式: {{ player.playMode }}
    </button>
  </div>
</template>