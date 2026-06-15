<script setup lang="ts">
// 搜索页：
//   1. 防抖输入 500ms
//   2. 监听路由 query.q 自动触发搜索
//   3. 支持手动回车立即触发
//   4. （阶段3）右侧展示歌词面板

import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
import { searchSongs } from "@/composables/useNcmApi";
import type { Song } from "@/types/music";

const route = useRoute();
const router = useRouter();

// 输入框双向绑定
const keyword = ref<string>((route.query.q as string) || "");
const results = ref<Song[]>([]);
const loading = ref(false);
const error = ref("");

// 防抖定时器
let timer: number | undefined;

async function doSearch(kw: string) {
  if (!kw.trim()) {
    results.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await searchSongs(kw.trim(), 50);
    results.value = res.songs;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "搜索失败";
    results.value = [];
  } finally {
    loading.value = false;
  }
}

// 输入防抖
function onInput() {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    router.replace({ query: keyword.value ? { q: keyword.value } : {} });
    void doSearch(keyword.value);
  }, 500);
}

// 回车立即触发
function onEnter() {
  if (timer) window.clearTimeout(timer);
  router.replace({ query: keyword.value ? { q: keyword.value } : {} });
  void doSearch(keyword.value);
}

// 监听路由 query 变化（外部跳转 / 后退时同步）
watch(
  () => route.query.q,
  (q) => {
    const next = (q as string) || "";
    if (next !== keyword.value) {
      keyword.value = next;
      void doSearch(next);
    }
  }
);

onMounted(() => {
  if (keyword.value) void doSearch(keyword.value);
});
</script>

<template>
  <div class="px-8 py-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold mb-3">搜索</h1>
      <input
        v-model="keyword"
        type="text"
        placeholder="输入歌曲名 / 艺人…"
        class="input max-w-md"
        autofocus
        @input="onInput"
        @keydown.enter="onEnter"
      />
    </header>

    <div v-if="loading" class="text-text-secondary py-10 text-center">
      搜索中…
    </div>

    <div v-else-if="error" class="card p-6 text-accent text-center">
      {{ error }}
    </div>

    <div
      v-else-if="results.length > 0"
      class="grid gap-4"
      style="grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr)"
    >
      <SongList :songs="results" title="搜索结果" />
      <div class="self-start sticky top-4">
        <LyricPanel />
      </div>
    </div>

    <div
      v-else-if="keyword"
      class="py-16 text-center text-text-secondary text-sm"
    >
      未找到相关歌曲
    </div>

    <div v-else class="py-16 text-center text-text-secondary text-sm">
      输入关键词开始搜索
    </div>
  </div>
</template>
