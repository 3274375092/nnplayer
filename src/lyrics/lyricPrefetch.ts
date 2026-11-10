// 下一首歌词预取决策（纯函数，便于单测）。
//
// 顺序播放时在上一首播放期间就预热下一首的歌词时间轴：切歌命中缓存后
// LyricPanel 不需要经历「清空列表 → 加载态 → 重新挂载 120 行」，
// 直接对已挂载的行 patch，切歌帧不再被整列表重建拉长。

import type { PlayMode } from "@/types/music";

export interface LyricPrefetchCandidate {
  playMode: PlayMode;
  queue: ReadonlyArray<{ id: number }>;
  index: number;
  currentSongId: number | null;
}

/** 返回应预取歌词的歌曲 id；不满足顺序播放/存在确定下一首时返回 null。 */
export function getNextLyricPrefetchSongId(
  candidate: LyricPrefetchCandidate,
): number | null {
  if (candidate.playMode !== "loop-list") return null;
  const { queue, index } = candidate;
  if (queue.length < 2 || index < 0 || index >= queue.length) return null;
  const nextSong = queue[(index + 1) % queue.length];
  if (!nextSong) return null;
  if (nextSong.id === candidate.currentSongId) return null;
  return nextSong.id;
}
