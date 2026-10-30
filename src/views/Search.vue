<script setup lang="ts">
// 搜索页：
//   1. 防抖输入 500ms
//   2. 监听路由 query.q 自动触发搜索
//   3. 支持手动回车立即触发
//   4. （阶段3）右侧展示歌词面板

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
import InlineError from "@/components/InlineError.vue";
import { searchSongs, type AppError } from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { usePlayerStore } from "@/stores/player";
import { useUserStore } from "@/stores/user";
import { describeAppError } from "@/utils/appErrors";
import type { SearchResult } from "@/types/music";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const player = usePlayerStore();

// 输入框双向绑定
const keyword = ref<string>((route.query.q as string) || "");
const query = useQueryCache<SearchResult, AppError>();
const results = computed(() => query.data.value?.songs ?? []);
const loading = query.loading;
/** 内联错误一律映射成用户语言；后端原文只保留在可折叠技术详情里。 */
const describedError = computed(() =>
  query.error.value ? describeAppError(query.error.value) : null,
);

// 防抖定时器
let timer: number | undefined;

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

async function doSearch(kw: string, force = false) {
  const normalized = normalizeKeyword(kw);
  if (!normalized) {
    query.reset();
    return;
  }

  await query.execute(
    ["search-songs", normalized.toLocaleLowerCase(), 50],
    () => searchSongs(normalized, 50),
    {
      staleTime: 20_000,
      gcTime: 2 * 60 * 1000,
      force,
    },
  );
}

/** 重试失败搜索：跳过缓存强制重新请求。 */
function retrySearch() {
  void doSearch(keyword.value, true);
}

/** 登录过期入口：先清本地登录态，否则路由守卫会把已登录用户弹回原页。 */
async function relogin() {
  await userStore.logout();
  void router.push({ name: "Login", query: { redirect: route.fullPath } });
}

// 输入防抖
function onInput() {
  if (timer) window.clearTimeout(timer);
  // 输入一变化就让旧请求失效，不等待下一次防抖真正发出请求。
  query.cancel();
  timer = window.setTimeout(() => {
    router.replace({ query: keyword.value ? { q: keyword.value } : {} });
    void doSearch(keyword.value);
  }, 500);
}

// 回车立即触发
function onEnter() {
  if (timer) window.clearTimeout(timer);
  router.replace({ query: keyword.value ? { q: keyword.value } : {} });
  void doSearch(keyword.value, true);
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

onBeforeUnmount(() => {
  if (timer) window.clearTimeout(timer);
  timer = undefined;
});
</script>

<template>
  <div class="search-page px-8 py-6 mobile-content-padding">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold mb-3">搜索</h1>
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索歌曲或艺人…"
        class="input max-w-md"
        aria-label="搜索歌曲或艺人"
        autofocus
        @input="onInput"
        @keydown.enter="onEnter"
      />
    </header>

    <div v-if="loading" class="text-text-secondary py-10 text-center" role="status">
      正在搜索…
    </div>

    <InlineError
      v-else-if="describedError"
      :error="describedError"
      @retry="retrySearch"
      @relogin="relogin"
    />

    <div
      v-else-if="results.length > 0"
      class="grid mobile-stack search-layout"
      :class="{ 'search-layout--solo': !player.currentSong }"
    >
      <SongList :songs="results" title="搜索结果" />
      <!-- 无当前歌曲时不渲染空歌词卡：避免占位大块空白，单列时列表独占整行。 -->
      <aside
        v-if="player.currentSong"
        class="search-lyric self-start sticky top-4"
        aria-label="当前歌词"
      >
        <LyricPanel />
      </aside>
    </div>

    <div
      v-else-if="keyword.trim()"
      class="py-16 text-center text-text-secondary text-sm"
    >
      <p>没有找到与「{{ keyword.trim() }}」相关的歌曲</p>
      <p class="mt-1 text-xs text-text-tertiary">
        换个关键词，或检查是否有错别字。
      </p>
    </div>

    <div v-else class="py-16 text-center text-text-secondary text-sm">
      输入关键词，按回车开始搜索
    </div>
  </div>
</template>

<style scoped>
/* 两栏布局：有当前歌曲时右侧歌词卡；无当前歌曲时列表独占整行。 */
.search-layout {
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  /* DESIGN：内容 + 歌词卡两栏间距 2rem（原先 gap-4 偏紧）。 */
  gap: 2rem;
}

.search-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}

/* 容器查询：用页面自身可用宽度决定两栏还是单栏；生产最小窗（960×640、
   侧栏展开）内容宽 656px，列表容器会隐藏专辑列保住标题，因此仍保留
   歌词卡；只有容器窄到列表列连隐藏专辑后都不够用时（<38rem）才堆叠。 */
.search-page {
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
  container-name: search-content;
  container-type: inline-size;
}

@container search-content (max-width: 38rem) {
  .search-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .search-lyric {
    position: relative;
    top: auto;
    justify-self: center;
    width: min(100%, 34rem);
  }
}
</style>
