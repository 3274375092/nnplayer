<script setup lang="ts">
// 歌单详情页：动态路由 /playlist/:id
// 头部展示封面与简介，下方展示歌曲列表 + 歌词面板。
// （阶段4）加载中显示 SkeletonCard。

import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft } from "@lucide/vue";
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
import { fmtLongDuration } from "@/utils/format";
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

/** 歌单总时长：和曲目数一起撑起页头右侧的信息位，不占列表首屏。 */
const totalDurationLabel = computed(() => {
  const songs = detail.value?.songs ?? [];
  if (songs.length === 0) return "";
  const totalMs = songs.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  return fmtLongDuration(totalMs);
});

/** 空歌单的下一步：不给用户留一个只能返回的死页面。 */
function goDaily() {
  void router.push({ name: "DailyRecommend" });
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
        <SkeletonCard v-if="player.currentSong" variant="aside" :rows="7" />
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
      <!-- 「你在哪 + 怎么回去」：桌面端没有浏览器后退键，歌单详情此前既不高亮
           侧栏的“我的歌单”，也没有返回入口（评审 P2）。 -->
      <RouterLink to="/playlists" class="detail-back">
        <ChevronLeft :size="15" :stroke-width="1.75" aria-hidden="true" />
        我的歌单
      </RouterLink>

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
        <!-- 页头右侧信息位：曲目数与总时长，补上宽窗里空着的右半区，也让
             「这个歌单有多长」在进入列表前就可读。 -->
        <dl v-if="detail.songs.length > 0" class="detail-meta">
          <div>
            <dt class="sr-only">曲目数</dt>
            <dd>{{ detail.songs.length }} 首</dd>
          </div>
          <div>
            <dt class="sr-only">总时长</dt>
            <dd>{{ totalDurationLabel }}</dd>
          </div>
        </dl>
      </header>

      <!-- 空歌单：不渲染空列表与空歌词卡；说明为什么空并给一个可做的下一步。 -->
      <div
        v-if="detail.songs.length === 0"
        class="detail-empty"
      >
        <h2 class="detail-empty__title">这个歌单还没有歌曲</h2>
        <p class="detail-empty__hint">
          在网易云音乐里往这个歌单添加歌曲后，会出现在这里。
        </p>
        <div class="detail-empty__actions">
          <button type="button" class="btn btn-ghost" @click="goDaily">
            浏览每日推荐
          </button>
        </div>
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
/* 返回入口：与页面内容同一条左缘，安静但可命中（≥24px 高）。 */
.detail-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  margin-bottom: 0.75rem;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  transition: color 160ms ease;
}

.detail-back:hover {
  color: var(--color-text-primary);
}

/* 页头右侧信息位：12px 元信息、tabular-nums；窄窗收起，把宽度还给标题。 */
.detail-meta {
  display: flex;
  flex: 0 0 auto;
  gap: 1.5rem;
  margin-left: auto;
  padding-bottom: 0.1rem;
  color: var(--color-text-tertiary);
  font-size: 12px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.detail-meta dd {
  margin: 0;
}

@media (max-width: 768px) {
  .detail-meta {
    display: none;
  }
}

/* 空歌单：说明 + 一个能立刻做的动作，纸面卡与其它空态同一套材质。 */
.detail-empty {
  max-width: 34rem;
  padding: 2.5rem 1.75rem 2rem;
  border-radius: 12px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

.detail-empty__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.detail-empty__hint {
  margin: 0.5rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.detail-empty__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

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

/* 与 LyricAside.vue 的隐藏规则逐条对齐：窄窗 / 单列时加载态也不渲染这张占位卡，
   否则它会在数据到达后突然消失，看起来像多出来一张卡，与「加载完成只换内容」
   的注释不符。卡片本体样式由 SkeletonCard 的 aside variant 提供。 */
@media (max-width: 768px) {
  .skeleton-aside {
    display: none;
  }
}

/* 容器查询：三页统一 38rem 单列阈值。歌单详情可能有数百首歌，
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

  .skeleton-aside {
    display: none;
  }
}
</style>
