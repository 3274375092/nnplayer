<script setup lang="ts">
// 搜索页：
//   1. 防抖输入 500ms
//   2. 监听路由 query.q 自动触发搜索
//   3. 支持手动回车立即触发
//   4. （阶段3）右侧展示歌词面板

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricAside from "@/components/LyricAside.vue";
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

/** 路由里的 q 只接受字符串：重复参数会解析成数组，宁可当作空查询。 */
function routeKeyword(): string {
  const q = route.query.q;
  return typeof q === "string" ? q : "";
}

// 输入框双向绑定：初值来自路由，之后由 route.query.q 单向校正
const keyword = ref<string>(routeKeyword());
const query = useQueryCache<SearchResult, AppError>();
const results = computed(() => query.data.value?.songs ?? []);
/** 接口命中总数；可能大于已加载的 50 首，列表头不能把请求上限当总量。 */
const totalCount = computed(
  () => query.data.value?.total ?? results.value.length,
);
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

// 监听路由 query 变化（侧栏搜索 / 前进后退时同步）：路由是唯一查询来源
watch(
  () => route.query.q,
  () => {
    const next = routeKeyword();
    if (next === keyword.value) return;
    // 外部改了查询：丢弃尚未提交的本地防抖，避免旧关键词稍后把新查询写回路由。
    if (timer) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    keyword.value = next;
    void doSearch(next);
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
        placeholder="搜索歌曲或艺人"
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
      <SongList
        :songs="results"
        title="搜索结果"
        :total-count="totalCount"
      />
      <!-- 无当前歌曲时不渲染空歌词卡：避免占位大块空白，单列时列表独占整行。 -->
      <LyricAside v-if="player.currentSong" />
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
      输入关键词会自动搜索；按回车可立即搜索。
    </div>
  </div>
</template>

<style scoped>
/* 两栏布局：有当前歌曲时右侧歌词卡；无当前歌曲时列表独占整行。 */
.search-layout {
  /* 歌词列 clamp(280px, 34%, 320px)：宽容器触顶 320px（DESIGN 理想卡宽），
     窄到 34% 不足 280px 时守 DESIGN 的下限，剩余宽度全部留给列表。 */
  grid-template-columns: minmax(0, 1fr) clamp(280px, 34%, 320px);
  /* DESIGN：内容 + 歌词卡两栏间距 2rem（原先 gap-4 偏紧）。 */
  gap: 2rem;
}

.search-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}

/* 容器查询：阈值 38rem（比每日推荐的 44rem 低）。搜索结果动辄数十上百首，
   单列会把歌词卡排到列表末尾、在默认窗里等于丢掉侧栏歌词，所以只要列表列
   还放得下就保留两栏；仅当容器窄到列表连隐藏专辑后都挤不下（<38rem）才堆叠。
   生产最小窗 960×640（侧栏展开内容宽 656px）因此仍保留右侧歌词卡。 */
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

  /* 单列态：歌词卡回到普通流、居中并限宽 34rem。
     卡片本体只负责纸面与两栏时的 sticky，布局归页面。 */
  .search-layout :deep(.lyric-aside) {
    position: static;
    width: min(100%, 34rem);
    justify-self: center;
  }
}
</style>
