const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_REQUEST_EDGE = 1200;
const CACHE_LIMIT = 512;

const resizedUrlCache = new Map<string, string>();

function isNcmImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "music.126.net" ||
    host.endsWith(".music.126.net") ||
    host === "music.163.com" ||
    host.endsWith(".music.163.com")
  );
}

function requestEdge(displayEdge: number, devicePixelRatio?: number): number {
  const fallbackDpr =
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const requestedDpr = devicePixelRatio ?? fallbackDpr;
  const dpr = Math.min(
    MAX_DEVICE_PIXEL_RATIO,
    Math.max(1, Number.isFinite(requestedDpr) ? requestedDpr : 1),
  );
  const safeDisplayEdge = Number.isFinite(displayEdge)
    ? Math.max(1, displayEdge)
    : 1;
  return Math.min(
    MAX_REQUEST_EDGE,
    Math.ceil(safeDisplayEdge * dpr),
  );
}

function cacheResult(key: string, value: string): string {
  if (resizedUrlCache.size >= CACHE_LIMIT) {
    const oldestKey = resizedUrlCache.keys().next().value;
    if (oldestKey !== undefined) resizedUrlCache.delete(oldestKey);
  }
  resizedUrlCache.set(key, value);
  return value;
}

/**
 * 为网易云封面 URL 附加服务端缩放参数。
 *
 * `displayEdge` 使用 CSS 像素；默认最多按 2x DPR 请求，避免高 DPI 屏幕
 * 模糊的同时限制下载与解码尺寸。非网易云、data:、blob: URL 原样返回。
 */
export function coverImageUrl(
  source: string | null | undefined,
  displayEdge: number,
  devicePixelRatio?: number,
): string {
  if (!source) return "";

  const edge = requestEdge(displayEdge, devicePixelRatio);
  const cacheKey = `${source}\n${edge}`;
  const cached = resizedUrlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const url = new URL(source);
    if (!isNcmImageHost(url.hostname)) return cacheResult(cacheKey, source);
    url.searchParams.set("param", `${edge}y${edge}`);
    return cacheResult(cacheKey, url.toString());
  } catch {
    return cacheResult(cacheKey, source);
  }
}
