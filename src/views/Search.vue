<script setup lang="ts">
// 搜索页：
//   1. 防抖输入 500ms
//   2. 监听路由 query.q 自动触发搜索
//   3. 支持手动回车立即触发
//   4. （阶段3）右侧展示歌词面板

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { X } from "@lucide/vue";
import SongList from "@/components/SongList.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import LyricAside from "@/components/LyricAside.vue";
import InlineError from "@/components/InlineError.vue";
import { searchSongs, type AppError } from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { usePlayerStore } from "@/stores/player";
import { useUserStore } from "@/stores/user";
import { describeAppError } from "@/utils/appErrors";
import {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
  normalizeQuery,
} from "@/utils/recentSearches";
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
const inputRef = ref<HTMLInputElement | null>(null);
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

// 最近搜索：空态时给出可直接点回的入口，减少“重新想一遍关键词”。
const recentSearches = ref<string[]>(loadRecentSearches());

async function doSearch(kw: string, force = false) {
  const normalized = normalizeQuery(kw);
  if (!normalized) {
    query.reset();
    return;
  }

  const result = await query.execute(
    ["search-songs", normalized.toLocaleLowerCase(), 50],
    () => searchSongs(normalized, 50),
    {
      staleTime: 20_000,
      gcTime: 2 * 60 * 1000,
      force,
    },
  );
  // 只在请求成功时记入历史：失败的关键词不应污染“最近搜索”。
  // useQueryCache 用 undefined 表示请求已被更新输入取代。它没有 error，但
  // 也不是成功结果，不能把用户已经放弃的关键词写进最近搜索。
  if (result !== undefined && !query.error.value) {
    recentSearches.value = addRecentSearch(normalized);
  }
}

/** 点最近搜索：等价于重新提交那个关键词，并把焦点交还输入框。
 *  搜索一开始 loading 就翻起，空态块（连同这枚 chip）当场卸载；不收焦点
 *  就会掉到 BODY，键盘用户下一次 Tab 只能从文档顶部重新开始。 */
function applyRecentSearch(value: string) {
  keyword.value = value;
  void router.replace({ query: { q: value } });
  void doSearch(value, true);
  void nextTick(() => inputRef.value?.focus());
}

function clearHistory() {
  clearRecentSearches();
  recentSearches.value = [];
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

/** 清空搜索框：同时清掉路由 query 与结果，回到“还没搜”的初始态。 */
function clearKeyword() {
  if (timer) window.clearTimeout(timer);
  keyword.value = "";
  query.reset();
  void router.replace({ query: {} });
  void nextTick(() => inputRef.value?.focus());
}

/** 空结果/未输入时的下一步：不必在空搜索页里反复改词。 */
function goDaily() {
  void router.push({ name: "DailyRecommend" });
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
      <div class="relative max-w-md">
        <input
          ref="inputRef"
          v-model="keyword"
          type="text"
          placeholder="搜索歌曲或艺人"
          class="input search-field__input"
          aria-label="搜索歌曲或艺人"
          autofocus
          @input="onInput"
          @keydown.enter="onEnter"
        />
        <button
          v-if="keyword"
          type="button"
          class="input-clear search-field__clear"
          title="清空搜索"
          aria-label="清空搜索"
          @click="clearKeyword"
        >
          <X :size="15" :stroke-width="2" aria-hidden="true" />
        </button>
      </div>
    </header>

    <!-- 搜索中：与歌单/每日同一套列表骨架，不再是一句灰字顶在一大片空纸上。 -->
    <template v-if="loading">
      <div
        class="grid mobile-stack search-layout"
        :class="{ 'search-layout--solo': !player.currentSong }"
        aria-hidden="true"
      >
        <SkeletonCard variant="list" :rows="8" />
        <SkeletonCard v-if="player.currentSong" variant="aside" :rows="7" />
      </div>
      <p class="sr-only" role="status">正在搜索…</p>
    </template>

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

    <!-- 空结果 / 未输入：说明原因并给出真实可做的下一步（此前只有一行提示）。 -->
    <section v-else class="search-empty">
      <template v-if="keyword.trim()">
        <h2 class="search-empty__title">
          没有找到与「{{ keyword.trim() }}」相关的歌曲
        </h2>
        <p class="search-empty__hint">换个关键词，或检查是否有错别字。</p>
      </template>
      <template v-else>
        <h2 class="search-empty__title">输入关键词开始搜索</h2>
        <p class="search-empty__hint">
          输入后会自动搜索；按回车可立即搜索。
        </p>
        <!-- 最近搜索：把“再想一遍关键词”变成一次点击（只存本机、可一键清除）。 -->
        <div v-if="recentSearches.length > 0" class="search-recent">
          <div class="search-recent__head">
            <span class="search-recent__label">最近搜索</span>
            <button
              type="button"
              class="search-recent__clear"
              title="清除搜索历史"
              @click="clearHistory"
            >
              清除
            </button>
          </div>
          <div class="search-recent__list">
            <button
              v-for="item in recentSearches"
              :key="item"
              type="button"
              class="search-recent__chip"
              @click="applyRecentSearch(item)"
            >
              {{ item }}
            </button>
          </div>
        </div>
      </template>
      <div class="search-empty__actions">
        <button type="button" class="btn btn-ghost" @click="goDaily">
          浏览每日推荐
        </button>
      </div>
    </section>
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

/* 搜索框清空按钮：全局 .input-clear 负责视觉与命中区，这里只补输入框右内边距。 */
.search-field__input {
  padding-right: 2.25rem;
}

/* 空搜索/无结果：说明 + 下一步，纸面卡与歌词卡同一套材质。 */
.search-empty {
  max-width: 34rem;
  padding: 2.5rem 1.75rem 2rem;
  border-radius: 12px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

.search-empty__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.search-empty__hint {
  margin: 0.5rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.search-empty__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

/* 最近搜索：安静的纸面小标签，不与主按钮抢层级。 */
.search-recent {
  margin-top: 1.25rem;
}

.search-recent__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.search-recent__label {
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
}

.search-recent__clear {
  min-height: 24px;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  transition: color 160ms ease, background-color 160ms ease;
}

.search-recent__clear:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-strong, var(--color-card-hover));
}

.search-recent__list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
}

.search-recent__chip {
  min-height: 28px;
  max-width: 100%;
  padding: 4px 10px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 160ms ease, background-color 160ms ease;
}

.search-recent__chip:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-strong, var(--color-card-hover));
}

/* 容器查询：三页统一 38rem 单列阈值。搜索结果动辄数十上百首，
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

/* 窄窗 / 单列不渲染歌词卡（含加载占位），与 LyricAside 的隐藏规则一致。 */
@media (max-width: 768px) {
  .skeleton-aside {
    display: none;
  }
}

@container search-content (max-width: 38rem) {
  .search-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .skeleton-aside {
    display: none;
  }
}
</style>
