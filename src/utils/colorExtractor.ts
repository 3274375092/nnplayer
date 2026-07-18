import { coverImageUrl } from "@/utils/coverImage";

const SAMPLE_SIZE = 112;
const HUE_BUCKETS = 12;
const SAT_BUCKETS = 4;
const LIGHT_BUCKETS = 5;
const PALETTE_CACHE_LIMIT = 24;

interface ExtractedPalette {
  seed: string;
  palette: string[];
}

const paletteCache = new Map<string, ExtractedPalette>();

interface HSL {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      case bn:
        h = ((rn - gn) / d + 4) * 60;
        break;
    }
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const toHex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseHex(hex: string): HSL {
  return rgbToHsl(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );
}

function relativeLuminance(hex: string): number {
  const channels = [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function foregroundFor(background: string): string {
  const dark = "#000000";
  const light = "#ffffff";
  return contrastRatio(background, dark) >= contrastRatio(background, light)
    ? dark
    : light;
}

function accentWithContrast(
  h: number,
  s: number,
  initialLightness: number,
  surfaces: string[],
): { color: string; lightness: number } {
  let lightness = initialLightness;
  let color = hslToHex(h, s, lightness);
  while (
    surfaces.some((surface) => contrastRatio(color, surface) < 4.5) &&
    lightness < 0.88
  ) {
    lightness = Math.min(0.88, lightness + 0.01);
    color = hslToHex(h, s, lightness);
  }
  return { color, lightness };
}

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

  const buckets = new Map<string, { count: number; hsl: HSL }>();
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
    const cur = buckets.get(key);
    if (cur) {
      cur.count += 1;
    } else {
      buckets.set(key, { count: 1, hsl: { h, s, l } });
    }
  }

  if (buckets.size === 0) {
    return cachePalette(cacheKey, {
      seed: "#E85D3A",
      palette: ["#E85D3A"],
    });
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const seed = sorted[0].hsl;
  const seedHex = hslToHex(seed.h, seed.s, seed.l);

  const companions: string[] = [];
  const usedHueBuckets = new Set<number>();
  usedHueBuckets.add(Math.floor(seed.h / (360 / HUE_BUCKETS)));
  for (const entry of sorted.slice(1)) {
    const hIdx = Math.floor(entry.hsl.h / (360 / HUE_BUCKETS));
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

/** 把主色扩展成 18 个角色色，写到 :root CSS 变量。 */
export function applyToCssVars(seed: string): void {
  const { h, s, l } = parseHex(seed);

  const root = document.documentElement;

  // 强度系数：封面越鲜艳变化越明显，灰色封面也有基础色相偏移
  const p = 0.3 + Math.min(s, 0.7) * 0.7;

  // — 背景保持近黑，只带极微色相 —
  const background = hslToHex(h, Math.min(p * 0.08, 0.04), 0.045);
  root.style.setProperty("--color-bg", background);
  root.style.setProperty("--color-bg-from", hslToHex(h, Math.min(p * 0.12, 0.06), 0.07));
  root.style.setProperty("--color-bg-to", hslToHex(h, Math.min(p * 0.06, 0.03), 0.03));

  // — 表面只保留轻微色温，避免封面色把整张卡片染脏 —
  const card = hslToHex(h, Math.min(p * 0.22, 0.10), 0.115);
  root.style.setProperty("--color-card", card);
  root.style.setProperty("--color-card-hover", `hsla(${h}, 18%, 72%, 0.11)`);

  // — 边框承担层级，不抢主题色 —
  root.style.setProperty("--color-border", `hsla(${h}, 24%, 64%, 0.14)`);
  root.style.setProperty("--color-border-strong", `hsla(${h}, 28%, 68%, 0.24)`);
  root.style.setProperty("--color-ring", `hsla(${h}, 34%, 72%, 0.32)`);

  // — 单一同色系强调色；第二色只做明度过渡，不再跨到相邻色相 —
  const accentSaturation = Math.min(s * 1.25 + 0.16, 0.78);
  const initialAccentLightness = Math.max(0.55, Math.min(l * 1.12, 0.64));
  const { color: accent, lightness: accentLightness } = accentWithContrast(
    h,
    accentSaturation,
    initialAccentLightness,
    [background, card],
  );
  root.style.setProperty("--color-accent", accent);
  root.style.setProperty("--color-on-accent", foregroundFor(accent));
  root.style.setProperty("--color-accent-secondary", hslToHex((h + 6) % 360, Math.max(0.35, accentSaturation * 0.84), Math.min(0.70, accentLightness + 0.07)));
  root.style.setProperty("--color-accent-subtle", `hsla(${h}, 55%, 58%, 0.20)`);

  // — 文字保留色温，同时达到稳定的桌面端可读层级 —
  root.style.setProperty("--color-text-primary", hslToHex(h, Math.min(p * 0.05, 0.025), 0.93));
  root.style.setProperty("--color-text-secondary", hslToHex(h, Math.min(p * 0.04, 0.02), 0.66));
  root.style.setProperty("--color-text-tertiary", hslToHex(h, Math.min(p * 0.03, 0.015), 0.56));

  // — 阴影 —
  root.style.setProperty("--color-shadow", `hsla(${h}, 20%, 0%, 0.48)`);

  // — 滚动条明显 — 
  root.style.setProperty("--color-scrollbar", `hsla(${h}, 35%, 66%, 0.24)`);
  root.style.setProperty("--color-scrollbar-hover", `hsla(${h}, 42%, 70%, 0.42)`);

  // — 发光 —
  root.style.setProperty("--color-glow", `hsla(${h}, 55%, 58%, 0.24)`);
}

export function resetCssVars(): void {
  const root = document.documentElement;
  for (const name of [
    "--color-bg",
    "--color-bg-from",
    "--color-bg-to",
    "--color-card",
    "--color-card-hover",
    "--color-border",
    "--color-border-strong",
    "--color-ring",
    "--color-accent",
    "--color-on-accent",
    "--color-accent-secondary",
    "--color-accent-subtle",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-tertiary",
    "--color-shadow",
    "--color-scrollbar",
    "--color-scrollbar-hover",
    "--color-glow",
  ]) {
    root.style.removeProperty(name);
  }
}
