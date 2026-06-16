<script setup lang="ts">
// 根组件：三栏布局骨架。
//   - 左侧 导航栏（Sidebar 内部控制折叠态宽度）
//   - 中间路由视图（flex-1）
//   - 底部 浮层播放栏（fixed,720px 居中,内容区不再减高度）
//
// 阶段2 改动：PlayerBar → PlayerBarFloating
// 阶段3+ 改动：onMounted 监听 Rust emit 的 player:* / desktop-lyrics:toggle 事件
//             以及桌面歌词窗口 emit 的 'desktop-lyrics:request-snapshot'
//
// 路由切换使用 fade-slide 过渡。
//
// 桌面歌词窗口：只渲染 <router-view />，不挂 Sidebar/PlayerBarFloating/bg-bg。
// 通过 getCurrentWindow().label 区分（主窗 = "main"，歌词窗 = "desktop-lyrics"）。

import { computed, onBeforeUnmount, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBarFloating from "@/components/PlayerBarFloating.vue";
import { usePlayerStore } from "@/stores/player";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import { GEOM_KEY } from "@/stores/desktopLyrics";
import { triggerDesktopLyricsPush } from "@/composables/useLyric";

const playerStore = usePlayerStore();
const desktopLyricsStore = useDesktopLyricsStore();

const isDesktopLyrics = computed(() => {
  try {
    return getCurrentWindow().label === "desktop-lyrics";
  } catch {
    return false;
  }
});

const unlistens: UnlistenFn[] = [];

onMounted(async () => {
  // 桌面歌词窗：只渲染 router-view，主窗专属副作用全部跳过
  if (isDesktopLyrics.value) return;

  // 主窗销毁时清理桌面歌词窗口，让进程能正常退出。
  // 注意：必须监听 tauri://destroyed 而不是 tauri://close-requested——
  // Tauri v2 中只要注册了 close-requested 监听器，Rust 端就会自动调
  // api.prevent_close()，导致主窗关不掉（见 tauri/src/manager/window.rs）。
  // 这里不拦截主窗关闭，只在被销毁时连带清理子窗。
  const mainWin = getCurrentWindow();
  mainWin.once("tauri://destroyed", () => {
    void desktopLyricsStore.closeWindow();
  });

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

  // 阶段3+：桌面歌词窗口打开瞬间会 emit 'desktop-lyrics:request-snapshot'，
  // 主窗收到后立即推一份当前最新歌词状态（含封面主题色），避免打开时窗口空白
  unlistens.push(
    await listen("desktop-lyrics:request-snapshot", () => {
      triggerDesktopLyricsPush();
    }),
  );

  // 阶段3+：桌面歌词子窗→主窗控制通道
  unlistens.push(
    await listen<{ action: string; value?: unknown }>(
      "desktop-lyrics:control",
      async (e) => {
        switch (e.payload.action) {
          case "close":
            await desktopLyricsStore.closeWindow();
            break;
          case "lock":
            // 可选：主窗 UI 同步锁定状态指示
            break;
          case "geometry":
            if (e.payload.value) {
              try {
                localStorage.setItem(
                  GEOM_KEY,
                  JSON.stringify(e.payload.value),
                );
              } catch {
                /* localStorage 不可用静默 */
              }
            }
            break;
        }
      },
    ),
  );
});

onBeforeUnmount(() => {
  unlistens.forEach((u) => u());
  unlistens.length = 0;
});
</script>

<template>
  <!-- 桌面歌词窗：极简，无 Sidebar/PlayerBarFloating/bg-bg -->
  <router-view v-if="isDesktopLyrics" v-slot="{ Component }">
    <transition name="fade-slide" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>

  <!-- 主窗：完整布局 -->
  <div v-else class="h-full flex bg-bg">
    <Sidebar class="shrink-0" />

    <main class="flex-1 overflow-y-auto">
      <router-view v-slot="{ Component }">
        <transition name="fade-slide" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

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