<script setup lang="ts">
// 歌词面板（阶段3 升级版）。
//   - 弹簧物理滚动：useSpringScroll 跟踪 activeLineIndex
//   - 卡拉OK 逐字渐变（伪）：按字符等分时间窗，progressMs 之前已唱过 → accent 色
//   - 行间距离模糊：距当前 3 行外开始模糊
//   - 减少动效：弹簧退化为直接平移，跳过 rAF
//   - 点击某行歌词 → audioPlayer.seek(行 time)

import { computed } from "vue";
import { useLyric } from "@/composables/useLyric";
import { useSpringValue } from "@/composables/useSpringScroll";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();
const {
  lines,
  activeLineIndex,
  karaokeTokens,
  progressMs,
  loading,
  error,
  hasLyric,
  seekTo,
} = useLyric();

const LINE_HEIGHT = 36;
const panelHeight = 400;

// 减少动效时直接同步，不走弹簧
const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 期望的 translateY：让 activeLineIndex 行垂直居中
const targetY = computed(() => {
  const idx = activeLineIndex.value;
  if (idx < 0) return 0;
  return panelHeight / 2 - LINE_HEIGHT / 2 - idx * LINE_HEIGHT;
});

const { value: springY } = useSpringValue(targetY);

const translateY = computed(() =>
  reduceMotion ? targetY.value : springY.value,
);

// 行间距离模糊：距当前 3 行外开始模糊，每多 1 行 +0.5px，最大 4px
function blurFor(idx: number): string {
  const cur = activeLineIndex.value;
  if (cur < 0) return "0px";
  const dist = Math.max(0, Math.abs(idx - cur) - 2);
  return `${Math.min(4, dist * 0.5).toFixed(2)}px`;
}

// 卡拉OK 字符颜色：已唱过 = accent，未唱 = 透明（让 background 显示）
function tkStyle(tk: { startMs: number; endMs: number }) {
  const passed = progressMs.value >= tk.startMs;
  return {
    color: passed ? "var(--color-accent)" : "transparent",
    transition: "color 0.05s linear",
  };
}

// 点击行跳转
function onLineClick(timeMs: number) {
  seekTo(Math.floor(timeMs / 1000));
}

const hasSong = computed(() => player.currentSong !== null);
</script>

<template>
  <div
    class="card p-4 w-full"
    :style="{ minHeight: `${panelHeight}px` }"
  >
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-text-secondary">歌词</h3>
      <div
        v-if="hasSong"
        class="text-xs text-text-secondary truncate ml-3"
      >
        {{ player.currentSong?.name }}
      </div>
    </div>

    <!-- 加载 / 错误 / 空态 -->
    <div
      v-if="!hasSong"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      暂未播放歌曲
    </div>
    <div
      v-else-if="loading"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      歌词加载中…
    </div>
    <div
      v-else-if="error"
      class="flex items-center justify-center text-accent text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      {{ error }}
    </div>
    <div
      v-else-if="!hasLyric"
      class="flex items-center justify-center text-text-secondary text-sm"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      暂无歌词
    </div>

    <!-- 歌词内容（视口 + 弹簧平移） -->
    <div
      v-else
      class="relative overflow-hidden"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      <div
        class="absolute left-0 right-0 will-change-transform"
        :style="{
          transform: `translate3d(0, ${translateY}px, 0)`,
        }"
      >
        <div
          v-for="(line, idx) in lines"
          :key="`${line.time}-${idx}`"
          class="px-2 cursor-pointer"
          :class="
            idx === activeLineIndex
              ? 'text-base font-medium'
              : 'text-sm hover:text-text-primary'
          "
          :style="{
            height: `${LINE_HEIGHT}px`,
            lineHeight: `${LINE_HEIGHT}px`,
            filter: `blur(${blurFor(idx)})`,
            color: idx === activeLineIndex
              ? 'var(--color-text-secondary)'
              : 'var(--color-text-secondary)',
            transition: 'color 0.3s linear, filter 0.3s linear',
          }"
          @click="onLineClick(line.time)"
        >
          <!-- 当前行：卡拉OK 字符级渲染 -->
          <span
            v-if="idx === activeLineIndex"
            class="inline-flex"
            aria-hidden="true"
          >
            <span
              v-for="(tk, i) in karaokeTokens"
              :key="i"
              :style="tkStyle(tk)"
            >{{ tk.char }}</span>
          </span>
          <span v-else-if="line.text">{{ line.text }}</span>
          <span v-else class="opacity-50">·</span>
        </div>
      </div>

      <!-- 中央分割线（视觉提示） -->
      <div
        class="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-accent/10"
      />
    </div>
  </div>
</template>

<style scoped>
.will-change-transform {
  will-change: transform;
}
</style>
