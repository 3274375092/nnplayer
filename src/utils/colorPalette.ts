// 封面调色板直方图（纯函数，无 DOM/Canvas 依赖）。
//
// 同时被主线程兜底路径与 Worker 路径使用：把 112×112 像素的 RGBA 聚类成
// 「种子色 + 最多 3 个辅助色」。Worker 只负责图片获取/解码/采样，真正的
// 颜色聚类在这里，避免两套实现漂移。

import {
  DEFAULT_THEME_SEED,
  hslToHex,
  rgbToHsl,
} from "@/utils/themeTokens";

export const SAMPLE_SIZE = 112;
export const HUE_BUCKETS = 18;
export const SAT_BUCKETS = 4;
export const LIGHT_BUCKETS = 5;

export interface ExtractedPalette {
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

/** 从 RGBA 像素数组聚类出可读的浅色主题种子色与辅助色。 */
export function extractPaletteFromRgba(
  data: Uint8ClampedArray,
): ExtractedPalette {
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
    return { seed: DEFAULT_THEME_SEED, palette: [DEFAULT_THEME_SEED] };
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
  const seedHex = hslToHex(
    seedEntry.hsl.h,
    seedEntry.hsl.s,
    seedEntry.hsl.l,
  );

  const companions: string[] = [];
  const usedHueBuckets = new Set<number>();
  // 极少量 JPEG 边缘杂色不能左右整套环境色；辅助色至少要有可见面积。
  const minimumCompanionCount = Math.max(8, Math.ceil(seedEntry.count * 0.04));
  usedHueBuckets.add(seedEntry.hueBucket);
  for (const entry of sorted.slice(1)) {
    if (entry.count < minimumCompanionCount) continue;
    const hIdx = entry.hueBucket;
    if (usedHueBuckets.has(hIdx)) continue;
    if (companions.length >= 3) break;
    companions.push(hslToHex(entry.hsl.h, entry.hsl.s, entry.hsl.l));
    usedHueBuckets.add(hIdx);
  }

  return { seed: seedHex, palette: [seedHex, ...companions] };
}
