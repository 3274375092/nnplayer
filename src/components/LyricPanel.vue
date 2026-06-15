<script setup lang="ts">
// 歌词面板。
//   - 监听 useLyric 的 activeLineIndex 自动滚动
//   - 使用 transform: translateY() 平滑滚动
//   - 点击某行歌词 → audioPlayer.seek(行 time)
//   - 提供"原文 / 翻译"切换（如存在）
//
// 滚动策略：
//   - 让高亮行始终位于视口中央（垂直居中）
//   - 通过 lineHeight（每行固定 36px）计算 translateY

import { computed, ref } from "vue";
import { useLyric } from "@/composables/useLyric";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();
const { lines, activeLineIndex, loading, error, hasLyric, seekTo } = useLyric();

// 每行固定 36px 高度（与 CSS 中 line-height: 36px 对应）
const LINE_HEIGHT = 36;
const panelHeight = 400; // 可视区高度

// 滚动偏移：让 activeLineIndex 居中
const translateY = computed(() => {
  const idx = activeLineIndex.value ?? -1;
  if (idx < 0) return 0;
  // 期望：高亮行顶部到面板顶部的距离 = (panelHeight/2 - LINE_HEIGHT/2)
  return panelHeight / 2 - LINE_HEIGHT / 2 - idx * LINE_HEIGHT;
});

// 点击行跳转
function onLineClick(timeMs: number) {
  seekTo(Math.floor(timeMs / 1000));
}

// 是否有当前歌曲
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

    <!-- 歌词内容（视口 + 平移） -->
    <div
      v-else
      class="relative overflow-hidden"
      :style="{ height: `${panelHeight - 40}px` }"
    >
      <div
        class="absolute left-0 right-0 will-change-transform"
        :style="{
          transform: `translateY(${translateY}px)`,
          transition: 'transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1)',
        }"
      >
        <div
          v-for="(line, idx) in lines"
          :key="`${line.time}-${idx}`"
          class="px-2 cursor-pointer transition-colors duration-200"
          :class="
            idx === (activeLineIndex ?? -1)
              ? 'text-accent text-base font-medium'
              : 'text-text-secondary text-sm hover:text-text-primary'
          "
          :style="{ height: `${LINE_HEIGHT}px`, lineHeight: `${LINE_HEIGHT}px` }"
          @click="onLineClick(line.time)"
        >
          <span v-if="line.text">{{ line.text }}</span>
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
/* 使用 will-change 提高合成层性能 */
.will-change-transform {
  will-change: transform;
}
</style>
