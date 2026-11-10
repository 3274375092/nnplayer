import { coverImageUrl } from "@/utils/coverImage";
import {
  extractPaletteFromRgba,
  SAMPLE_SIZE,
  type ExtractedPalette,
} from "@/utils/colorPalette";
import {
  DYNAMIC_THEME_CSS_VARIABLES,
  deriveCoverTheme,
  type DerivedCoverTheme,
} from "@/utils/themeTokens";

const PALETTE_CACHE_LIMIT = 24;
/** Worker 取色超时：超时/失败一律回退主线程，不阻塞主题应用。 */
const PALETTE_WORKER_TIMEOUT_MS = 3000;

const paletteCache = new Map<string, ExtractedPalette>();

function cachePalette(key: string, value: ExtractedPalette): ExtractedPalette {
  if (paletteCache.size >= PALETTE_CACHE_LIMIT) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey !== undefined) paletteCache.delete(oldestKey);
  }
  paletteCache.set(key, value);
  return value;
}

// =============== Worker 路径（主线程只收结果） ===============

interface PendingWorkerRequest {
  resolve: (palette: ExtractedPalette) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let paletteWorker: Worker | null = null;
let paletteWorkerUnavailable = false;
let paletteWorkerSeq = 0;
const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();

/** Worker 不可用/加载失败时永久回退主线程，避免反复构造失败对象。 */
function disablePaletteWorker(reason: unknown) {
  paletteWorkerUnavailable = true;
  if (paletteWorker) {
    paletteWorker.terminate();
    paletteWorker = null;
  }
  const pending = [...pendingWorkerRequests.values()];
  pendingWorkerRequests.clear();
  for (const request of pending) {
    clearTimeout(request.timer);
    request.reject(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  }
}

function getPaletteWorker(): Worker | null {
  if (paletteWorkerUnavailable) return null;
  if (paletteWorker) return paletteWorker;
  try {
    const worker = new Worker(
      new URL("./colorPalette.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      event: MessageEvent<
        | { id: number; palette: ExtractedPalette }
        | { id: number; error: string }
      >,
    ) => {
      const data = event.data;
      const request = pendingWorkerRequests.get(data.id);
      if (!request) return;
      pendingWorkerRequests.delete(data.id);
      clearTimeout(request.timer);
      if ("palette" in data) {
        request.resolve(data.palette);
      } else {
        request.reject(new Error(data.error));
      }
    };
    worker.onerror = (event) => {
      disablePaletteWorker(new Error(event.message || "封面取色 Worker 出错"));
    };
    paletteWorker = worker;
    return worker;
  } catch (error) {
    disablePaletteWorker(error);
    return null;
  }
}

function extractPaletteInWorker(
  sampledUrl: string,
  sampleSize: number,
): Promise<ExtractedPalette> {
  const worker = getPaletteWorker();
  if (!worker) {
    return Promise.reject(new Error("封面取色 Worker 不可用"));
  }
  const id = (paletteWorkerSeq += 1);
  return new Promise<ExtractedPalette>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorkerRequests.delete(id);
      reject(new Error("封面取色 Worker 超时"));
    }, PALETTE_WORKER_TIMEOUT_MS);
    pendingWorkerRequests.set(id, { resolve, reject, timer });
    worker.postMessage({ id, url: sampledUrl, sampleSize });
  });
}

// =============== 主线程兜底路径 ===============

async function extractPaletteOnMainThread(
  sampledUrl: string,
  sampleSize: number,
): Promise<ExtractedPalette> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("封面图加载失败"));
    img.src = sampledUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 不可用");
  ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  return extractPaletteFromRgba(data);
}

// =============== 对外入口 ===============

/** DEV 下记录 Worker 取色耗时，供真机性能测量（生产构建零开销）。 */
let devMeasureId = 0;
function measureDevAsync<T>(name: string, task: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV || typeof performance === "undefined") {
    return task();
  }
  const id = `${name}-${devMeasureId++}`;
  performance.mark(`${id}-start`);
  return task().finally(() => {
    performance.mark(`${id}-end`);
    performance.measure(`nnplayer:${name}`, `${id}-start`, `${id}-end`);
    performance.clearMarks(`${id}-start`);
    performance.clearMarks(`${id}-end`);
  });
}

/**
 * 提取封面调色板：优先在 Worker 中下载/解码/采样，Worker 不可用时回退
 * 主线程。结果按「采样尺寸 + 采样 URL」缓存，近期切回同一首歌不再取色。
 */
export async function extractPalette(
  imgUrl: string,
  sampleSize = SAMPLE_SIZE,
): Promise<ExtractedPalette> {
  // 网易云图片先请求服务端缩略图，避免为 112px 采样完整解码大封面。
  const sampledUrl = coverImageUrl(imgUrl, sampleSize, 1);
  const cacheKey = `${sampleSize}\n${sampledUrl}`;
  const cached = paletteCache.get(cacheKey);
  if (cached) {
    paletteCache.delete(cacheKey);
    paletteCache.set(cacheKey, cached);
    return cached;
  }

  let extracted: ExtractedPalette;
  try {
    extracted = await measureDevAsync("coverPaletteWorker", () =>
      extractPaletteInWorker(sampledUrl, sampleSize),
    );
  } catch {
    extracted = await extractPaletteOnMainThread(sampledUrl, sampleSize);
  }
  return cachePalette(cacheKey, extracted);
}

/** 将封面原色派生为可读的浅色主题，并原子写入 :root。 */
export function applyToCssVars(
  palette: readonly string[] | string,
): DerivedCoverTheme {
  const derived = deriveCoverTheme(palette);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(derived.tokens)) {
    root.style.setProperty(name, value);
  }
  root.dataset.themeSource = "cover";
  return derived;
}

export function resetCssVars(): void {
  const root = document.documentElement;
  for (const name of DYNAMIC_THEME_CSS_VARIABLES) {
    root.style.removeProperty(name);
  }
  delete root.dataset.themeSource;
}
