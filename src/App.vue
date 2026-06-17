<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBarFloating from "@/components/PlayerBarFloating.vue";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import { useTauriBridge } from "@/composables/useTauriBridge";
import { useAudioBridge } from "@/composables/useAudioBridge";
import { useAudioPlayer } from "@/composables/useAudioPlayer";
import { initGlobalLyricBridge } from "@/composables/useLyric";
import { useLocalLibraryStore } from "@/stores/localLibrary";
import { usePlayerStore } from "@/stores/player";

const desktopLyricsStore = useDesktopLyricsStore();
const { setup, teardown } = useTauriBridge();
const audioBridge = useAudioBridge();
const controller = useAudioPlayer();
const localLibrary = useLocalLibraryStore();
const playerStore = usePlayerStore();

const isDesktopLyrics = computed(() => {
  try {
    return getCurrentWindow().label === "desktop-lyrics";
  } catch {
    return false;
  }
});

onMounted(async () => {
  if (isDesktopLyrics.value) return;

  getCurrentWindow().once("tauri://destroyed", () => {
    void desktopLyricsStore.closeWindow();
  });

  // 关键：先注册全局歌词桥接（早于任何 LyricPanel 挂载）
  // 否则在 LocalMusic/PlaylistDetail 等没有 LyricPanel 的路由下，
  // 桌面歌词窗口拿不到推送，会一直空白
  initGlobalLyricBridge();

  await setup();
  await audioBridge.setup();
  void localLibrary.init();
  // 绑定自动下一首逻辑（<audio> 的 ended 事件 + useAudioBridge 派发的 window 事件）
  playerStore.bindAutoNext();

  // 恢复 Rust 端在播的本地歌：WebView 刷新后 Pinia 全没了但 Rust 引擎还在跑
  // 这里把前端 state 对齐到 Rust 真实状态，不重启播放
  const restoredSong = await controller.restoreIfPlaying();
  if (restoredSong) {
    playerStore.setCurrentSongOnly(restoredSong);
    console.log("[App] 本地歌已从 Rust 端恢复:", restoredSong.name);
  }
});

onBeforeUnmount(() => {
  teardown();
  audioBridge.teardown();
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
</style>