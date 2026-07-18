import {
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
} from "vue";

import {
  getAuthEpoch,
  subscribeAuthEpoch,
} from "@/services/authEpoch";

export type QueryKeyPart = string | number | boolean | null | undefined;
export type QueryKey = string | readonly QueryKeyPart[];

export interface QueryFetchOptions {
  /** 数据在这段时间内直接复用，不再发起请求。 */
  staleTime?: number;
  /** 数据无人读取后最多保留多久。 */
  gcTime?: number;
  /** 跳过新鲜度检查并重新请求；已有同键请求仍会复用。 */
  force?: boolean;
}

interface CacheEntry<T = unknown> {
  data?: T;
  hasData: boolean;
  updatedAt: number;
  expiresAt: number;
  promise: Promise<T> | null;
  authEpoch: number;
}

interface CacheHit<T> {
  hit: true;
  data: T;
}

interface CacheMiss {
  hit: false;
}

const DEFAULT_STALE_TIME = 30_000;
const DEFAULT_GC_TIME = 5 * 60_000;
// Song/playlist payloads can be large. A tighter LRU bound keeps route churn from
// retaining dozens of complete track lists until their individual GC deadlines.
const MAX_CACHE_ENTRIES = 32;
const MAX_TIMER_DELAY = 2_147_483_647;

const cache = new Map<string, CacheEntry>();
const activeQueries = new Set<() => void>();

let cacheGeneration = 0;
let gcTimer: ReturnType<typeof setTimeout> | null = null;
let gcTimerAt = Number.POSITIVE_INFINITY;
let moduleActive = true;

function normalizeDuration(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function encodeKeyPart(part: QueryKeyPart): readonly [string, string] {
  if (part === null) return ["null", ""];
  if (part === undefined) return ["undefined", ""];
  return [typeof part, String(part)];
}

function hashQueryKey(key: QueryKey): string {
  if (typeof key === "string") {
    return JSON.stringify(["single", encodeKeyPart(key)]);
  }
  return JSON.stringify(["parts", key.map(encodeKeyPart)]);
}

function clearGcTimer(): void {
  if (gcTimer !== null) clearTimeout(gcTimer);
  gcTimer = null;
  gcTimerAt = Number.POSITIVE_INFINITY;
}

function scheduleGc(now = Date.now()): void {
  if (!moduleActive || cache.size === 0) {
    clearGcTimer();
    return;
  }

  let earliestExpiry = Number.POSITIVE_INFINITY;
  for (const entry of cache.values()) {
    earliestExpiry = Math.min(earliestExpiry, entry.expiresAt);
  }

  if (!Number.isFinite(earliestExpiry)) {
    clearGcTimer();
    return;
  }

  const nextTimerAt = Math.min(earliestExpiry, now + MAX_TIMER_DELAY);
  if (gcTimer !== null && gcTimerAt === nextTimerAt) return;

  clearGcTimer();
  gcTimerAt = nextTimerAt;
  gcTimer = setTimeout(() => {
    gcTimer = null;
    gcTimerAt = Number.POSITIVE_INFINITY;
    prune(Date.now());
  }, Math.max(0, nextTimerAt - now));

  // Node-based unit tests must be able to finish without waiting for a browser
  // cache timer. This is a no-op for the numeric timer handle used by browsers.
  (gcTimer as unknown as { unref?: () => void }).unref?.();
}

function touch(key: string, entry: CacheEntry): void {
  if (cache.get(key) !== entry) return;
  cache.delete(key);
  cache.set(key, entry);
}

function prune(now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    // In-flight entries may also be evicted. Their identity/generation checks
    // below ensure a late response cannot resurrect an evicted cache entry.
    cache.delete(oldestKey);
  }

  scheduleGc(now);
}

function readFresh<T>(
  key: QueryKey,
  staleTime: number,
  gcTime: number,
): CacheHit<T> | CacheMiss {
  const now = Date.now();
  prune(now);

  const hash = hashQueryKey(key);
  const entry = cache.get(hash) as CacheEntry<T> | undefined;
  if (
    !entry ||
    entry.authEpoch !== getAuthEpoch() ||
    !entry.hasData ||
    now - entry.updatedAt > staleTime
  ) {
    return { hit: false };
  }

  entry.expiresAt = now + gcTime;
  touch(hash, entry);
  prune(now);
  return { hit: true, data: entry.data as T };
}

/**
 * 读取或请求一份远端数据。
 *
 * 同一个 key 同时只执行一个 fetcher；失败不会污染已有的成功缓存。
 */
export function fetchQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options: QueryFetchOptions = {},
): Promise<T> {
  const staleTime = normalizeDuration(options.staleTime, DEFAULT_STALE_TIME);
  const gcTime = Math.max(
    staleTime,
    normalizeDuration(options.gcTime, DEFAULT_GC_TIME),
  );
  const now = Date.now();
  const requestAuthEpoch = getAuthEpoch();
  const requestGeneration = cacheGeneration;
  prune(now);

  const hash = hashQueryKey(key);
  let entry = cache.get(hash) as CacheEntry<T> | undefined;
  if (entry?.authEpoch !== requestAuthEpoch) {
    cache.delete(hash);
    entry = undefined;
  }

  // force refresh only skips cached data; it still deduplicates the same
  // request while that request is in flight.
  if (entry?.promise) {
    entry.expiresAt = Math.max(entry.expiresAt, now + gcTime);
    touch(hash, entry);
    prune(now);
    return entry.promise;
  }

  if (
    !options.force &&
    entry?.hasData &&
    now - entry.updatedAt <= staleTime
  ) {
    entry.expiresAt = now + gcTime;
    touch(hash, entry);
    prune(now);
    return Promise.resolve(entry.data as T);
  }

  if (!entry) {
    entry = {
      hasData: false,
      updatedAt: 0,
      expiresAt: now + gcTime,
      promise: null,
      authEpoch: requestAuthEpoch,
    };
    cache.set(hash, entry);
  } else {
    entry.expiresAt = now + gcTime;
    touch(hash, entry);
  }

  const target = entry;
  let request!: Promise<T>;
  const ownsCurrentEntry = () =>
    moduleActive &&
    cacheGeneration === requestGeneration &&
    getAuthEpoch() === requestAuthEpoch &&
    cache.get(hash) === target &&
    target.promise === request;

  request = Promise.resolve()
    .then(fetcher)
    .then(
      (data) => {
        if (ownsCurrentEntry()) {
          const resolvedAt = Date.now();
          target.data = data;
          target.hasData = true;
          target.updatedAt = resolvedAt;
          target.expiresAt = resolvedAt + gcTime;
          target.promise = null;
          touch(hash, target);
          prune(resolvedAt);
        }
        return data;
      },
      (error: unknown) => {
        if (ownsCurrentEntry()) {
          target.promise = null;
          if (!target.hasData) cache.delete(hash);
          else touch(hash, target);
          prune();
        }
        throw error;
      },
    );

  target.promise = request;
  prune(now);
  return request;
}

function invalidateAuthScopedState(): void {
  cacheGeneration += 1;
  cache.clear();
  clearGcTimer();
  for (const resetActiveQuery of [...activeQueries]) resetActiveQuery();
}

const unsubscribeAuthEpoch = subscribeAuthEpoch(invalidateAuthScopedState);

/**
 * 把共享缓存接到当前 Vue 组件的响应式状态上。
 * 组件卸载、下一次请求或登录主体变化后，旧请求不会再写入组件 ref。
 */
export function useQueryCache<T, TError = unknown>() {
  const data = shallowRef<T | null>(null);
  const error = shallowRef<TError | null>(null);
  const loading = ref(false);

  let revision = 0;
  let active = true;

  function resetForAuthChange(): void {
    revision += 1;
    data.value = null;
    error.value = null;
    loading.value = false;
  }

  if (getCurrentScope()) {
    activeQueries.add(resetForAuthChange);
    onScopeDispose(() => {
      active = false;
      revision += 1;
      activeQueries.delete(resetForAuthChange);
    });
  }

  async function execute(
    key: QueryKey,
    fetcher: () => Promise<T>,
    options: QueryFetchOptions = {},
  ): Promise<T | undefined> {
    const staleTime = normalizeDuration(options.staleTime, DEFAULT_STALE_TIME);
    const gcTime = Math.max(
      staleTime,
      normalizeDuration(options.gcTime, DEFAULT_GC_TIME),
    );
    const executionAuthEpoch = getAuthEpoch();
    const currentRevision = ++revision;

    if (!options.force) {
      const cached = readFresh<T>(key, staleTime, gcTime);
      if (cached.hit) {
        if (
          active &&
          currentRevision === revision &&
          executionAuthEpoch === getAuthEpoch()
        ) {
          data.value = cached.data;
          error.value = null;
          loading.value = false;
        }
        return cached.data;
      }
    }

    if (active) {
      error.value = null;
      loading.value = true;
    }

    try {
      const result = await fetchQuery(key, fetcher, options);
      if (executionAuthEpoch !== getAuthEpoch()) return undefined;
      if (active && currentRevision === revision) data.value = result;
      return result;
    } catch (cause) {
      if (
        active &&
        currentRevision === revision &&
        executionAuthEpoch === getAuthEpoch()
      ) {
        error.value = cause as TError;
      }
      return undefined;
    } finally {
      if (
        active &&
        currentRevision === revision &&
        executionAuthEpoch === getAuthEpoch()
      ) {
        loading.value = false;
      }
    }
  }

  /** 使当前组件正在等待的结果失效，但保留已经展示的数据。 */
  function cancel(): void {
    revision += 1;
    loading.value = false;
  }

  /** 清空当前组件状态，不影响其它页面仍可能复用的共享缓存。 */
  function reset(): void {
    revision += 1;
    data.value = null;
    error.value = null;
    loading.value = false;
  }

  return { data, error, loading, execute, cancel, reset };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    moduleActive = false;
    unsubscribeAuthEpoch();
    cacheGeneration += 1;
    cache.clear();
    clearGcTimer();
    for (const resetActiveQuery of [...activeQueries]) resetActiveQuery();
    activeQueries.clear();
  });
}
