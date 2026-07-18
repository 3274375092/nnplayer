<script setup lang="ts">
// 我的歌单页：网格展示用户歌单封面，点击进入详情。
// （阶段4）数据未到达时展示 SkeletonCard 骨架屏。

import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import SongListItem from "@/components/SongListItem.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import {
  getUserPlaylists,
  type AppError,
} from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { useUserStore } from "@/stores/user";
import type { Playlist } from "@/types/music";

const router = useRouter();
const userStore = useUserStore();
const query = useQueryCache<Playlist[], AppError>();
const playlists = computed(() => query.data.value ?? []);
const loading = query.loading;
const error = computed(() => query.error.value?.message ?? "");
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

onMounted(() => void load());
</script>

<template>
  <div class="playlist-page px-8 py-6">
    <header class="mb-7 flex items-baseline gap-3">
      <h1 class="text-2xl font-semibold tracking-[-0.02em]">我的歌单</h1>
      <span v-if="!loading && !error" class="playlist-count">
        {{ playlists.length }} 个
      </span>
    </header>

    <!-- 阶段4：骨架屏 -->
    <div
      v-if="loading"
      class="playlist-grid"
    >
      <SkeletonCard
        v-for="i in 8"
        :key="i"
        variant="grid"
      />
    </div>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load(true)">重试</button>
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
