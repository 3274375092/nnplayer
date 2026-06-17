<script setup lang="ts">
// 歌单详情页：动态路由 /playlist/:id
// 头部展示封面与简介，下方展示歌曲列表 + 歌词面板。
// （阶段4）加载中显示 SkeletonCard。

import { onMounted, ref, watch } from "vue";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import { getPlaylistDetail } from "@/composables/useNcmApi";
import { qqGetPlaylistDetail } from "@/composables/useQqApi";
import { useUserStore } from "@/stores/user";
import type { PlaylistDetail } from "@/types/music";

interface Props {
  id: string;
}
const props = defineProps<Props>();
const user = useUserStore();

const detail = ref<PlaylistDetail | null>(null);
const loading = ref(false);
const error = ref("");
let loadSeq = 0;

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  detail.value = null;
  try {
    if (user.activePlatform === "qq") {
      detail.value = await qqGetPlaylistDetail(Number(props.id));
    } else {
      detail.value = await getPlaylistDetail(Number(props.id));
    }
    if (seq !== loadSeq) return;
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

// 监听 id 变化，路由复用时重新加载
watch(() => props.id, load);

onMounted(load);
</script>

<template>
  <div class="px-8 py-6">
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

      <!-- 歌曲列表 + 歌词面板 -->
      <div
        class="grid gap-4"
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
