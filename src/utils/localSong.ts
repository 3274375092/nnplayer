// 本地歌曲的工具函数：path→数字 id 的稳定哈希 + LocalSongMetadata→Song 转换。
// 抽自 LocalMusic / LocalAlbum / LocalArtist 三个视图（原先各有一份逐字重复的实现）。
import type { LocalSongMetadata, Song } from "@/types/music";

/**
 * 用 path 的 djb2 变种哈希作为本地歌曲的数字 id。
 * 避免本地歌 id=0 与队列中其他条目冲突；同一 path 恒等映射，可跨页面复用。
 */
export function localId(path: string): number {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h) ^ path.charCodeAt(i);
  }
  return h >>> 0; // 强制为正 32 位
}

/** 把本地音频元数据转成统一的 Song（走本地播放引擎，localPath 非空）。 */
export function toLocalSong(meta: LocalSongMetadata): Song {
  return {
    id: localId(meta.path),
    name: meta.title,
    artists: meta.artist,
    album: meta.album,
    duration: Math.round(meta.duration * 1000),
    localPath: meta.path,
  };
}
