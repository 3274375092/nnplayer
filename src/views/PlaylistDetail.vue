<script setup lang="ts">
// 歌单详情页：动态路由 /playlist/:id
// 头部展示封面与简介，下方展示歌曲列表 + 歌词面板。
// （阶段4）加载中显示 SkeletonCard。

import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricPanel from "@/components/LyricPanel.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import InlineError from "@/components/InlineError.vue";
import {
  getPlaylistDetail,
  type AppError,
} from "@/composables/useNcmApi";
import { useQueryCache } from "@/composables/useQueryCache";
import { usePlayerStore } from "@/stores/player";
import { useUserStore } from "@/stores/user";
import { describeAppError } from "@/utils/appErrors";
import type { PlaylistDetail } from "@/types/music";
import { coverImageUrl } from "@/utils/coverImage";

interface Props {
  id: string;
}
const props = defineProps<Props>();

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const player = usePlayerStore();
const query = useQueryCache<PlaylistDetail, AppError>();
const detail = query.data;
const loading = query.loading;
/** 内联错误一律映射成用户语言；后端原文只保留在可折叠技术详情里。 */
const describedError = computed(() =>
  query.error.value ? describeAppError(query.error.value) : null,
);
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

// 登录态变化会清空缓存，需重新拉取，否则页面停留在空态
watch(() => userStore.userId, () => void load(true));

/** 登录过期入口：先清本地登录态，否则路由守卫会把已登录用户弹回原页。 */
async function relogin() {
  await userStore.logout();
  void router.push({ name: "Login", query: { redirect: route.fullPath } });
}

onMounted(() => void load());
</script>

<template>
  <div class="detail-page px-8 py-6 mobile-content-padding">
    <!-- 阶段4：骨架屏（头 + 列表） -->
    <template v-if="loading">
      <header class="flex gap-6 mb-6 items-end" aria-hidden="true">
        <div class="w-44 h-44 rounded-[18px] skeleton" />
        <div class="flex-1 min-w-0">
          <div class="skeleton h-3 w-12 rounded mb-2" />
          <div class="skeleton h-7 w-2/3 rounded mb-3" />
          <div class="skeleton h-3 w-1/3 rounded" />
        </div>
      </header>
      <div aria-hidden="true">
        <SkeletonCard variant="list" :rows="8" />
      </div>
      <p class="sr-only" role="status">正在加载歌单…</p>
    </template>

    <InlineError
      v-else-if="describedError"
      :error="describedError"
      @retry="load(true)"
      @relogin="relogin"
    />

    <template v-else-if="detail">
      <!-- 头部信息 -->
      <header class="flex gap-6 mb-6 items-end">
        <div
          class="w-44 h-44 rounded-[18px] bg-hover overflow-hidden shrink-0"
        >
          <img
            v-if="detail.playlist.coverUrl"
            :src="coverImageUrl(detail.playlist.coverUrl, 176)"
            alt=""
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

      <!-- 空歌单：不渲染空列表与空歌词卡 -->
      <div
        v-if="detail.songs.length === 0"
        class="py-16 text-center"
      >
        <p class="text-sm text-text-secondary">这个歌单还没有歌曲</p>
        <p class="mt-1 text-xs text-text-tertiary">
          在网易云音乐里收藏歌曲后，会出现在这里。
        </p>
      </div>

      <!-- 歌曲列表 + 歌词面板 -->
      <div
        v-else
        class="grid mobile-stack detail-layout"
        :class="{ 'detail-layout--solo': !player.currentSong }"
      >
        <SongList :songs="detail.songs" :show-index="true" />
        <!-- 无当前歌曲时不渲染空歌词卡：避免占位大块空白，单列时列表独占整行。 -->
        <aside
          v-if="player.currentSong"
          class="detail-lyric self-start sticky top-4"
          aria-label="当前歌词"
        >
          <LyricPanel />
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 两栏布局：有当前歌曲时右侧歌词卡；无当前歌曲时列表独占整行。 */
.detail-layout {
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  /* DESIGN：内容 + 歌词卡两栏间距 2rem（原先 gap-4 偏紧）。 */
  gap: 2rem;
}

.detail-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}

/* 容器查询：用页面自身可用宽度（窗口减去侧栏与内边距）决定两栏还是单栏。
   生产最小窗（960×640、侧栏展开）内容宽 656px：两栏 + 列表容器的
   34rem 断点会隐藏专辑列、把宽度让给标题，所以仍保留歌词卡；
   只有当容器窄到列表列连隐藏专辑后都不够用时（<38rem）才单列堆叠。 */
.detail-page {
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
  container-name: detail-content;
  container-type: inline-size;
}

@container detail-content (max-width: 38rem) {
  .detail-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail-lyric {
    position: relative;
    top: auto;
    justify-self: center;
    width: min(100%, 34rem);
  }
}
</style>
