/**
 * 最近搜索的本地记录。
 *
 * 目的：搜索页的空态不该只是一句提示，用「你刚才搜过什么」把回忆负担从用户
 * 身上拿走（Nielsen #6）。只存关键词、不存结果；最多保留 6 条，重复关键词
 * 去重（大小写不敏感、保留最新写法）。
 */

const STORAGE_KEY = "nnplayer.recentSearches";
const MAX_ENTRIES = 6;

/** 存储接口子集：便于测试注入假实现，也容忍 localStorage 不可用。 */
export interface RecentSearchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): RecentSearchStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 关键词归一化：去掉首尾空白、连续空白压成单空格。
 *  搜索页与历史记录共用这一份规则，避免「记下的词」和「实际搜的词」漂移。 */
export function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** 读取最近搜索（新→旧）；数据损坏时返回空数组而不是抛错。 */
export function loadRecentSearches(
  storage: RecentSearchStorage | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const normalized = normalizeQuery(entry);
      if (!normalized) continue;
      if (result.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        continue;
      }
      result.push(normalized);
      if (result.length >= MAX_ENTRIES) break;
    }
    return result;
  } catch {
    return [];
  }
}

function save(storage: RecentSearchStorage, entries: string[]): string[] {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 隐私模式/配额不足：搜索本身不能因为记不住历史而失败。
  }
  return entries;
}

/** 记录一次搜索，返回更新后的列表（新→旧）。 */
export function addRecentSearch(
  query: string,
  storage: RecentSearchStorage | null = defaultStorage(),
): string[] {
  const normalized = normalizeQuery(query);
  if (!normalized || !storage) return loadRecentSearches(storage);
  const existing = loadRecentSearches(storage).filter(
    (item) => item.toLowerCase() !== normalized.toLowerCase(),
  );
  return save(storage, [normalized, ...existing].slice(0, MAX_ENTRIES));
}

/** 清空最近搜索。 */
export function clearRecentSearches(
  storage: RecentSearchStorage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // 忽略：清不掉历史不影响搜索。
  }
}
