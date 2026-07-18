<script setup lang="ts">
// 歌单详情页：动态路由 /playlist/:id
// 头部展示封面与简介，下方展示歌曲列表 + 歌词面板。
// （阶段4）加载中显示 SkeletonCard。

import { computed, onMounted, watch } from "vue";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import {
  getPlaylistDetail,
  type AppError,
} from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { useUserStore } from "@/stores/user";
import type { PlaylistDetail } from "@/types/music";
import { coverImageUrl } from "@/utils/coverImage";

interface Props {
  id: string;
}
const props = defineProps<Props>();

const userStore = useUserStore();
const query = useQueryCache<PlaylistDetail, AppError>();
const detail = query.data;
const loading = query.loading;
const error = computed(() => query.error.value?.message ?? "");
const unresolvedUserScope = `unresolved:${Date.now()}:${Math.random()}`;

function load(force = false) {
  const playlistId = Number(props.id);
  const userScope =
    userStore.userId === null
      ? unresolvedUserScope
      : `user:${userStore.userId}`;
  return query.execute(
    ["playlist-detail", playlistId, userScope],
    () => getPlaylistDetail(playlistId),
    {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      force,
    },
  );
}

// 监听 id 变化，路由复用时重新加载
watch(() => props.id, () => void load());

onMounted(() => void load());
</script>

<template>
  <div class="px-8 py-6 mobile-content-padding">
    <!-- 阶段4：骨架屏（头 + 列表） -->
    <template v-if="loading">
      <header class="flex gap-6 mb-6 items-end">
        <div class="w-44 h-44 rounded-card skeleton" />
        <div class="flex-1 min-w-0">
          <div class="skeleton h-3 w-12 rounded mb-2" />
          <div class="skeleton h-7 w-2/3 rounded mb-3" />
          <div class="skeleton h-3 w-1/3 rounded" />
        </div>
      </header>
      <SkeletonCard variant="list" :rows="8" />
    </template>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load(true)">重试</button>
    </div>

    <template v-else-if="detail">
      <!-- 头部信息 -->
      <header class="flex gap-6 mb-6 items-end">
        <div
          class="w-44 h-44 rounded-card bg-hover overflow-hidden shrink-0 shadow-card"
        >
          <img
            v-if="detail.playlist.coverUrl"
            :src="coverImageUrl(detail.playlist.coverUrl, 176)"
            :alt="detail.playlist.name"
            class="w-full h-full object-cover"
            loading="eager"
            decoding="async"
            fetchpriority="high"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-text-secondary mb-2">歌单</div>
          <h1 class="text-2xl font-semibold mb-2 truncate">
            {{ detail.playlist.name }}
          </h1>
          <div class="text-sm text-text-secondary">
            {{ detail.playlist.trackCount }} 首歌
            <span v-if="detail.playlist.creator">
              · {{ detail.playlist.creator }}
            </span>
          </div>
        </div>
      </header>

      <!-- 歌曲列表 + 歌词面板 -->
      <div
        class="grid gap-4 mobile-stack"
        style="grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr)"
      >
        <SongList :songs="detail.songs" :show-index="true" />
        <div class="self-start sticky top-4">
          <LyricPanel />
        </div>
      </div>
    </template>
  </div>
</template>
