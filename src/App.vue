<script setup lang="ts">
// 根组件：三栏布局骨架。
//   - 左侧 200px 导航栏
//   - 中间路由视图（flex-1）
//   - 底部 80px 播放栏（固定）
//
// 中间内容区使用 calc 减去底部高度，保证不被播放器遮挡。

import { onMounted } from "vue";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import { usePlayerStore } from "@/stores/player";

const playerStore = usePlayerStore();

// 在应用挂载后绑定 audio ended 自动下一首逻辑
onMounted(() => {
  playerStore.bindAutoNext();
});
</script>

<template>
  <div class="h-full flex bg-bg">
    <!-- 左侧导航栏 -->
    <Sidebar class="w-[200px] shrink-0" />

    <!-- 主内容区 -->
    <main
      class="flex-1 overflow-y-auto"
      style="height: calc(100% - 80px)"
    >
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- 底部播放栏 -->
    <PlayerBar class="fixed bottom-0 left-0 right-0 h-20" />
  </div>
</template>

<style scoped>
/* 路由切换淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>