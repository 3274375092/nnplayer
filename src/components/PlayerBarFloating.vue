<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  Loader2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-vue-next";
import ProgressBar from "@/components/ProgressBar.vue";
import { fmtDuration } from "@/utils/format";
import ScrollText from "@/components/ScrollText.vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";

const player = usePlayerStore();
const router = useRouter();

const cur = computed(() => fmtDuration(player.audioState.currentTime));
const dur = computed(() => fmtDuration(player.audioState.duration));
const currentCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 48),
);

function onSeek(v: number) {
  player.seek(v);
}

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  player.setVolume(v);
}

const modeIcon = computed(() => {
  switch (player.playMode) {
    case "loop-one":
      return Repeat1;
    case "shuffle":
      return Shuffle;
    default:
      return Repeat;
  }
});

const modeLabel = computed(() => {
  switch (player.playMode) {
    case "loop-one":
      return "单曲循环";
    case "shuffle":
      return "随机播放";
    default:
      return "列表循环";
  }
});

function openNowPlaying() {
  void router.push("/now-playing");
}
</script>

<template>
  <footer
    class="player-bar-grid group fixed bottom-3 left-1/2 -translate-x-1/2 w-[780px] max-w-[calc(100vw-24px)] h-[72px] bg-[rgba(18,18,20,0.9)] backdrop-blur-2xl border border-border shadow-[0_12px_40px_var(--color-shadow),0_-1px_0_var(--color-accent-subtle),inset_0_1px_0_rgba(255,255,255,0.05)] items-center px-5 gap-5 z-50 motion-reduce:transition-none mobile-player-bar"
    role="region"
    aria-label="播放控制"
  >
    <!-- 左：cover + info -->
    <div class="mobile-song-section flex items-center gap-4 w-full min-w-0">
      <button
        type="button"
        class="mobile-player-cover relative w-12 h-12 shrink-0 focus-visible:ring-2 ring-accent outline-none"
        :title="player.currentSong ? '进入正在播放' : '尚未播放'"
        @click="openNowPlaying"
      >
        <div
          class="absolute inset-0 ring-1 ring-white/10 pointer-events-none z-10"
        />
        <img
          v-if="player.currentSong?.picUrl"
          :src="currentCover"
          alt=""
          class="w-full h-full object-cover shadow-lg"
          loading="eager"
          decoding="async"
          fetchpriority="high"
        />
        <Music2
          v-else
          :size="20"
          :stroke-width="1.5"
          class="text-[rgba(255,255,255,0.3)]"
        />
      </button>
      <div class="mobile-song-info min-w-0 flex-1">
        <ScrollText
          :text="player.currentSong?.name ?? '尚未播放'"
          class="text-sm font-medium text-[rgba(255,255,255,0.9)]"
        />
        <ScrollText
          :text="player.currentSong?.artists ?? '—'"
          class="text-xs text-[rgba(255,255,255,0.4)]"
        />
      </div>
    </div>

    <!-- 中：control + progress -->
    <div class="w-full flex flex-col items-center gap-1.5 min-w-0">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.8)] focus-visible:opacity-100 focus-visible:outline-none"
          :title="`播放模式：${modeLabel}`"
          :aria-label="`播放模式：${modeLabel}`"
          @click="player.togglePlayMode"
        >
          <component :is="modeIcon" :size="15" :stroke-width="1.5" />
        </button>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.8)] focus-visible:opacity-100 focus-visible:outline-none"
          :disabled="!player.hasPrev"
          aria-label="上一首"
          @click="player.prev"
        >
          <SkipBack :size="16" :stroke-width="1.5" />
        </button>
        <button
          type="button"
          class="relative w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 ring-accent/50"
          :class="{ 'animate-play-pulse': player.audioState.playing && !player.audioState.loading }"
          :disabled="!player.currentSong"
          :aria-label="player.audioState.playing ? '暂停' : '播放'"
          @click="player.togglePlay"
        >
          <Loader2
            v-if="player.audioState.loading"
            :size="16"
            :stroke-width="1.5"
            class="animate-spin"
          />
          <Pause v-else-if="player.audioState.playing" :size="16" :stroke-width="1.5" />
          <Play v-else :size="16" :stroke-width="1.5" class="ml-0.5" />
        </button>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.8)] focus-visible:opacity-100 focus-visible:outline-none"
          :disabled="!player.hasNext"
          aria-label="下一首"
          @click="player.next"
        >
          <SkipForward :size="16" :stroke-width="1.5" />
        </button>
      </div>
      <div class="w-full flex items-center gap-2">
        <span class="text-[11px] text-[rgba(255,255,255,0.3)] tabular-nums w-9 text-right font-medium">
          {{ cur }}
        </span>
        <ProgressBar
          :value="player.audioState.currentTime"
          :max="player.audioState.duration || 0"
          @change="onSeek"
          class="flex-1 min-w-0"
        />
        <span class="text-[11px] text-[rgba(255,255,255,0.3)] tabular-nums w-9 font-medium">
          {{ dur }}
        </span>
      </div>
    </div>

    <!-- 右：volume -->
    <div
      class="w-[140px] justify-self-end flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] mobile-hide-on-small"
    >
      <Volume2
        :size="15"
        :stroke-width="1.5"
        class="text-[rgba(255,255,255,0.35)]"
        aria-hidden="true"
      />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.audioState.volume"
        class="flex-1 h-1 appearance-none bg-[rgba(255,255,255,0.1)] cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[rgba(0,0,0,0.2)]"
        :aria-label="`音量 ${Math.round(player.audioState.volume * 100)}%`"
        @input="onVolume"
        style="accent-color: var(--color-accent);"
      />
    </div>
  </footer>
</template>

<style scoped>
.player-bar-grid {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    clamp(240px, 42vw, 320px)
    minmax(0, 1fr);
}

/* 极窄窗口只保留封面，左右各占同样宽度，中间控制区仍严格居中。 */
@media (max-width: 520px) {
  .player-bar-grid {
    grid-template-columns: 40px minmax(0, 1fr) 40px;
  }

  .mobile-song-section {
    gap: 0;
  }

  .mobile-song-info {
    display: none;
  }

  .mobile-player-cover {
    width: 40px;
    height: 40px;
  }
}
</style>
