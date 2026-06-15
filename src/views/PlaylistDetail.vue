<script setup lang="ts">
// 歌单详情页：动态路由 /playlist/:id
// 头部展示封面与简介，下方展示歌曲列表。

import { onMounted, ref, watch } from "vue";
import SongList from "@/components/SongList.vue";
import { getPlaylistDetail } from "@/composables/useNcmApi";
import type { PlaylistDetail } from "@/types/music";

interface Props {
  id: string;
}
const props = defineProps<Props>();

const detail = ref<PlaylistDetail | null>(null);
const loading = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  detail.value = null;
  try {
    detail.value = await getPlaylistDetail(Number(props.id));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

// 监听 id 变化，路由复用时重新加载
watch(() => props.id, load);

onMounted(load);
</script>

<template>
  <div class="px-8 py-6">
    <div v-if="loading" class="text-text-secondary py-10 text-center">
      加载中…
    </div>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load">重试</button>
    </div>

    <template v-else-if="detail">
      <!-- 头部信息 -->
      <header class="flex gap-6 mb-6 items-end">
        <div
          class="w-44 h-44 rounded-card bg-hover overflow-hidden shrink-0 shadow-card"
        >
          <img
            v-if="detail.playlist.coverUrl"
            :src="detail.playlist.coverUrl"
            :alt="detail.playlist.name"
            class="w-full h-full object-cover"
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

      <!-- 歌曲列表 -->
      <SongList :songs="detail.songs" :show-index="true" />
    </template>
  </div>
</template>