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
  <div class="px-8 py-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold">我的歌单</h1>
    </header>

    <!-- 阶段4：骨架屏 -->
    <div
      v-if="loading"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
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
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
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
