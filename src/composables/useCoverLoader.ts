// 本地封面懒加载的并发 worker pool。
// 抽自 LocalMusic / LocalAlbum / LocalArtist 三个视图（原先各有一份逐字重复的
// CONCURRENCY=8 + queue.shift + Promise.all 脚手架）。
//
// 复用 useLocalCover 的全局缓存（同一 path 的 blob URL 只拉一次），
// 这里只负责限流并发地把结果写进各自的响应式 Map。
import type { Ref } from "vue";
import { getLocalCoverUrl } from "@/composables/useLocalCover";

/** 封面懒加载的并发上限 */
const COVER_LOAD_CONCURRENCY = 8;

interface CoverTask<K> {
  /** 实际去拉封面的文件路径 */
  path: string;
  /** 写入 Map 的键（如 path 本身、album 复合 key、artist 名） */
  key: K;
}

/**
 * 限流并发加载封面，把命中的 blob URL 写进响应式 Map。
 * - 已有缓存（Map 里已有 key）的任务跳过
 * - 同一 path 走 useLocalCover 全局去重
 * - 每次写入都用新 Map 替换 ref.value，触发响应式重渲染
 */
export async function loadCoversInto<K>(
  tasks: CoverTask<K>[],
  mapRef: Ref<Map<K, string>>,
): Promise<void> {
  const queue = tasks.filter((t) => t.path && !mapRef.value.has(t.key));
  if (queue.length === 0) return;

  const workers = Array.from(
    { length: Math.min(COVER_LOAD_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) break;
        const url = await getLocalCoverUrl(task.path);
        if (url) {
          const next = new Map(mapRef.value);
          next.set(task.key, url);
          mapRef.value = next;
        }
      }
    },
  );
  await Promise.all(workers);
}
