<script setup lang="ts">
// 我的歌单页：网格展示用户歌单封面，点击进入详情。
// （阶段4）数据未到达时展示 SkeletonCard 骨架屏。

import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongListItem from "@/components/SongListItem.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import InlineError from "@/components/InlineError.vue";
import {
  getUserPlaylists,
  type AppError,
} from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { useUserStore } from "@/stores/user";
import { describeAppError } from "@/utils/appErrors";
import type { Playlist } from "@/types/music";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const query = useQueryCache<Playlist[], AppError>();
const playlists = computed(() => query.data.value ?? []);
const loading = query.loading;
/** 内联错误一律映射成用户语言；后端原文只保留在可折叠技术详情里。 */
const describedError = computed(() =>
  query.error.value ? describeAppError(query.error.value) : null,
);
const unresolvedUserScope = `unresolved:${Date.now()}:${Math.random()}`;

function load(force = false) {
  const userScope =
    userStore.userId === null
      ? unresolvedUserScope
      : `user:${userStore.userId}`;
  return query.execute(["user-playlists", userScope], getUserPlaylists, {
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    force,
  });
}

function openPlaylist(p: Playlist) {
  router.push({ name: "PlaylistDetail", params: { id: String(p.id) } });
}

/** 歌单还没有内容时，给一个不需要离开应用就能继续听歌的下一步。 */
function goDaily() {
  void router.push({ name: "DailyRecommend" });
}

/** 登录过期入口：先清本地登录态，否则路由守卫会把已登录用户弹回原页。 */
async function relogin() {
  await userStore.logout();
  void router.push({ name: "Login", query: { redirect: route.fullPath } });
}

onMounted(() => void load());
// 登录/登出后自动按新的用户作用域重新拉取（authEpoch 变更会清空当前组件状态）
watch(() => userStore.userId, () => void load(true));
</script>

<template>
  <div class="playlist-page px-8 py-6 mobile-content-padding">
    <header class="mb-6 flex items-baseline gap-3">
      <h1 class="text-2xl font-semibold">我的歌单</h1>
      <span v-if="!loading && !describedError" class="playlist-count">
        {{ playlists.length }} 个歌单
      </span>
    </header>

    <!-- 阶段4：骨架屏 -->
    <template v-if="loading">
      <div class="playlist-grid" aria-hidden="true">
        <SkeletonCard
          v-for="i in 8"
          :key="i"
          variant="grid"
        />
      </div>
      <p class="sr-only" role="status">正在加载歌单…</p>
    </template>

    <InlineError
      v-else-if="describedError"
      :error="describedError"
      @retry="load(true)"
      @relogin="relogin"
    />

    <div
      v-else-if="playlists.length === 0"
      class="playlist-empty"
    >
      <h2 class="playlist-empty__title">还没有歌单</h2>
      <p class="playlist-empty__hint">
        在网易云音乐中创建或收藏的歌单，会自动显示在这里。
      </p>
      <div class="playlist-empty__actions">
        <button type="button" class="btn btn-ghost" @click="goDaily">
          浏览每日推荐
        </button>
      </div>
    </div>

    <div
      v-else
      class="playlist-grid"
    >
      <SongListItem
        v-for="p in playlists"
        :key="p.id"
        :playlist="p"
        variant="playlist"
        @click="openPlaylist(p)"
      />
    </div>
  </div>
</template>

<style scoped>
.playlist-page {
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
}

.playlist-count {
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

/* 空歌单：与每日推荐/搜索/歌单详情同一套纸面卡与标题层级（此前是裸居中文本）。 */
.playlist-empty {
  max-width: 34rem;
  padding: 2.5rem 1.75rem 2rem;
  border-radius: 12px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

.playlist-empty__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.playlist-empty__hint {
  margin: 0.5rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.playlist-empty__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  column-gap: 22px;
  row-gap: 28px;
}

@media (max-width: 680px) {
  .playlist-page {
    padding-inline: 20px;
  }

  .playlist-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    column-gap: 16px;
    row-gap: 24px;
  }
}
</style>
