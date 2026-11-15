import type { Song } from "@/types/music";

/**
 * 队列「剩余时长」：从当前播放位置到队尾，还剩下多少毫秒。
 *
 * 当前曲只算还没播完的部分——把整首时长算进剩余时长会高估已经听过的时间
 * （评审反馈：「剩余时长」包含了当前曲的完整时长）。时间从 0 起算、夹在
 * 当前曲时长内，异常输入不会产出负数。
 *
 * @param queue 播放队列
 * @param currentIndex 当前曲索引；<0 表示还没有当前曲（从队首算起）
 * @param elapsedSeconds 当前曲已经播放的秒数
 */
export function remainingQueueDurationMs(
  queue: readonly Song[],
  currentIndex: number,
  elapsedSeconds: number,
): number {
  if (queue.length === 0) return 0;
  const hasCurrent = currentIndex >= 0 && currentIndex < queue.length;
  const start = hasCurrent ? currentIndex : 0;
  let totalMs = 0;
  for (let index = start; index < queue.length; index += 1) {
    totalMs += queue[index]?.duration ?? 0;
  }
  if (!hasCurrent) return totalMs;
  const currentDuration = queue[currentIndex]?.duration ?? 0;
  const safeElapsedSeconds = Number.isFinite(elapsedSeconds)
    ? Math.max(0, elapsedSeconds)
    : 0;
  const elapsedMs = Math.min(currentDuration, safeElapsedSeconds * 1000);
  return Math.max(0, totalMs - elapsedMs);
}
