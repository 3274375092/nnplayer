<script setup lang="ts">
// 每日推荐页：调用 get_daily_recommend，展示列表。
// 鉴权接口：未登录会被路由守卫拦截。

import { onMounted, ref } from "vue";
import SongList from "@/components/SongList.vue";
import { getDailyRecommend } from "@/composables/useNcmApi";
import type { DailyRecommend } from "@/types/music";

const data = ref<DailyRecommend | null>(null);
const loading = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await getDailyRecommend();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="px-8 py-6">
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
      <button class="btn btn-primary" @click="load">重试</button>
    </div>

    <SongList
      v-else-if="data"
      :songs="data.songs"
      title="今日推荐"
    />
  </div>
</template>