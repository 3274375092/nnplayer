<script setup lang="ts">
// NowPlaying 全屏播放页（半模态，不创建新窗口）。
// 参考 ZeroBit-Player lib/pages/play_page.dart。
// - Hero 大封面 + 旋转动画（playing 时 spin，pause 时停）
// - 标题 + 艺人 + 专辑
// - 右侧 LyricPanel（行间模糊 + 卡拉OK 见阶段 3）
// - 底部进度条
// - ESC 关闭

import { onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { Music2, Pause, Play, X } from "lucide-vue-next";
import LyricPanel from "@/components/LyricPanel.vue";
import ProgressBar from "@/components/ProgressBar.vue";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();
const router = useRouter();

function close() {
  void router.back();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});

function onSeek(v: number) {
  player.seek(v);
}
</script>

<template>
  <div class="h-full flex flex-col items-center px-16 py-8">
    <header class="w-full flex justify-end">
      <button
        type="button"
        class="btn btn-ghost p-2"
        aria-label="关闭正在播放"
        @click="close"
      >
        <X :size="18" :stroke-width="1.75" />
      </button>
    </header>

    <div class="flex-1 flex items-center justify-center gap-12 w-full max-w-6xl">
      <!-- 大封面 -->
      <div
        class="w-[480px] aspect-square rounded-full overflow-hidden shadow-2xl ring-1 ring-accent/20 shrink-0 max-w-full"
        :class="player.audioState.playing ? 'motion-safe:animate-spin-slow' : 'motion-safe:animate-spin-slow [animation-play-state:paused]'"
      >
        <img
          v-if="player.currentSong?.picUrl"
          :src="player.currentSong.picUrl"
          class="w-full h-full object-cover"
          alt=""
        />
        <Music2
          v-else
          :size="80"
          :stroke-width="1.5"
          class="text-text-secondary"
        />
      </div>

      <!-- 右侧：信息 + 歌词 -->
      <div class="flex-1 max-w-md min-w-0 flex flex-col gap-6">
        <div>
          <h1 class="text-3xl font-semibold mb-2 truncate">
            {{ player.currentSong?.name ?? "尚未播放" }}
          </h1>
          <p class="text-base text-text-secondary truncate">
            {{ player.currentSong?.artists ?? "—" }}
            <span v-if="player.currentSong?.album" class="mx-1">·</span>
            <span v-if="player.currentSong?.album">{{ player.currentSong.album }}</span>
          </p>
        </div>
        <LyricPanel />
      </div>
    </div>

    <footer class="w-full max-w-3xl flex items-center gap-4">
      <ProgressBar
        :value="player.audioState.currentTime"
        :max="player.audioState.duration || 0"
        @change="onSeek"
        class="flex-1"
      />
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!player.currentSong"
        @click="player.togglePlay"
      >
        <Pause v-if="player.audioState.playing" :size="16" :stroke-width="1.75" class="mr-1" />
        <Play v-else :size="16" :stroke-width="1.75" class="mr-1" />
        <span>{{ player.audioState.playing ? "暂停" : "播放" }}</span>
      </button>
    </footer>
  </div>
</template>
