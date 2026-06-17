<script setup lang="ts">
// 本地专辑详情页。
// 路由：/local-album/:name?artist=<artist>
//  - name 是专辑名（可重复）
//  - artist 是 query 参数，用于消歧（"相同专辑名 + 不同艺人"不会合并）
// 职责：
//   1. 按 (album, artist) 复合 key 从 localLibrary 拿该组歌
//   2. 渲染歌曲列表
//   3. 「播放全部 / 随机播放 / 下一首播放 / 添加到队列」四个按钮

import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, Disc3, Music2, Play, Shuffle } from "lucide-vue-next";

import { usePlayerStore } from "@/stores/player";
import { useLocalLibraryStore } from "@/stores/localLibrary";
import { fmtDuration } from "@/utils/format";
import { getLocalCoverUrl } from "@/composables/useLocalCover";
import { loadCoversInto } from "@/composables/useCoverLoader";
import { toLocalSong } from "@/utils/localSong";

const props = defineProps<{ name: string }>();
const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const lib = useLocalLibraryStore();

const albumName = computed(() => decodeURIComponent(props.name));
/** query 中的 artist 用于消歧；没传则用 lib 第一个匹配上的 */
const artistQuery = computed(() => {
  const a = route.query.artist;
  return typeof a === "string" ? decodeURIComponent(a) : "";
});

/** 该专辑的所有歌（按复合 key 找） */
const albumSongs = computed<typeof lib.songs>(() => {
  const name = albumName.value;
  // 1. 优先用 query.artist 消歧
  if (artistQuery.value) {
    const songs = lib.findAlbum(name, artistQuery.value);
    if (songs) return songs;
  }
  // 2. 退到只按 album 名找（取第一条）
  for (const a of lib.albums) {
    if (a.name === name) return a.songs;
  }
  return [];
});

/** 封面取第一首歌 */
const albumCoverPath = computed(() => albumSongs.value[0]?.path ?? "");
const albumCoverUrl = ref<string>("");
/** 专辑主艺人 */
const albumArtist = computed(() => {
  return albumSongs.value[0]?.artist ?? artistQuery.value ?? "未知艺人";
});

function playSong(meta: (typeof lib.songs)[number]) {
  player.playSong(toLocalSong(meta));
}

function playAll() {
  const songs = albumSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  void player.playList(songs, 0);
}

function shufflePlay() {
  const songs = player.shuffled(albumSongs.value.map(toLocalSong));
  if (songs.length === 0) return;
  void player.playList(songs, 0);
}

function addToQueue() {
  const songs = albumSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  player.appendToQueue(songs);
}

function playAsNext() {
  const songs = albumSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  // 插入到当前播放之后下一位，并跳过去
  player.insertAsNextUp(songs);
  void player.next();
}

function goBack() {
  void router.push("/local-music");
}

const coverUrls = ref<Map<string, string>>(new Map());
onMounted(async () => {
  if (albumCoverPath.value) {
    const url = await getLocalCoverUrl(albumCoverPath.value);
    if (url) albumCoverUrl.value = url;
  }
  await loadCoversInto(
    albumSongs.value.map((s) => ({ path: s.path, key: s.path })),
    coverUrls,
  );
});

watch(albumSongs, (songs) => {
  coverUrls.value = new Map();
  albumCoverUrl.value = "";
  if (songs[0]?.path) {
    void getLocalCoverUrl(songs[0].path).then((u) => {
      if (u) albumCoverUrl.value = u;
    });
  }
  void loadCoversInto(
    songs.map((s) => ({ path: s.path, key: s.path })),
    coverUrls,
  );
});
</script>

<template>
  <div class="p-6">
    <div class="flex items-center gap-2 mb-6">
      <button
        class="btn btn-ghost p-2"
        title="返回本地音乐"
        aria-label="返回"
        @click="goBack"
      >
        <ArrowLeft :size="18" :stroke-width="1.75" />
      </button>
      <h1 class="text-xl font-semibold truncate">{{ albumName }}</h1>
    </div>

    <div
      v-if="albumSongs.length === 0"
      class="flex flex-col items-center justify-center py-20 text-text-secondary"
    >
      <Music2 :size="48" :stroke-width="1" class="mb-3 opacity-40" />
      <p class="text-sm">该专辑没有歌曲</p>
      <p class="text-xs mt-1">可能尚未扫描或文件夹已移除</p>
    </div>

    <template v-else>
      <!-- 专辑头部：大封面 + 元信息 + 4 个播放按钮 -->
      <div class="flex items-center gap-6 mb-6">
        <div
          class="w-40 h-40 rounded-lg overflow-hidden bg-hover flex items-center justify-center shrink-0 shadow-md"
        >
          <img
            v-if="albumCoverUrl"
            :src="albumCoverUrl"
            :alt="albumName"
            class="w-full h-full object-cover"
          />
          <Disc3 v-else :size="48" :stroke-width="1" class="text-text-secondary" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-2xl font-semibold truncate">{{ albumName }}</div>
          <div class="text-sm text-text-secondary mt-1">
            <span v-if="albumArtist">{{ albumArtist }} · </span>
            <span>{{ albumSongs.length }} 首</span>
            <span class="mx-1.5">·</span>
            <span>{{ fmtDuration(albumSongs.reduce((s, x) => s + x.duration, 0)) }}</span>
          </div>
          <div class="mt-4 flex items-center gap-2 flex-wrap">
            <button
              class="btn btn-primary text-xs flex items-center gap-1.5"
              @click="playAll"
            >
              <Play :size="12" :stroke-width="2" />
              播放全部
            </button>
            <button
              class="btn btn-ghost text-xs flex items-center gap-1.5"
              @click="shufflePlay"
            >
              <Shuffle :size="12" :stroke-width="2" />
              随机播放
            </button>
            <button
              class="btn btn-ghost text-xs"
              @click="playAsNext"
              title="把这张专辑插入到当前播放之后，播完当前这首立即播"
            >
              下一首播放
            </button>
            <button
              class="btn btn-ghost text-xs"
              @click="addToQueue"
              title="把这张专辑追加到队尾"
            >
              添加到队列
            </button>
          </div>
        </div>
      </div>

      <!-- 歌曲列表 -->
      <div class="space-y-1">
        <div
          v-for="(s, i) in albumSongs"
          :key="s.path"
          class="flex items-center gap-3 px-3 py-2 rounded-btn hover:bg-hover cursor-pointer group transition-colors"
          @dblclick="playSong(s)"
        >
          <div class="shrink-0 w-7 text-center text-xs text-text-secondary tabular-nums">
            {{ i + 1 }}
          </div>
          <div
            class="shrink-0 w-10 h-10 rounded overflow-hidden bg-hover flex items-center justify-center"
          >
            <img
              v-if="coverUrls.get(s.path)"
              :src="coverUrls.get(s.path)"
              :alt="s.title"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <Music2 v-else :size="16" :stroke-width="1.5" class="text-text-secondary" />
          </div>
          <button
            class="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-hover group-hover:bg-accent group-hover:text-white transition-colors"
            :title="`播放 ${s.title}`"
            @click="playSong(s)"
          >
            <Play :size="14" :stroke-width="1.75" />
          </button>
          <div class="min-w-0 flex-1">
            <div class="text-sm truncate">{{ s.title }}</div>
            <div class="text-xs text-text-secondary truncate">
              {{ s.artist || "—" }}
            </div>
          </div>
          <div class="text-xs text-text-secondary w-16 text-right shrink-0">
            {{ fmtDuration(s.duration) }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
