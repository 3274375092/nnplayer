<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRoute } from "vue-router";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBarFloating from "@/components/PlayerBarFloating.vue";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import { useLyric } from "@/composables/useLyric";
import { useTauriBridge } from "@/composables/useTauriBridge";
import { useCoverTheme } from "@/composables/useCoverTheme";

const desktopLyricsStore = useDesktopLyricsStore();
const route = useRoute();

const isLoginRoute = computed(() => route.name === "Login");
const isNowPlayingRoute = computed(() => route.name === "NowPlaying");

const isDesktopLyrics = computed(() => {
  try {
    return getCurrentWindow().label === "desktop-lyrics";
  } catch {
    return false;
  }
});

const { setup, teardown } = useTauriBridge();
// 桌面歌词是透明独立窗口，只接收主窗口发送的高明度 accent。
if (!isDesktopLyrics.value) useCoverTheme();

onMounted(async () => {
  if (isDesktopLyrics.value) return;

  // 歌词时钟属于主窗口全局播放能力，不能依赖当前路由是否渲染 LyricPanel。
  useLyric();

  // Vite 浏览器预览没有 Tauri runtime。歌词/播放器本身仍可正常挂载，
  // 仅跳过原生窗口生命周期与跨窗口事件桥接。
  if (!isTauri()) return;

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
  <div v-else class="theme-root h-full flex bg-bg overflow-hidden">
    <Sidebar class="shrink-0 mobile-sidebar-hidden" />

    <!-- 播放栏和页面共用同一个内容壳，因此始终相对侧栏之外的区域居中。 -->
    <div
      class="app-content-shell relative flex-1 min-w-0 h-full overflow-hidden"
      :class="{
        'app-content-shell--overlay': isNowPlayingRoute,
        'app-content-shell--no-player': isLoginRoute,
      }"
    >
      <main class="app-main overflow-y-auto">
        <div class="route-stage">
          <router-view v-slot="{ Component }">
            <transition name="fade-slide">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>

      <PlayerBarFloating v-if="!isLoginRoute" />
    </div>
  </div>
</template>

<style scoped>
.theme-root {
  color: var(--color-text-primary);
  transition:
    color 0.45s ease,
    background-color 0.6s ease;
}

.app-content-shell {
  --player-reserved-space: 100px;
}

/* 普通页面的滚动视口止于播放栏上方，内容不会从控件背后穿过。 */
.app-main {
  height: calc(100% - var(--player-reserved-space));
  scroll-padding-bottom: 1rem;
}

/* 正在播放页自行保留悬浮栏安全区；登录页不显示播放栏。 */
.app-content-shell--overlay .app-main,
.app-content-shell--no-player .app-main {
  height: 100%;
}

.route-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.route-stage > * {
  flex: 1 0 auto;
  min-width: 0;
}

/* 新旧页面交叉淡入；离场页脱离文档流，避免 out-in 造成整页空白帧。 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.route-stage > .fade-slide-enter-active {
  position: relative;
  z-index: 1;
}

.route-stage > .fade-slide-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
  pointer-events: none;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .app-content-shell {
    --player-reserved-space: 76px;
  }

  /* 旧的逐页移动端留白由 app-main 统一接管，避免叠加成双倍空白。 */
  .app-main :deep(.mobile-content-padding) {
    padding-bottom: 0 !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-root {
    transition: none;
  }

  .fade-slide-enter-active,
  .fade-slide-leave-active {
    transition: opacity 0.01ms linear;
  }

  .fade-slide-enter-from,
  .fade-slide-leave-to {
    transform: none;
  }
}
</style>
