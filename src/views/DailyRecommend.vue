<script setup lang="ts">
// 每日推荐页：调用 get_daily_recommend，展示列表 + 歌词面板。
// 鉴权接口：未登录会被路由守卫拦截。

import { computed, onMounted } from "vue";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
import {
  getDailyRecommend,
  type AppError,
} from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { useUserStore } from "@/stores/user";
import type { DailyRecommend } from "@/types/music";

const DAY = 24 * 60 * 60 * 1000;
const userStore = useUserStore();
const query = useQueryCache<DailyRecommend, AppError>();
const { data, loading } = query;
const error = computed(() => query.error.value?.message ?? "");

// 极少数登录态尚未带 userId 的场景不共享缓存，避免账号间复用数据。
const unresolvedUserScope = `unresolved:${Date.now()}:${Math.random()}`;

function currentUserScope(): string {
  return userStore.userId === null
    ? unresolvedUserScope
    : `user:${userStore.userId}`;
}

function localDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function load(force = false) {
  return query.execute(
    ["daily-recommend", currentUserScope(), localDateKey()],
    getDailyRecommend,
    {
      // 推荐以日期为版本；跨日后 key 自动变化。
      staleTime: DAY,
      gcTime: 26 * 60 * 60 * 1000,
      force,
    },
  );
}

onMounted(() => void load());
</script>

<template>
  <div class="px-8 py-6 mobile-content-padding">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold mb-1">每日推荐</h1>
      <p class="text-xs text-text-secondary">
        根据你的口味生成 · {{ data?.date ?? "—" }}
      </p>
    </header>

    <div v-if="loading" class="text-text-secondary py-10 text-center">
      加载中…
    </div>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load(true)">重试</button>
    </div>

    <div
      v-else-if="data"
      class="grid gap-4 mobile-stack"
      style="grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr)"
    >
      <SongList :songs="data.songs" title="今日推荐" />
      <div class="self-start sticky top-4">
        <LyricPanel />
      </div>
    </div>
  </div>
</template>
