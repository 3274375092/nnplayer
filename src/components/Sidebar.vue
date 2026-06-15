<script setup lang="ts">
// 左侧导航栏：Logo + 搜索框 + 路由菜单。
// 使用 router-link 自带激活态，激活时高亮强调色。

import { useRouter } from "vue-router";
import { ref } from "vue";
import { useUserStore } from "@/stores/user";

const router = useRouter();
const userStore = useUserStore();

// 受控搜索关键词：路由跳转时携带 query
const keyword = ref("");

function goSearch() {
  const q = keyword.value.trim();
  if (!q) return;
  router.push({ name: "Search", query: { q } });
}

function logout() {
  userStore.logout().then(() => router.replace("/login"));
}
</script>

<template>
  <aside class="bg-card h-full flex flex-col px-4 py-5">
    <!-- Logo -->
    <div class="flex items-center gap-2 mb-6 px-2">
      <div
        class="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white font-bold"
      >
        N
      </div>
      <span class="text-base font-semibold">nnplayer</span>
    </div>

    <!-- 搜索框 -->
    <form class="mb-5" @submit.prevent="goSearch">
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索歌曲"
        class="input"
      />
    </form>

    <!-- 导航菜单 -->
    <nav class="flex flex-col gap-1">
      <router-link
        v-for="item in [
          { to: '/daily', label: '每日推荐' },
          { to: '/playlists', label: '我的歌单' },
        ]"
        :key="item.to"
        :to="item.to"
        class="px-3 py-2 rounded-btn text-text-primary hover:bg-hover transition-colors"
        active-class="bg-hover text-accent font-medium"
      >
        {{ item.label }}
      </router-link>
    </nav>

    <!-- 底部用户信息 -->
    <div class="mt-auto px-2 pt-4 border-t border-hover">
      <div class="text-xs text-text-secondary mb-1">
        {{ userStore.displayName }}
      </div>
      <button
        v-if="userStore.loggedIn"
        class="text-xs text-text-secondary hover:text-accent transition-colors"
        @click="logout"
      >
        退出登录
      </button>
    </div>
  </aside>
</template>