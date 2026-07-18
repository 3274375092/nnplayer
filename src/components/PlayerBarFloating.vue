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
    class="player-bar-grid mobile-player-bar"
    role="region"
    aria-label="播放控制"
  >
    <!-- 左：cover + info -->
    <div class="mobile-song-section flex items-center gap-4 w-full min-w-0">
      <button
        type="button"
        class="player-cover-button mobile-player-cover relative w-12 h-12 shrink-0"
        :title="player.currentSong ? '进入正在播放' : '尚未播放'"
        @click="openNowPlaying"
      >
        <div
          class="player-cover-edge absolute inset-0 pointer-events-none z-10"
        />
        <img
          v-if="player.currentSong?.picUrl"
          :src="currentCover"
          alt=""
          class="w-full h-full object-cover"
          loading="eager"
          decoding="async"
          fetchpriority="high"
        />
        <Music2
          v-else
          :size="20"
          :stroke-width="1.5"
          class="text-[rgba(255,255,255,0.42)]"
        />
      </button>
      <div class="mobile-song-info min-w-0 flex-1">
        <ScrollText
          :text="player.currentSong?.name ?? '尚未播放'"
          class="text-sm font-medium text-[rgba(255,255,255,0.9)]"
        />
        <ScrollText
          :text="player.currentSong?.artists ?? '—'"
          class="text-xs text-[rgba(255,255,255,0.56)]"
        />
      </div>
    </div>

    <!-- 中：control + progress -->
    <div class="w-full flex flex-col items-center gap-1.5 min-w-0">
      <div class="player-transport flex items-center">
        <button
          type="button"
          class="player-icon-button"
          :title="`播放模式：${modeLabel}`"
          :aria-label="`播放模式：${modeLabel}`"
          @click="player.togglePlayMode"
        >
          <component :is="modeIcon" :size="16" :stroke-width="1.6" />
        </button>
        <button
          type="button"
          class="player-icon-button"
          :disabled="!player.hasPrev"
          aria-label="上一首"
          @click="player.prev"
        >
          <SkipBack :size="17" :stroke-width="1.6" />
        </button>
        <button
          type="button"
          class="player-play-button relative bg-accent text-on-accent flex items-center justify-center"
          :class="{ 'animate-play-pulse': player.audioState.playing && !player.audioState.loading }"
          :disabled="!player.currentSong"
          :aria-label="player.audioState.playing ? '暂停' : '播放'"
          @click="player.togglePlay"
        >
          <Loader2
            v-if="player.audioState.loading"
            :size="17"
            :stroke-width="1.7"
            class="animate-spin"
          />
          <Pause v-else-if="player.audioState.playing" :size="17" :stroke-width="1.7" />
          <Play v-else :size="17" :stroke-width="1.7" class="ml-0.5" />
        </button>
        <button
          type="button"
          class="player-icon-button"
          :disabled="!player.hasNext"
          aria-label="下一首"
          @click="player.next"
        >
          <SkipForward :size="17" :stroke-width="1.6" />
        </button>
      </div>
      <div class="w-full flex items-center gap-2">
        <span class="player-time text-[11px] tabular-nums w-9 text-right font-medium">
          {{ cur }}
        </span>
        <ProgressBar
          :value="player.audioState.currentTime"
          :max="player.audioState.duration || 0"
          @change="onSeek"
          class="flex-1 min-w-0"
        />
        <span class="player-time text-[11px] tabular-nums w-9 font-medium">
          {{ dur }}
        </span>
      </div>
    </div>

    <!-- 右：volume -->
    <div
      class="player-volume w-full max-w-[140px] min-w-0 justify-self-end flex items-center gap-2 mobile-hide-on-small"
    >
      <Volume2
        :size="15"
        :stroke-width="1.5"
        class="player-volume-icon shrink-0"
        aria-hidden="true"
      />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.audioState.volume"
        class="player-volume-range flex-1 min-w-0 appearance-none cursor-pointer"
        :aria-label="`音量 ${Math.round(player.audioState.volume * 100)}%`"
        @input="onVolume"
        style="accent-color: var(--color-accent);"
      />
    </div>
  </footer>
</template>

<style scoped>
.player-bar-grid {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 30;
  display: grid;
  align-items: center;
  grid-template-columns:
    minmax(0, 1fr)
    clamp(236px, 44%, 320px)
    minmax(0, 1fr);
  width: min(780px, calc(100% - 24px));
  height: 76px;
  padding: 0 18px;
  gap: 16px;
  overflow: hidden;
  transform: translateX(-50%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  background: rgba(16, 16, 18, 0.92);
  box-shadow:
    0 18px 52px var(--color-shadow),
    0 3px 14px rgba(8, 8, 10, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(24px) saturate(125%);
  -webkit-backdrop-filter: blur(24px) saturate(125%);
}

.player-cover-button {
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.055);
  box-shadow: 0 6px 18px rgba(7, 7, 9, 0.34);
  transition:
    transform 0.2s cubic-bezier(0.32, 0.72, 0, 1),
    box-shadow 0.2s ease;
}

.player-cover-edge {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: inherit;
}

.player-cover-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(7, 7, 9, 0.42);
}

.player-cover-button:active {
  transform: scale(0.97);
}

.player-transport {
  gap: 3px;
}

.player-icon-button,
.player-play-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  outline: none;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    transform 0.18s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.18s ease,
    box-shadow 0.18s ease;
}

.player-icon-button {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.58);
  background: transparent;
}

.player-icon-button:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.94);
  background: rgba(255, 255, 255, 0.075);
  transform: translateY(-1px);
}

.player-icon-button:active:not(:disabled) {
  transform: scale(0.95);
}

.player-play-button {
  width: 40px;
  height: 40px;
  margin: 0 2px;
  border-radius: 50%;
  box-shadow:
    0 5px 16px var(--color-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.player-play-button:hover:not(:disabled) {
  transform: scale(1.045);
  box-shadow:
    0 7px 22px var(--color-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

.player-play-button:active:not(:disabled) {
  transform: scale(0.94);
}

.player-icon-button:disabled,
.player-play-button:disabled {
  cursor: default;
  opacity: 0.28;
}

.player-cover-button:focus-visible,
.player-icon-button:focus-visible,
.player-play-button:focus-visible,
.player-volume-range:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.player-time {
  color: rgba(255, 255, 255, 0.48);
}

.player-volume {
  opacity: 0.72;
  transition: opacity 0.2s ease;
}

.player-bar-grid:hover .player-volume,
.player-volume:focus-within {
  opacity: 1;
}

.player-volume-icon {
  color: rgba(255, 255, 255, 0.56);
}

.player-volume-range {
  height: 24px;
  margin: 0;
  background: transparent;
}

.player-volume-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.player-volume-range::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  margin-top: -4.5px;
  appearance: none;
  border: 2px solid rgba(0, 0, 0, 0.18);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.32);
}

.player-volume-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.player-volume-range::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(0, 0, 0, 0.18);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.32);
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
    border-radius: 12px;
  }

  .player-icon-button {
    width: 32px;
    height: 32px;
  }

  .player-play-button {
    width: 38px;
    height: 38px;
    margin-inline: 0;
  }

  .player-transport {
    gap: 1px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-cover-button,
  .player-icon-button,
  .player-play-button,
  .player-volume {
    transition: none;
  }

  .player-play-button {
    animation: none !important;
  }
}
</style>
