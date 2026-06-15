<script setup lang="ts">
// 独立桌面歌词窗口页面。
// 监听主窗 emit 的 'desktop-lyrics:update' 事件，实时显示当前行 + 下一行。
// 背景透明（html, body { background: transparent !important; }）。
// 窗口已通过 stores/desktopLyrics 创建：decorations:false, transparent:true, alwaysOnTop:true。

import { onBeforeUnmount, onMounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface UpdatePayload {
  current: string;
  next: string;
  progress: number;
  songName: string;
  artists: string;
}

const current = ref("");
const next = ref("");
const progress = ref(0);
const songName = ref("");
const artists = ref("");

let unlisten: UnlistenFn | null = null;

onMounted(async () => {
  unlisten = await listen<UpdatePayload>("desktop-lyrics:update", (e) => {
    current.value = e.payload.current;
    next.value = e.payload.next;
    progress.value = e.payload.progress;
    songName.value = e.payload.songName;
    artists.value = e.payload.artists;
  });
});

onBeforeUnmount(() => {
  if (unlisten) unlisten();
});
</script>

<template>
  <div class="flex flex-col items-center justify-center h-screen px-12 select-none">
    <!-- 当前行（大字号 64px，进度条横切） -->
    <div class="relative inline-block max-w-full">
      <h1
        class="text-white text-6xl font-semibold leading-tight text-center"
        style="text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5)"
      >
        {{ current || "♪" }}
      </h1>
    </div>
    <!-- 下一行（小字号 32px，弱化） -->
    <h2
      v-if="next"
      class="text-white/60 text-3xl mt-6 text-center max-w-full"
      style="text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4)"
    >
      {{ next }}
    </h2>
    <!-- 歌曲信息 -->
    <p
      v-if="songName"
      class="text-white/50 text-sm mt-8 text-center"
    >
      {{ songName }}<span v-if="artists" class="ml-2">— {{ artists }}</span>
    </p>
  </div>
</template>

<style>
/* 透明背景 + 去除默认边距 */
html,
body,
#app {
  background: transparent !important;
  height: 100%;
  margin: 0;
  padding: 0;
}
</style>
