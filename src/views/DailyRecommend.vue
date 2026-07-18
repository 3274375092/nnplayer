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
  <div class="daily-page px-8 py-6 mobile-content-padding">
    <header class="daily-header">
      <div class="daily-header__eyebrow">
        <span aria-hidden="true" />
        为你挑选
      </div>
      <h1 class="daily-header__title">每日推荐</h1>
      <p class="daily-header__subtitle">
        根据你的口味生成
        <span class="daily-header__separator">·</span>
        <span class="daily-header__date">{{ data?.date ?? "—" }}</span>
      </p>
    </header>

    <div v-if="loading" class="daily-state text-text-secondary py-10 text-center">
      加载中…
    </div>

    <div v-else-if="error" class="daily-state card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load(true)">重试</button>
    </div>

    <div
      v-else-if="data"
      class="daily-layout grid mobile-stack"
    >
      <SongList :songs="data.songs" title="今日推荐" />
      <aside class="daily-lyric" aria-label="当前歌词">
        <LyricPanel :panel-height="320" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.daily-page {
  container-name: daily-content;
  container-type: inline-size;
}

.daily-header {
  position: relative;
  margin-bottom: 1.75rem;
  padding: 0.35rem 0 0.15rem;
}

.daily-header::after {
  content: "";
  position: absolute;
  top: -2.5rem;
  left: -3rem;
  z-index: -1;
  width: 16rem;
  height: 9rem;
  pointer-events: none;
  background: radial-gradient(
    ellipse,
    color-mix(in srgb, var(--color-accent) 7%, transparent),
    transparent 68%
  );
  filter: blur(10px);
}

.daily-header__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.45rem;
  color: color-mix(in srgb, var(--color-text-primary) 48%, transparent);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.14em;
}

.daily-header__eyebrow > span {
  width: 1.35rem;
  height: 1px;
  background: var(--color-accent);
  box-shadow: 0 0 8px var(--color-glow);
}

.daily-header__title {
  margin: 0;
  color: color-mix(in srgb, var(--color-text-primary) 96%, transparent);
  font-size: clamp(2.05rem, 3.2vw, 2.625rem);
  font-weight: 680;
  letter-spacing: -0.045em;
  line-height: 1.02;
  text-wrap: balance;
}

.daily-header__subtitle {
  display: flex;
  align-items: center;
  margin: 0.7rem 0 0;
  color: color-mix(in srgb, var(--color-text-primary) 52%, transparent);
  font-size: 0.78rem;
  font-weight: 450;
}

.daily-header__separator {
  margin: 0 0.5rem;
  color: color-mix(in srgb, var(--color-text-primary) 28%, transparent);
}

.daily-header__date {
  color: color-mix(in srgb, var(--color-text-primary) 68%, transparent);
  font-variant-numeric: tabular-nums;
}

.daily-layout {
  grid-template-columns: minmax(0, 1.65fr) minmax(18.75rem, 0.9fr);
  align-items: start;
  gap: 1.25rem;
}

.daily-lyric {
  position: sticky;
  top: 1rem;
  align-self: start;
  min-width: 0;
}

.daily-lyric :deep(.lyric-panel) {
  border-color: color-mix(in srgb, var(--color-border-strong) 64%, transparent);
  background:
    radial-gradient(
      circle at 10% -8%,
      color-mix(in srgb, var(--color-accent) 8%, transparent),
      transparent 40%
    ),
    linear-gradient(150deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012));
  background-color: color-mix(in srgb, var(--color-card) 92%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 16px 42px rgba(0, 0, 0, 0.14);
}

.daily-state {
  min-height: 9rem;
}

@container daily-content (max-width: 44rem) {
  .daily-layout {
    grid-template-columns: 1fr;
  }

  .daily-lyric {
    position: relative;
    top: auto;
    order: -1;
    justify-self: center;
    width: min(100%, 34rem);
  }
}

@media (max-height: 640px) {
  .daily-header {
    margin-bottom: 1.25rem;
  }

  .daily-header__title {
    font-size: clamp(2rem, 3.4vw, 2.45rem);
  }
}
</style>
