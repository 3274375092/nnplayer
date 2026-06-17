<script setup lang="ts">
// 每日推荐页：按当前活跃平台加载对应推荐数据。
// NCM → 30 首歌曲列表；QQ → 推荐歌单卡片网格。

import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getDailyRecommend } from "@/composables/useNcmApi";
import { qqGetDailyRecommend } from "@/composables/useQqApi";
import { useUserStore } from "@/stores/user";
import type { DailyRecommend, Playlist } from "@/types/music";
import SongList from "@/components/SongList.vue";
import SongListItem from "@/components/SongListItem.vue";
import LyricPanel from "@/components/LyricPanel.vue";

const router = useRouter();
const user = useUserStore();

const ncmData = ref<DailyRecommend | null>(null);
const qqPlaylists = ref<Playlist[]>([]);
const loading = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (user.activePlatform === "qq") {
      qqPlaylists.value = await qqGetDailyRecommend();
    } else {
      ncmData.value = await getDailyRecommend();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const showNcm = computed(() => user.activePlatform !== "qq");
const showQq = computed(() => user.activePlatform === "qq");

function openPlaylist(p: Playlist) {
  router.push({ name: "PlaylistDetail", params: { id: String(p.id) } });
}
</script>

<template>
  <div class="px-8 py-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold mb-1">每日推荐</h1>
      <p class="text-xs text-text-secondary">
        <template v-if="showNcm">根据你的口味生成 · {{ ncmData?.date ?? "—" }}</template>
        <template v-else>QQ 音乐推荐歌单</template>
      </p>
    </header>

    <div v-if="loading" class="text-text-secondary py-10 text-center">
      加载中…
    </div>

    <div v-else-if="error" class="card p-6 text-center">
      <div class="text-accent mb-3">{{ error }}</div>
      <button class="btn btn-primary" @click="load">重试</button>
    </div>

    <!-- NCM：30 首歌曲列表 -->
    <div
      v-else-if="showNcm && ncmData"
      class="grid gap-4"
      style="grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr)"
    >
      <SongList :songs="ncmData.songs" title="今日推荐" />
      <div class="self-start sticky top-4">
        <LyricPanel />
      </div>
    </div>

    <!-- QQ：推荐歌单卡片网格 -->
    <div
      v-else-if="showQq && qqPlaylists.length > 0"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
    >
      <SongListItem
        v-for="p in qqPlaylists"
        :key="p.id"
        :playlist="p"
        variant="playlist"
        @click="openPlaylist(p)"
      />
    </div>

    <div v-else-if="showQq && qqPlaylists.length === 0 && !loading && !error" class="card p-6 text-center text-text-secondary text-sm">
      暂无推荐歌单
    </div>
  </div>
</template>
