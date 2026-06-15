<script setup lang="ts">
// 根组件：三栏布局骨架。
//   - 左侧 导航栏（Sidebar 内部控制折叠态宽度）
//   - 中间路由视图（flex-1）
//   - 底部 浮层播放栏（fixed,720px 居中,内容区不再减高度）
//
// 阶段2 改动：PlayerBar → PlayerBarFloating
// 阶段5 改动：onMounted 监听 Rust emit 的 player:* / desktop-lyrics:toggle 事件
//
// 路由切换使用 fade-slide 过渡。

import { onBeforeUnmount, onMounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBarFloating from "@/components/PlayerBarFloating.vue";
import { usePlayerStore } from "@/stores/player";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";

const playerStore = usePlayerStore();
const desktopLyricsStore = useDesktopLyricsStore();

const unlistens: UnlistenFn[] = [];

onMounted(async () => {
  playerStore.bindAutoNext();
  // 同步桌面歌词窗口状态（启动时可能已存在）
  await desktopLyricsStore.syncFromSystem();

  // 阶段5：托盘菜单 / 全局快捷键 → 前端 store
  unlistens.push(
    await listen("player:toggle", () => playerStore.togglePlay()),
  );
  unlistens.push(
    await listen("player:prev", () => void playerStore.prev()),
  );
  unlistens.push(
    await listen("player:next", () => void playerStore.next()),
  );
  unlistens.push(
    await listen("desktop-lyrics:toggle", async () => {
      try {
        await desktopLyricsStore.toggleWindow();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[desktop-lyrics] toggle 失败", e);
      }
    }),
  );
});

onBeforeUnmount(() => {
  unlistens.forEach((u) => u());
  unlistens.length = 0;
});
</script>

<template>
  <div class="h-full flex bg-bg">
    <!-- 左侧导航栏 -->
    <Sidebar class="shrink-0" />

    <!-- 主内容区 -->
    <main class="flex-1 overflow-y-auto">
      <router-view v-slot="{ Component }">
        <transition name="fade-slide" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- 底部浮层播放栏 -->
    <PlayerBarFloating />
  </div>
</template>

<style scoped>
/* 路由切换 fade + 轻微 slide */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* 兼容旧的 fade 名称，避免破坏潜在引用 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
