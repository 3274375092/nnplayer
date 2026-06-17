// 本地歌曲封面缓存 + 懒加载。
// 解决问题：
//   1. 列表 / 播放栏 / 详情页都需要同一张封面，避免重复 invoke + 重复解码
//   2. 同一 path 并发请求去重（in-flight promise 共享）
//   3. 集中管理 blob URL 的生命周期：LRU 上限避免无界增长泄漏内存
//
// 与 Tauri 后端 getLocalCover（commands/local_music.rs::get_local_cover）配套。

import { getLocalCover } from "@/composables/useNcmApi";

/** 缓存上限：超过后按插入顺序淘汰最旧条目并 revoke 其 blob URL */
const MAX_CACHED_COVERS = 200;

const coverCache = new Map<string, string>(); // path -> blob URL
const inflight = new Map<string, Promise<string | null>>(); // path -> in-flight promise

/**
 * 获取本地歌曲的封面 blob URL。
 * - 已缓存：直接返回
 * - 正在加载：返回 in-flight promise（并发去重）
 * - 未缓存：调用 getLocalCover invoke，写入缓存
 * @returns blob URL 或 null（无封面/失败）
 */
export async function getLocalCoverUrl(path: string): Promise<string | null> {
  const cached = coverCache.get(path);
  if (cached) return cached;

  const pending = inflight.get(path);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const bytes = await getLocalCover(path);
      const u8 = new Uint8Array(bytes);
      const blob = new Blob([u8], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      coverCache.set(path, url);
      evictIfFull();
      return url;
    } catch (e) {
      console.warn("[useLocalCover] 加载封面失败", path, e);
      return null;
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, promise);
  return promise;
}

/** 缓存超限时淘汰最旧条目，revoke 其 blob URL 释放内存 */
function evictIfFull(): void {
  while (coverCache.size > MAX_CACHED_COVERS) {
    const oldest = coverCache.keys().next().value;
    if (oldest === undefined) break;
    const url = coverCache.get(oldest);
    coverCache.delete(oldest);
    if (url) URL.revokeObjectURL(url);
  }
}

/** 释放某 path 的 blob URL（通常不需要，缓存全局复用） */
export function revokeLocalCover(path: string): void {
  const url = coverCache.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    coverCache.delete(path);
  }
}

/** 释放全部 blob URL（应用退出/重置时） */
export function revokeAllLocalCovers(): void {
  for (const url of coverCache.values()) URL.revokeObjectURL(url);
  coverCache.clear();
  inflight.clear();
}
