<script setup lang="ts">
// 本地艺人详情页。
// 路由：/local-artist/:name
// 显示该艺人的所有歌（按 store lib.findArtist 拿），包含 4 个播放按钮。

import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, Music2, Play, Shuffle, User } from "lucide-vue-next";

import { usePlayerStore } from "@/stores/player";
import { useLocalLibraryStore } from "@/stores/localLibrary";
import { fmtDuration } from "@/utils/format";
import { getLocalCoverUrl } from "@/composables/useLocalCover";
import { loadCoversInto } from "@/composables/useCoverLoader";
import { toLocalSong } from "@/utils/localSong";

const props = defineProps<{ name: string }>();

const router = useRouter();
const player = usePlayerStore();
const lib = useLocalLibraryStore();

const artistName = computed(() => decodeURIComponent(props.name));

const artistSongs = computed<typeof lib.songs>(() => {
  return lib.findArtist(artistName.value) ?? [];
});

/** 艺人封面取第一首歌的封面（没有"艺人头像"概念，复用歌曲封面） */
const artistCoverPath = computed(() => artistSongs.value[0]?.path ?? "");
const artistCoverUrl = ref<string>("");

/** 该艺人涉及的专辑数（去重） */
const albumCount = computed(
  () => new Set(artistSongs.value.map((s) => s.album)).size,
);

function playSong(meta: (typeof lib.songs)[number]) {
  player.playSong(toLocalSong(meta));
}

function playAll() {
  const songs = artistSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  void player.playList(songs, 0);
}

function shufflePlay() {
  const songs = player.shuffled(artistSongs.value.map(toLocalSong));
  if (songs.length === 0) return;
  void player.playList(songs, 0);
}

function addToQueue() {
  const songs = artistSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  player.appendToQueue(songs);
}

function playAsNext() {
  const songs = artistSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  player.insertAsNextUp(songs);
  void player.next();
}

function goBack() {
  void router.push("/local-music");
}

const coverUrls = ref<Map<string, string>>(new Map());
onMounted(async () => {
  if (artistCoverPath.value) {
    const url = await getLocalCoverUrl(artistCoverPath.value);
    if (url) artistCoverUrl.value = url;
  }
  await loadCoversInto(
    artistSongs.value.map((s) => ({ path: s.path, key: s.path })),
    coverUrls,
  );
});

watch(artistSongs, (songs) => {
  coverUrls.value = new Map();
  artistCoverUrl.value = "";
  if (songs[0]?.path) {
    void getLocalCoverUrl(songs[0].path).then((u) => {
      if (u) artistCoverUrl.value = u;
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
      <h1 class="text-xl font-semibold truncate">{{ artistName }}</h1>
    </div>

    <div
      v-if="artistSongs.length === 0"
      class="flex flex-col items-center justify-center py-20 text-text-secondary"
    >
      <Music2 :size="48" :stroke-width="1" class="mb-3 opacity-40" />
      <p class="text-sm">该艺人没有歌曲</p>
      <p class="text-xs mt-1">可能尚未扫描或文件夹已移除</p>
    </div>

    <template v-else>
      <!-- 艺人头部：圆形封面 + 元信息 + 4 个播放按钮 -->
      <div class="flex items-center gap-6 mb-6">
        <div
          class="w-40 h-40 rounded-full overflow-hidden bg-hover flex items-center justify-center shrink-0 shadow-md"
        >
          <img
            v-if="artistCoverUrl"
            :src="artistCoverUrl"
            :alt="artistName"
            class="w-full h-full object-cover"
          />
          <User v-else :size="48" :stroke-width="1" class="text-text-secondary" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-2xl font-semibold truncate">{{ artistName }}</div>
          <div class="text-sm text-text-secondary mt-1">
            <span>{{ artistSongs.length }} 首</span>
            <span class="mx-1.5">·</span>
            <span>{{ albumCount }} 张专辑</span>
            <span class="mx-1.5">·</span>
            <span>{{ fmtDuration(artistSongs.reduce((s, x) => s + x.duration, 0)) }}</span>
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
              title="把这个艺人的歌插入到当前播放之后，播完当前这首立即播"
            >
              下一首播放
            </button>
            <button
              class="btn btn-ghost text-xs"
              @click="addToQueue"
              title="把这个艺人的歌追加到队尾"
            >
              添加到队列
            </button>
          </div>
        </div>
      </div>

      <!-- 歌曲列表 -->
      <div class="space-y-1">
        <div
          v-for="(s, i) in artistSongs"
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
              {{ s.album || "—" }}
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
