<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { Disc3, Music2, Play, User } from "lucide-vue-next";

import { usePlayerStore } from "@/stores/player";
import { useLocalLibraryStore } from "@/stores/localLibrary";
import { fmtDuration } from "@/utils/format";
import { loadCoversInto } from "@/composables/useCoverLoader";
import { toLocalSong } from "@/utils/localSong";
import type { LocalSongMetadata, Song } from "@/types/music";

const router = useRouter();
const player = usePlayerStore();
const lib = useLocalLibraryStore();

const viewMode = ref<"list" | "albums" | "artists">("list");

/** 列表缩略图：path -> blob URL。响应式 Map 触发重新渲染。 */
const coverUrls = ref<Map<string, string>>(new Map());

/** 专辑封面：albumKey(`name||artist`) -> blob URL（取专辑第一首歌的封面） */
const albumCoverUrls = ref<Map<string, string>>(new Map());

/** 艺人封面：artistName -> blob URL（取第一首歌的封面） */
const artistCoverUrls = ref<Map<string, string>>(new Map());

async function addFolder() {
  try {
    const folder = await open({ directory: true, multiple: false });
    if (folder) {
      await lib.addFolder(folder);
    }
  } catch (e) {
    console.error("[LocalMusic] 选择目录失败", e);
  }
}

function playSong(meta: LocalSongMetadata) {
  player.playSong(toLocalSong(meta));
}

const displayedSongs = computed(() => {
  if (viewMode.value === "albums") {
    return lib.albums.flatMap((a) => a.songs);
  }
  if (viewMode.value === "artists") {
    return lib.artists.flatMap((a) => a.songs);
  }
  return lib.songs;
});

/** 专辑视图数据 */
const displayedAlbums = computed(() => {
  return lib.albums.map((a) => ({
    key: a.key,
    name: a.name,
    artist: a.artist,
    songs: a.songs,
    cover: albumCoverUrls.value.get(a.key) ?? "",
    count: a.songs.length,
    totalDuration: a.songs.reduce((s, x) => s + x.duration, 0),
  }));
});

/** 艺人视图数据 */
const displayedArtists = computed(() => {
  return lib.artists.map((a) => ({
    name: a.name,
    songs: a.songs,
    cover: artistCoverUrls.value.get(a.name) ?? "",
    count: a.songs.length,
    albumCount: new Set(a.songs.map((s) => s.album)).size,
  }));
});

function openAlbum(albumKey: string, albumName: string, artist: string) {
  // URL: /local-album/<encoded name>?artist=<encoded artist>
  // 用 query 存 artist 解决"同名专辑不同艺人"歧义
  void router.push({
    path: "/local-album/" + encodeURIComponent(albumName),
    query: { artist: encodeURIComponent(artist) },
  });
}

function openArtist(name: string) {
  void router.push("/local-artist/" + encodeURIComponent(name));
}

/** 把当前视图所有歌加入队列并从第一首开始播放（解决"队列只有 1 首→下一首 disabled"问题） */
function playAll() {
  const songs: Song[] = displayedSongs.value.map(toLocalSong);
  if (songs.length === 0) return;
  void player.playList(songs, 0);
}

/** 懒加载列表封面：限流并发，复用 useLocalCover 全局缓存 */
function loadListCovers() {
  return loadCoversInto(
    displayedSongs.value.map((s) => ({ path: s.path, key: s.path })),
    coverUrls,
  );
}

/** 懒加载专辑封面：取每专辑第一首歌的封面（key 为专辑复合 key） */
function loadAlbumCovers() {
  return loadCoversInto(
    lib.albums
      .map((a) => ({ key: a.key, path: a.songs[0]?.path ?? "" }))
      .filter((x) => x.path),
    albumCoverUrls,
  );
}

/** 懒加载艺人封面（key 为艺人名） */
function loadArtistCovers() {
  return loadCoversInto(
    lib.artists
      .map((a) => ({ key: a.name, path: a.songs[0]?.path ?? "" }))
      .filter((x) => x.path),
    artistCoverUrls,
  );
}

onMounted(() => {
  void loadListCovers();
  void loadAlbumCovers();
  void loadArtistCovers();
});

watch(displayedSongs, () => {
  void loadListCovers();
});

// albums / artists 引用变化时重新拉
watch(() => lib.albums, () => {
  void loadAlbumCovers();
}, { deep: false });
watch(() => lib.artists, () => {
  void loadArtistCovers();
}, { deep: false });
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold">本地音乐</h1>
      <div class="flex items-center gap-2">
        <button
          v-if="lib.songs.length > 0"
          class="btn btn-ghost text-xs flex items-center gap-1"
          @click="playAll"
        >
          <Play :size="12" :stroke-width="2" />
          播放全部
        </button>
        <button
          class="btn btn-ghost text-xs"
          :disabled="lib.scanning"
          @click="lib.scan"
        >
          {{ lib.scanning ? "扫描中…" : "重新扫描" }}
        </button>
        <button class="btn btn-primary text-xs" @click="addFolder">
          添加文件夹
        </button>
      </div>
    </div>

    <!-- 已添加的文件夹 -->
    <div v-if="lib.folders.length" class="mb-4 flex flex-wrap gap-2">
      <div
        v-for="f in lib.folders"
        :key="f"
        class="flex items-center gap-1 text-xs bg-hover rounded px-2 py-1"
      >
        <span class="truncate max-w-40">{{ f }}</span>
        <button
          class="text-text-secondary hover:text-text-primary ml-1"
          @click="lib.removeFolder(f)"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="!lib.scanning && lib.songs.length === 0"
      class="flex flex-col items-center justify-center py-20 text-text-secondary"
    >
      <Music2 :size="48" :stroke-width="1" class="mb-3 opacity-40" />
      <p class="text-sm">暂无本地音乐</p>
      <p class="text-xs mt-1">点击"添加文件夹"扫描本地音乐</p>
    </div>

    <!-- 视图切换 -->
    <div
      v-if="lib.songs.length > 0"
      class="flex gap-1 mb-4 border-b border-hover pb-2"
    >
      <button
        class="text-xs px-2 py-1 rounded"
        :class="viewMode === 'list' ? 'bg-accent text-white' : 'hover:bg-hover'"
        @click="viewMode = 'list'"
      >
        列表
      </button>
      <button
        class="text-xs px-2 py-1 rounded"
        :class="viewMode === 'albums' ? 'bg-accent text-white' : 'hover:bg-hover'"
        @click="viewMode = 'albums'"
      >
        按专辑
      </button>
      <button
        class="text-xs px-2 py-1 rounded"
        :class="viewMode === 'artists' ? 'bg-accent text-white' : 'hover:bg-hover'"
        @click="viewMode = 'artists'"
      >
        按艺人
      </button>
    </div>

    <!-- 专辑网格（按专辑视图） -->
    <div
      v-if="lib.songs.length > 0 && viewMode === 'albums'"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
    >
      <button
        v-for="a in displayedAlbums"
        :key="a.key"
        type="button"
        class="text-left group"
        @click="openAlbum(a.key, a.name, a.artist)"
      >
        <div
          class="aspect-square w-full rounded-lg overflow-hidden bg-hover flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow"
        >
          <img
            v-if="a.cover"
            :src="a.cover"
            :alt="a.name"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <Disc3 v-else :size="40" :stroke-width="1" class="text-text-secondary" />
        </div>
        <div class="mt-2 text-sm font-medium truncate" :title="a.name">{{ a.name }}</div>
        <div class="text-xs text-text-secondary truncate">
          <span v-if="a.artist">{{ a.artist }} · </span>
          <span>{{ a.count }} 首</span>
        </div>
      </button>
    </div>

    <!-- 艺人网格（按艺人视图） -->
    <div
      v-else-if="lib.songs.length > 0 && viewMode === 'artists'"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))"
    >
      <button
        v-for="a in displayedArtists"
        :key="a.name"
        type="button"
        class="text-left group"
        @click="openArtist(a.name)"
      >
        <div
          class="aspect-square w-full rounded-full overflow-hidden bg-hover flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow"
        >
          <img
            v-if="a.cover"
            :src="a.cover"
            :alt="a.name"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <User v-else :size="40" :stroke-width="1" class="text-text-secondary" />
        </div>
        <div class="mt-2 text-sm font-medium truncate text-center" :title="a.name">{{ a.name }}</div>
        <div class="text-xs text-text-secondary truncate text-center">
          {{ a.count }} 首 · {{ a.albumCount }} 张专辑
        </div>
      </button>
    </div>

    <!-- 歌曲列表 -->
    <div v-else-if="lib.songs.length > 0" class="space-y-1">
      <div
        v-for="s in displayedSongs"
        :key="s.path"
        class="flex items-center gap-3 px-3 py-2 rounded-btn hover:bg-hover cursor-pointer group transition-colors"
        @dblclick="playSong(s)"
      >
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
  </div>
</template>
