<script setup lang="ts">
// 我的歌单页：按当前活跃平台加载对应歌单列表。

import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getUserPlaylists } from "@/composables/useNcmApi";
import { qqGetUserPlaylists } from "@/composables/useQqApi";
import { useUserStore } from "@/stores/user";
import type { Playlist } from "@/types/music";
import SongListItem from "@/components/SongListItem.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";

const router = useRouter();
const user = useUserStore();

const playlists = ref<Playlist[]>([]);
const loading = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (user.activePlatform === "qq") {
      playlists.value = await qqGetUserPlaylists();
    } else {
      playlists.value = await getUserPlaylists();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function openPlaylist(p: Playlist) {
  router.push({ name: "PlaylistDetail", params: { id: String(p.id) } });
}

onMounted(load);
</script>

<template>
  <div class="px-8 py-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold mb-1">我的歌单</h1>
      <p class="text-xs text-text-secondary">
        {{ user.activePlatform === "qq" ? "QQ 音乐" : "网易云音乐" }}
      </p>
    </header>

    <div
      v-if="loading"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
    >
      <SkeletonCard v-for="i in 8" :key="i" variant="grid" />
    </div>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load">重试</button>
    </div>

    <div
      v-else-if="playlists.length > 0"
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

    <div v-else class="card p-6 text-center text-text-secondary text-sm">
      {{ user.activePlatform === "qq" ? "QQ 歌单为空" : "暂无歌单" }}
    </div>
  </div>
</template>
