import { coverImageUrl } from "@/utils/coverImage";
import {
  DEFAULT_THEME_SEED,
  DYNAMIC_THEME_CSS_VARIABLES,
  deriveCoverTheme,
  hslToHex,
  rgbToHsl,
  type DerivedCoverTheme,
} from "@/utils/themeTokens";

const SAMPLE_SIZE = 112;
const HUE_BUCKETS = 18;
const SAT_BUCKETS = 4;
const LIGHT_BUCKETS = 5;
const PALETTE_CACHE_LIMIT = 24;

interface ExtractedPalette {
  seed: string;
  palette: string[];
}

interface PaletteBucket {
  count: number;
  hueX: number;
  hueY: number;
  saturation: number;
  lightness: number;
  hueBucket: number;
}

const paletteCache = new Map<string, ExtractedPalette>();

function cachePalette(key: string, value: ExtractedPalette): ExtractedPalette {
  if (paletteCache.size >= PALETTE_CACHE_LIMIT) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey !== undefined) paletteCache.delete(oldestKey);
  }
  paletteCache.set(key, value);
  return value;
}

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

  const buckets = new Map<string, PaletteBucket>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.12) continue;
    if (l > 0.95) continue;
    if (s < 0.1) continue;

    const hIdx = Math.min(HUE_BUCKETS - 1, Math.floor(h / (360 / HUE_BUCKETS)));
    const sIdx = Math.min(SAT_BUCKETS - 1, Math.floor(s * SAT_BUCKETS));
    const lIdx = Math.min(LIGHT_BUCKETS - 1, Math.floor(l * LIGHT_BUCKETS));
    const key = `${hIdx}|${sIdx}|${lIdx}`;
    const hueRadians = (h * Math.PI) / 180;
    const cur = buckets.get(key);
    if (cur) {
      cur.count += 1;
      cur.hueX += Math.cos(hueRadians);
      cur.hueY += Math.sin(hueRadians);
      cur.saturation += s;
      cur.lightness += l;
    } else {
      buckets.set(key, {
        count: 1,
        hueX: Math.cos(hueRadians),
        hueY: Math.sin(hueRadians),
        saturation: s,
        lightness: l,
        hueBucket: hIdx,
      });
    }
  }

  if (buckets.size === 0) {
    return cachePalette(cacheKey, {
      seed: DEFAULT_THEME_SEED,
      palette: [DEFAULT_THEME_SEED],
    });
  }

  const sorted = [...buckets.values()]
    .map((bucket) => {
      const hue =
        ((Math.atan2(bucket.hueY, bucket.hueX) * 180) / Math.PI + 360) % 360;
      return {
        count: bucket.count,
        hueBucket: bucket.hueBucket,
        hsl: {
          h: hue,
          s: bucket.saturation / bucket.count,
          l: bucket.lightness / bucket.count,
        },
      };
    })
    .sort((a, b) => b.count - a.count);
  const seedEntry = sorted[0];
  const seed = seedEntry.hsl;
  const seedHex = hslToHex(seed.h, seed.s, seed.l);

  const companions: string[] = [];
  const usedHueBuckets = new Set<number>();
  // 极少量 JPEG 边缘杂色不能左右整套环境色；辅助色至少要有可见面积。
  const minimumCompanionCount = Math.max(
    8,
    Math.ceil(seedEntry.count * 0.04),
  );
  usedHueBuckets.add(seedEntry.hueBucket);
  for (const entry of sorted.slice(1)) {
    if (entry.count < minimumCompanionCount) continue;
    const hIdx = entry.hueBucket;
    if (usedHueBuckets.has(hIdx)) continue;
    if (companions.length >= 3) break;
    companions.push(hslToHex(entry.hsl.h, entry.hsl.s, entry.hsl.l));
    usedHueBuckets.add(hIdx);
  }

  return cachePalette(cacheKey, {
    seed: seedHex,
    palette: [seedHex, ...companions],
  });
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
