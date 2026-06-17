<script setup lang="ts">
// 浮层版播放栏：720px 居中、64px 高、backdrop-blur、hover 显隐次要按钮。
// 参考 ZeroBit-Player lib/components/play_bar.dart:97-106 (浮层位置)。
//
// 与旧 PlayerBar.vue 的关键差异：
// - 宽度：旧 100%，新 720px 居中 (max-w-[calc(100vw-16px)] 兜底窄屏)
// - 高度：旧 80px，新 64px
// - 模式 / 上一首 / 下一首 / 音量：默认 opacity-0，hover 时 group-hover:opacity-100
// - 进度条：换成 ProgressBar 组件，支持拖拽 tooltip + 键盘微调
// - 标题 / 艺人：换 ScrollText 跑马灯
//
// 图标策略：统一用 lucide-vue-next。stroke 风格与米黄单色体系一致，
// 继承 currentColor 可跟随主题色 / hover 文字色切换。

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
import { useAudioPlayer } from "@/composables/useAudioPlayer";

const player = usePlayerStore();
const controller = useAudioPlayer();
const router = useRouter();

const cur = computed(() => fmtDuration(player.audioState.currentTime));
const dur = computed(() => fmtDuration(player.audioState.duration));

function onSeek(v: number) {
  // ProgressBar 松手时才 emit change，直接 seek 即可
  player.seek(v);
}

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  player.setVolume(v);
}

// 模式图标用 computed 动态返回组件引用，模板渲染时由 :is 切换
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
    class="group fixed bottom-2 left-1/2 -translate-x-1/2 w-[720px] max-w-[calc(100vw-16px)] h-16 bg-card/85 backdrop-blur-xl rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] flex items-center px-4 gap-4 z-50 motion-reduce:transition-none"
    role="region"
    aria-label="播放控制"
  >
    <!-- 左：cover + info -->
    <div class="flex items-center gap-3 w-[260px] shrink-0 min-w-0">
      <button
        type="button"
        class="w-12 h-12 rounded-full overflow-hidden bg-hover flex items-center justify-center shrink-0 focus-visible:ring-2 ring-accent outline-none"
        :title="player.currentSong ? '进入正在播放' : '尚未播放'"
        @click="openNowPlaying"
      >
        <img
          v-if="controller.state.currentCover"
          :src="controller.state.currentCover"
          alt=""
          class="w-full h-full object-cover motion-safe:animate-spin-slow"
          :class="player.audioState.playing ? '' : '[animation-play-state:paused]'"
        />
        <Music2
          v-else
          :size="18"
          :stroke-width="1.75"
          class="text-text-secondary"
        />
      </button>
      <div class="min-w-0 flex-1">
        <ScrollText
          :text="player.currentSong?.name ?? '尚未播放'"
          class="text-sm font-medium"
        />
        <ScrollText
          :text="player.currentSong?.artists ?? '—'"
          class="text-xs text-text-secondary"
        />
      </div>
    </div>

    <!-- 中：control + progress -->
    <div class="flex-1 flex flex-col items-center gap-1 min-w-0">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-text-secondary hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none"
          :title="`播放模式：${modeLabel}`"
          :aria-label="`播放模式：${modeLabel}`"
          @click="player.togglePlayMode"
        >
          <component
            :is="modeIcon"
            :size="16"
            :stroke-width="1.75"
          />
        </button>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-text-secondary hover:text-text-primary disabled:opacity-30 focus-visible:opacity-100 focus-visible:outline-none"
          :disabled="!player.hasPrev"
          aria-label="上一首"
          @click="player.prev"
        >
          <SkipBack :size="16" :stroke-width="1.75" />
        </button>
        <button
          type="button"
          class="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 ring-accent"
          :disabled="!player.currentSong"
          :aria-label="player.audioState.playing ? '暂停' : '播放'"
          @click="player.togglePlay"
        >
          <Loader2
            v-if="player.audioState.loading"
            :size="16"
            :stroke-width="1.75"
            class="animate-spin"
          />
          <Pause v-else-if="player.audioState.playing" :size="16" :stroke-width="1.75" />
          <Play v-else :size="16" :stroke-width="1.75" class="ml-0.5" />
        </button>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-text-secondary hover:text-text-primary disabled:opacity-30 focus-visible:opacity-100 focus-visible:outline-none"
          :disabled="!player.hasNext"
          aria-label="下一首"
          @click="player.next"
        >
          <SkipForward :size="16" :stroke-width="1.75" />
        </button>
      </div>
      <div class="w-full flex items-center gap-2">
        <span class="text-[10px] text-text-secondary tabular-nums w-9 text-right">
          {{ cur }}
        </span>
        <ProgressBar
          :value="player.audioState.currentTime"
          :max="player.audioState.duration || 0"
          @change="onSeek"
          class="flex-1 min-w-0"
        />
        <span class="text-[10px] text-text-secondary tabular-nums w-9">
          {{ dur }}
        </span>
      </div>
    </div>

    <!-- 右：volume -->
    <div
      class="w-[140px] flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
    >
      <Volume2
        :size="16"
        :stroke-width="1.75"
        class="text-text-secondary"
        aria-hidden="true"
      />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.audioState.volume"
        class="flex-1 accent-accent"
        :aria-label="`音量 ${Math.round(player.audioState.volume * 100)}%`"
        @input="onVolume"
      />
    </div>
  </footer>
</template>
