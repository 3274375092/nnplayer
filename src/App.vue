<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBarFloating from "@/components/PlayerBarFloating.vue";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import { useTauriBridge } from "@/composables/useTauriBridge";

const desktopLyricsStore = useDesktopLyricsStore();
const { setup, teardown } = useTauriBridge();

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

  await setup();
});

onBeforeUnmount(() => {
  teardown();
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