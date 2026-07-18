<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { Music2, X } from "lucide-vue-next";
import LyricPanel from "@/components/LyricPanel.vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";

const player = usePlayerStore();
const router = useRouter();
const currentCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 400),
);
const blurredBackgroundCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 128),
);

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
</script>

<template>
  <div class="h-full relative overflow-hidden flex flex-col" style="background: radial-gradient(ellipse 80% 50% at 50% 40%, var(--color-bg-from) 0%, var(--color-bg-to) 100%); background-color: var(--color-bg);">
    <!-- 封面模糊背景层 -->
    <div
      v-if="player.currentSong?.picUrl"
      class="absolute inset-0 z-0"
    >
      <img
        :src="blurredBackgroundCover"
        class="absolute inset-0 w-full h-full object-cover"
        style="filter: blur(80px) saturate(1.6) brightness(0.35); transform: scale(1.1);"
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        fetchpriority="low"
      />
      <div class="absolute inset-0 bg-gradient-to-b from-bg/70 via-bg/50 to-bg/90" />
    </div>

    <header class="relative z-10 w-full flex justify-between items-center px-8 pt-7 pb-4">
      <div class="text-sm text-[rgba(255,255,255,0.3)] font-medium tracking-wider uppercase">
        正在播放
      </div>
      <button
        type="button"
        class="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95"
        aria-label="关闭正在播放"
        @click="close"
      >
        <X :size="16" :stroke-width="1.5" class="text-white/40" />
      </button>
    </header>

    <div class="relative z-10 flex-1 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-20 w-full max-w-7xl mx-auto px-4 md:px-8">
      <!-- 大封面 -->
      <div class="relative shrink-0 max-w-full">
        <!-- 呼吸发光效果 -->
        <div
          v-if="player.currentSong?.picUrl"
          class="absolute -inset-12 rounded-full pointer-events-none"
          :class="player.audioState.playing ? 'animate-cover-glow' : 'opacity-30'"
          :style="{
            background: `radial-gradient(circle, var(--color-glow) 0%, transparent 65%)`,
          }"
        />
        <div
          class="relative w-[280px] md:w-[400px] aspect-square rounded-full overflow-hidden shadow-[0_0_100px_var(--color-glow),0_0_200px_var(--color-shadow)] ring-1 ring-white/10"
          :class="player.audioState.playing ? 'motion-safe:animate-spin-slow' : 'motion-safe:animate-spin-slow [animation-play-state:paused]'"
        >
          <img
            v-if="player.currentSong?.picUrl"
            :src="currentCover"
            class="w-full h-full object-cover"
            alt=""
            loading="eager"
            decoding="async"
            fetchpriority="high"
          />
          <Music2
            v-else
            :size="80"
            :stroke-width="1.5"
            class="text-white/15"
          />
        </div>
      </div>

      <!-- 右侧：信息 + 歌词 -->
      <div class="flex-1 max-w-lg min-w-0 flex flex-col gap-6">
        <div>
          <h1 class="text-3xl font-semibold mb-2 truncate text-white/90">
            {{ player.currentSong?.name ?? "尚未播放" }}
          </h1>
          <p class="text-base text-white/35 truncate">
            {{ player.currentSong?.artists ?? "—" }}
            <span v-if="player.currentSong?.album" class="mx-1.5 opacity-40">·</span>
            <span v-if="player.currentSong?.album">{{ player.currentSong.album }}</span>
          </p>
        </div>

        <LyricPanel :panel-height="420" :line-height="40" />
      </div>
    </div>
  </div>
</template>
