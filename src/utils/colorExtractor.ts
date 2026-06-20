// 封面主色提取 + ColorScheme 生成。
// 参考 ZeroBit-Player `lib/controller/audio_ctrl.dart:_setThemeColor4Cover`
// 的 QuantizerCelebi 思路，0 依赖手写简化版：把像素按 H/S/L 桶分，选频次最高为 seed。
//
// 不引 material_color_utilities 是因为：
// 1. Tauri WebView 里能跑但打包后体积 +200KB；
// 2. 我们只要 6 个角色色，不需要 16 色调色板；
// 3. 手写实现可以精确控制 L/S 偏移，匹配米黄默认体系的色感。

const SAMPLE_SIZE = 112; // 缩放后正方形边长
const HUE_BUCKETS = 12;   // 0~360 按 12 段分桶
const SAT_BUCKETS = 4;    // 0~1 按 4 段分桶
const LIGHT_BUCKETS = 5;  // 0~1 按 5 段分桶

interface HSL {
  h: number; // 0~360
  s: number; // 0~1
  l: number; // 0~1
}

/** RGB (0~255) → HSL (h: 0~360, s/l: 0~1) */
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

/** HSL → hex（#rrggbb） */
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

/** 从 URL 加载图片并提取主色调色板。 */
export async function extractPalette(
  imgUrl: string,
  sampleSize = SAMPLE_SIZE,
): Promise<{ seed: string; palette: string[] }> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  // 用 Promise 包装加载，失败时 reject 让上层 fallback
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("封面图加载失败"));
    img.src = imgUrl;
  });

  // 离屏 canvas 缩放（不挂载到 DOM）
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 不可用");
  ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

  // 桶：key = `${hueIdx}|${satIdx}|${lightIdx}` → count
  const buckets = new Map<string, { count: number; hsl: HSL }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue; // 透明像素（NCM 封面有圆角遮罩但 PNG 几乎不透明，先留着）
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // 排除近黑、近白、灰：这些不携带品牌色信息
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
    // 极端情况：纯灰/单色封面。fallback 到米黄 accent。
    return { seed: "#E85D3A", palette: ["#E85D3A"] };
  }

  // 排序：频次高 → 低
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const seed = sorted[0].hsl;
  const seedHex = hslToHex(seed.h, seed.s, seed.l);

  // 从相近 hue 桶（±2 桶 = ±60°）选 3 个补充色
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

  return { seed: seedHex, palette: [seedHex, ...companions] };
}

/** 把 seed 主色扩展成 6 个角色色，写到 :root CSS 变量。 */
export function applyToCssVars(seed: string): void {
  const { h, s, l } = rgbToHsl(
    parseInt(seed.slice(1, 3), 16),
    parseInt(seed.slice(3, 5), 16),
    parseInt(seed.slice(5, 7), 16),
  );

  const root = document.documentElement;
  root.style.setProperty("--color-bg", hslToHex(h, Math.min(s, 0.6), 0.96));
  root.style.setProperty("--color-card", hslToHex(h, Math.min(s, 0.55), 0.92));
  root.style.setProperty("--color-hover", hslToHex(h, Math.min(s, 0.5), 0.88));
  root.style.setProperty("--color-accent", hslToHex(h, s, Math.max(0.45, Math.min(l, 0.55))));
  root.style.setProperty("--color-text-primary", hslToHex(h, 0.05, 0.22));
  root.style.setProperty("--color-text-secondary", hslToHex(h, 0.05, 0.55));
}

/** 移除所有自定义颜色变量，让 :root 默认值（米黄）生效。 */
export function resetCssVars(): void {
  const root = document.documentElement;
  for (const name of [
    "--color-bg",
    "--color-card",
    "--color-hover",
    "--color-accent",
    "--color-text-primary",
    "--color-text-secondary",
  ]) {
    root.style.removeProperty(name);
  }
}
