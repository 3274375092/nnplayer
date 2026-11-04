<script setup lang="ts">
// 歌单详情页：动态路由 /playlist/:id
// 头部展示封面与简介，下方展示歌曲列表 + 歌词面板。
// （阶段4）加载中显示 SkeletonCard。

import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SongList from "@/components/SongList.vue";
import LyricAside from "@/components/LyricAside.vue";
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
      <div
        aria-hidden="true"
        class="grid mobile-stack detail-layout"
        :class="{ 'detail-layout--solo': !player.currentSong }"
      >
        <SkeletonCard variant="list" :rows="8" />
        <!-- 与加载后的两栏同构：有当前歌曲时详情页带歌词列，占位也保留同一列，
             否则列表容器宽度会在数据到达瞬间翻转（专辑列显隐 / 行宽跳变）。 -->
        <div v-if="player.currentSong" class="skeleton-aside">
          <div class="skeleton h-3.5 w-12 rounded" />
          <div
            v-for="i in 7"
            :key="i"
            class="skeleton mt-3 h-3 rounded"
            :class="i % 3 === 0 ? 'w-2/3' : 'w-full'"
          />
        </div>
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
          <div v-if="detail.playlist.creator" class="text-sm text-text-secondary">
            由 {{ detail.playlist.creator }} 创建
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
          在网易云音乐里往这个歌单添加歌曲后，会出现在这里。
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
        <LyricAside v-if="player.currentSong" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 两栏布局：有当前歌曲时右侧歌词卡；无当前歌曲时列表独占整行。 */
.detail-layout {
  /* 歌词列 clamp(280px, 34%, 320px)：宽容器触顶 320px（DESIGN 理想卡宽），
     窄到 34% 不足 280px 时守 DESIGN 的下限，剩余宽度全部留给列表。 */
  grid-template-columns: minmax(0, 1fr) clamp(280px, 34%, 320px);
  /* DESIGN：内容 + 歌词卡两栏间距 2rem（原先 gap-4 偏紧）。 */
  gap: 2rem;
}

.detail-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}

/* 加载态的歌词列占位：与 LyricAside 同一张 raised 纸卡量级（16px 内边距 +
   Raised 阴影），加载完成时只换内容、不换骨架。 */
.skeleton-aside {
  align-self: start;
  padding: 1rem;
  border-radius: 8px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

/* 容器查询：阈值 38rem（比每日推荐的 44rem 低）。歌单详情可能有数百首歌，
   单列会把歌词卡排到列表末尾、在默认窗里等于丢掉侧栏歌词，所以只要列表列
   还放得下就保留两栏；仅当容器窄到列表连隐藏专辑后都挤不下（<38rem）才堆叠。
   生产最小窗 960×640（侧栏展开内容宽 656px）因此仍保留右侧歌词卡。 */
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

}
</style>
