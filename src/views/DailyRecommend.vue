<script setup lang="ts">
// 每日推荐页：调用 get_daily_recommend，展示列表 + 歌词面板。
// 鉴权接口：未登录会被路由守卫拦截。

import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
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

    <div
      v-if="loading"
      class="daily-state text-text-secondary py-10 text-center"
      role="status"
    >
      正在加载每日推荐…
    </div>

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
      <SongList :songs="data.songs" title="今日推荐" />
      <!-- 无当前歌曲时不渲染空歌词卡：空态不值得占首屏，单列堆叠时
           歌词卡也始终排在歌曲列表之后（容器查询里不再用 order 提前）。 -->
      <aside
        v-if="player.currentSong"
        class="daily-lyric"
        aria-label="当前歌词"
      >
        <LyricPanel :panel-height="320" />
      </aside>
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
  margin-bottom: 1.75rem;
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
  /* 78% 墨色：最暗染色纸端点 6.26:1，仍低于标题但不越 4.5:1 下限。 */
  color: color-mix(in srgb, var(--color-text-primary) 78%, transparent);
  font-size: 0.78rem;
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
  grid-template-columns: minmax(0, 1.65fr) minmax(18.75rem, 0.9fr);
  align-items: start;
  gap: 2rem;
}

/* 没有正在播放的歌曲时歌词卡不渲染，列表独占整行而不是留下空白第二列。 */
.daily-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}

.daily-lyric {
  position: sticky;
  top: 1rem;
  align-self: start;
  min-width: 0;
}

.daily-lyric :deep(.lyric-panel) {
  border-radius: 8px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

.daily-state {
  min-height: 9rem;
}

/* 两栏在容器 ≥44rem 时保留；更窄时单列。标题列由 SongList 的容器查询
   （<34rem 隐藏专辑列）兜底，不会在两栏区间被压成 0。 */
@container daily-content (max-width: 44rem) {
  .daily-layout {
    grid-template-columns: 1fr;
  }

  /* 单列堆叠时歌词卡保持在歌曲列表之后：先让用户看到歌单，
     歌词卡不再用 order 提到列表前面。 */
  .daily-lyric {
    position: relative;
    top: auto;
    justify-self: center;
    width: min(100%, 34rem);
  }
}

@media (max-height: 640px) {
  .daily-header {
    margin-bottom: 1.25rem;
  }

}
</style>
