<script setup lang="ts">
// 我的歌单页：网格展示用户歌单封面，点击进入详情。

import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import SongListItem from "@/components/SongListItem.vue";
import { getUserPlaylists } from "@/composables/useNcmApi";
import type { Playlist } from "@/types/music";

const router = useRouter();
const playlists = ref<Playlist[]>([]);
const loading = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    playlists.value = await getUserPlaylists();
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
      <h1 class="text-2xl font-semibold">我的歌单</h1>
    </header>

    <div v-if="loading" class="text-text-secondary py-10 text-center">
      加载中…
    </div>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load">重试</button>
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