import { computed, ref } from "vue";
import { defineStore } from "pinia";

import { scanLocalFolder } from "@/composables/useNcmApi";
import type { LocalSongMetadata } from "@/types/music";

const FOLDERS_KEY = "nnplayer.localFolders";

/** 专辑分组：UI 消费的形态 */
export interface AlbumGroup {
  /** 内部复合 key = `${name}||${artist}`，用于 detail 页 findAlbum */
  key: string;
  /** 专辑名（用于显示 / URL） */
  name: string;
  /** 主艺人（用于显示 / URL） */
  artist: string;
  songs: LocalSongMetadata[];
}

/** 艺人分组 */
export interface ArtistGroup {
  name: string;
  songs: LocalSongMetadata[];
}

export const useLocalLibraryStore = defineStore("localLibrary", () => {
  const songs = ref<LocalSongMetadata[]>([]);
  const folders = ref<string[]>(
    JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]"),
  );
  const scanning = ref(false);

  /**
   * 按专辑分组。
   * key = `${album}||${artist}` 复合 key，避免「不同艺人同名专辑」合并。
   * 暴露 AlbumGroup 接口，UI 拿 name/artist 而不是 raw key。
   */
  const albums = computed<AlbumGroup[]>(() => {
    const map = new Map<string, LocalSongMetadata[]>();
    for (const s of songs.value) {
      const album = s.album || "未知专辑";
      const artist = s.artist || "未知艺人";
      const key = `${album}||${artist}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).map(([key, songs]) => {
      const [name, artist] = key.split("||");
      return { key, name, artist, songs };
    });
  });

  /** 给定 (album, artist) 找该组（用于 LocalAlbum.vue 详情页按 URL 解析） */
  function findAlbum(name: string, artist: string): LocalSongMetadata[] | null {
    const key = `${name}||${artist}`;
    return albums.value.find((a) => a.key === key)?.songs ?? null;
  }

  /**
   * 按艺人分组。
   * key = artist string。
   */
  const artists = computed<ArtistGroup[]>(() => {
    const map = new Map<string, LocalSongMetadata[]>();
    for (const s of songs.value) {
      const key = s.artist || "未知艺人";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).map(([name, songs]) => ({ name, songs }));
  });

  /** 给定 artist 找该组 */
  function findArtist(name: string): LocalSongMetadata[] | null {
    return artists.value.find((a) => a.name === name)?.songs ?? null;
  }

  function persistFolders() {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders.value));
  }

  async function addFolder(folder: string) {
    if (folders.value.includes(folder)) return;
    folders.value.push(folder);
    persistFolders();
    await scan();
  }

  async function removeFolder(folder: string) {
    const idx = folders.value.indexOf(folder);
    if (idx < 0) return;
    folders.value.splice(idx, 1);
    persistFolders();
    // 移除该目录下的歌曲：用路径分隔符边界匹配，
    // 避免 "D:/Music" 误删 "D:/Music2/..." 下的歌曲（纯 startsWith 会前缀误匹配）
    songs.value = songs.value.filter((s) => {
      if (s.path === folder) return false;
      return !s.path.startsWith(folder + "/") && !s.path.startsWith(folder + "\\");
    });
  }

  async function scan() {
    scanning.value = true;
    try {
      // 多文件夹并行扫描：命令无状态、可安全并发，
      // 比串行 await 省 (N-1) 次 IPC 往返等待
      const results = await Promise.all(
        folders.value.map((f) =>
          scanLocalFolder(f).catch((e) => {
            console.error(`[localLibrary] 扫描失败: ${f}`, e);
            return [] as LocalSongMetadata[];
          }),
        ),
      );
      songs.value = results.flat();
    } finally {
      scanning.value = false;
    }
  }

  async function init() {
    if (folders.value.length > 0) {
      await scan();
    }
  }

  return {
    songs,
    folders,
    scanning,
    albums,
    artists,
    findAlbum,
    findArtist,
    addFolder,
    removeFolder,
    scan,
    init,
  };
});
