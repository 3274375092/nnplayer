<script setup lang="ts">
// 每日推荐页：调用 get_daily_recommend，展示列表 + 歌词面板。
// 鉴权接口：未登录会被路由守卫拦截。

import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricAside from "@/components/LyricAside.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import InlineError from "@/components/InlineError.vue";
import {
  getDailyRecommend,
  type AppError,
} from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { useUserStore } from "@/stores/user";
import { usePlayerStore } from "@/stores/player";
import { describeAppError } from "@/utils/appErrors";
import type { DailyRecommend } from "@/types/music";

const DAY = 24 * 60 * 60 * 1000;
const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const player = usePlayerStore();
const query = useQueryCache<DailyRecommend, AppError>();
const { data, loading } = query;

// 内联错误统一走 appErrors 的人话映射：后端原文只进可折叠技术详情，
// 页面展示「发生了什么 + 怎么恢复」。
const describedError = computed(() =>
  query.error.value ? describeAppError(query.error.value) : null,
);

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

/** 后端日期是 YYYY-MM-DD；界面用「2026 年 10 月 30 日」，避免机器口径。 */
function formatDateLabel(value: string | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
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

/** 登录过期入口：先清本地登录态，否则路由守卫会把已登录用户弹回原页。 */
async function relogin() {
  await userStore.logout();
  void router.push({ name: "Login", query: { redirect: route.fullPath } });
}

/** 空推荐态的下一步：不离开应用就能开始听歌。 */
function goSearch() {
  void router.push({ name: "Search" });
}

watch(() => userStore.userId, () => void load(true));
onMounted(() => void load());
</script>

<template>
  <div class="daily-page px-8 py-6 mobile-content-padding">
    <header class="daily-header">
      <h1 class="daily-header__title">每日推荐</h1>
      <p class="daily-header__subtitle">
        根据你的口味生成
        <template v-if="data?.date">
          <span class="daily-header__separator" aria-hidden="true">·</span>
          <span class="daily-header__date">{{ formatDateLabel(data.date) }}</span>
        </template>
      </p>
    </header>

    <!-- 加载：与歌单详情同一套骨架语言（列表骨架 + 有当前歌曲时的歌词列占位），
         不再是一句孤零零的灰字。 -->
    <template v-if="loading">
      <div
        class="daily-layout grid mobile-stack"
        :class="{ 'daily-layout--solo': !player.currentSong }"
        aria-hidden="true"
      >
        <SkeletonCard variant="list" :rows="8" />
        <SkeletonCard v-if="player.currentSong" variant="aside" :rows="7" />
      </div>
      <p class="sr-only" role="status">正在加载每日推荐…</p>
    </template>

    <InlineError
      v-else-if="describedError"
      :error="describedError"
      @retry="load(true)"
      @relogin="relogin"
    />

    <div
      v-else-if="data"
      class="daily-layout grid mobile-stack"
      :class="{ 'daily-layout--solo': !player.currentSong }"
    >
      <!-- 空推荐：不再渲染「序号/标题/专辑/时长」空表头 + disable 的主按钮
           （一个不能用的主操作加上一张空表，读起来像页面坏了）。说明原因并给出
           两个真实可做的下一步。 -->
      <section v-if="data.songs.length === 0" class="daily-empty">
        <h2 class="daily-empty__title">今天还没有推荐歌曲</h2>
        <p class="daily-empty__hint">
          推荐每天更新；稍后再打开看看，或先搜索想听的歌。
        </p>
        <div class="daily-empty__actions">
          <button type="button" class="btn btn-primary" @click="goSearch">
            搜索歌曲
          </button>
          <button type="button" class="btn btn-ghost" @click="load(true)">
            重新加载
          </button>
        </div>
      </section>
      <SongList
        v-else
        :songs="data.songs"
        title="今日推荐"
        empty-title="今天还没有推荐歌曲"
        empty-hint="稍后再打开看看，或去搜索想听的歌"
      />
      <!-- 无当前歌曲时不渲染空歌词卡：空态不值得占首屏，单列堆叠时
           歌词卡也始终排在歌曲列表之后（容器查询里不再用 order 提前）。 -->
      <LyricAside v-if="player.currentSong" />
    </div>
  </div>
</template>

<style scoped>
.daily-page {
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
  container-name: daily-content;
  container-type: inline-size;
}

.daily-header {
  position: relative;
  margin-bottom: 1.5rem;
  padding: 0.35rem 0 0.15rem;
}

.daily-header__title {
  margin: 0;
  color: color-mix(in srgb, var(--color-text-primary) 96%, transparent);
  font-size: 2rem;
  font-weight: 680;
  letter-spacing: 0;
  line-height: 1.2;
  text-wrap: balance;
}

.daily-header__subtitle {
  display: flex;
  align-items: center;
  margin: 0.7rem 0 0;
  /* 78% 墨色：最暗染色纸端点 6.26:1，仍低于标题但不越 4.5:1 下限。
     字号用 DESIGN 的 Label 12px；0.78rem（12.48px）不在字阶上。 */
  color: color-mix(in srgb, var(--color-text-primary) 78%, transparent);
  font-size: 0.75rem;
  font-weight: 450;
}

.daily-header__separator {
  margin: 0 0.5rem;
  /* 纯装饰分隔符，不承载信息；保持低存在感并交给读屏忽略。 */
  color: color-mix(in srgb, var(--color-text-primary) 45%, transparent);
}

.daily-header__date {
  color: color-mix(in srgb, var(--color-text-primary) 84%, transparent);
  font-variant-numeric: tabular-nums;
}

.daily-layout {
  /* 歌词列 clamp(280px, 34%, 320px)：宽容器触顶 320px（DESIGN 理想卡宽），
     窄到 34% 不足 280px 时守 DESIGN 的下限，剩余宽度全部留给列表。 */
  grid-template-columns: minmax(0, 1fr) clamp(280px, 34%, 320px);
  align-items: start;
  gap: 2rem;
}

/* 没有正在播放的歌曲时歌词卡不渲染，列表独占整行而不是留下空白第二列。 */
.daily-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}

/* 空推荐态：说明为什么空 + 两个能立刻做的动作，占位高度与列表首屏接近，
   避免页面在「加载 → 空」之间跳一大截。 */
.daily-empty {
  max-width: 34rem;
  padding: 2.5rem 1.75rem 2rem;
  border-radius: 12px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

.daily-empty__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.daily-empty__hint {
  margin: 0.5rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.daily-empty__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

/* 两栏在容器 ≥38rem 时保留（与歌单详情/搜索同一阈值）：960×640 默认展开侧栏时
   内容壳约 41rem，能容纳 344px 列表 + 280px 歌词卡；44rem 会把 960 这一档
   推到单列，让正在播放的歌词掉到 32 行列表之后（评审 P2）。
   更窄时单列（每日列表只有 32 首，单列代价可接受）；标题列由 SongList 的
   容器查询（<34rem 隐藏专辑列）兜底，不会在两栏区间被压成 0。 */
/* 窄窗不渲染歌词卡（含加载占位），与 LyricAside 的隐藏规则一致。 */
@media (max-width: 768px) {
  .skeleton-aside {
    display: none;
  }
}

@container daily-content (max-width: 38rem) {
  .daily-layout {
    grid-template-columns: 1fr;
  }

  /* 单列态：歌词卡回到普通流、居中并限宽 34rem。
     卡片本体只负责纸面与两栏时的 sticky，布局归页面。 */
  .daily-layout :deep(.lyric-aside) {
    position: static;
    width: min(100%, 34rem);
    justify-self: center;
  }
}
</style>
