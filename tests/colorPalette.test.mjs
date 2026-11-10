// 封面调色板纯函数测试：Worker 与主线程兜底共用同一实现，这里守住
// 过滤规则、主导色选择、辅助色上限与空输入兜底。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function compile(relativePath, replacements = new Map()) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  let compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    fileName: sourceUrl.pathname,
  }).outputText;
  for (const [specifier, replacement] of replacements) {
    compiled = compiled.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  }
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const themeTokensUrl = await compile("../src/utils/themeTokens.ts");
const paletteUrl = await compile(
  "../src/utils/colorPalette.ts",
  new Map([["@/utils/themeTokens", themeTokensUrl]]),
);
const { extractPaletteFromRgba, SAMPLE_SIZE } = await import(paletteUrl);
const { DEFAULT_THEME_SEED, hslToHex, rgbToHsl } = await import(themeTokensUrl);

function rgbaPixels(sampleSize, pixelAt) {
  const data = new Uint8ClampedArray(sampleSize * sampleSize * 4);
  for (let i = 0; i < sampleSize * sampleSize; i += 1) {
    const [r, g, b, a = 255] = pixelAt(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

/** 单色图：所有像素相同，用来单独验证某条过滤规则是否生效。 */
function solidPixels([r, g, b, a = 255]) {
  return rgbaPixels(SAMPLE_SIZE, () => [r, g, b, a]);
}

/** 与实现一致的颜色量化结果：用于断言某个单色会被选为 seed / 辅助色。 */
function hexOf(r, g, b) {
  const hsl = rgbToHsl(r, g, b);
  return hslToHex(hsl.h, hsl.s, hsl.l);
}

test("empty/all-filtered pixels fall back to the default seed", () => {
  const transparent = rgbaPixels(SAMPLE_SIZE, () => [0, 0, 0, 0]);
  const result = extractPaletteFromRgba(transparent);
  assert.equal(result.seed, DEFAULT_THEME_SEED);
  assert.deepEqual(result.palette, [DEFAULT_THEME_SEED]);
});

test("半透明 / 近黑 / 近白 / 低饱和像素都被过滤，纯色图回退默认种子", () => {
  // 每条过滤规则各取一个「只差一点」的样本：若过滤逻辑被删/阈值被放宽，这里会先红。
  const filtered = {
    半透明: [175, 58, 3, 199],
    近黑: [8, 8, 8, 255],
    近白: [250, 250, 250, 255],
    低饱和灰: [80, 73, 69, 255],
  };
  for (const [name, pixel] of Object.entries(filtered)) {
    const result = extractPaletteFromRgba(solidPixels(pixel));
    assert.equal(result.seed, DEFAULT_THEME_SEED, `${name}不应参与聚类`);
    assert.deepEqual(result.palette, [DEFAULT_THEME_SEED], name);
  }
});

test("alpha=200 是接受边界：达到门槛的纯色仍参与聚类", () => {
  // 实现是 `if (a < 200) continue`，199 被过滤、200 必须保留。
  const below = extractPaletteFromRgba(solidPixels([214, 93, 14, 199]));
  assert.equal(below.seed, DEFAULT_THEME_SEED);

  const atBoundary = extractPaletteFromRgba(solidPixels([214, 93, 14, 200]));
  assert.equal(atBoundary.seed, hexOf(214, 93, 14));
  assert.deepEqual(atBoundary.palette, [atBoundary.seed]);
});

test("dominant color becomes seed and second hue bucket becomes companion", () => {
  const data = rgbaPixels(SAMPLE_SIZE, (index) => {
    const hueShift = index % 3;
    // 陶土像素略多于余烬橙（两者分属不同色相桶）；低饱和灰必须被过滤。
    if (hueShift === 0) return [175, 58, 3];
    if (hueShift === 1) return [214, 93, 14];
    return [80, 73, 69];
  });
  const result = extractPaletteFromRgba(data);
  // 像素数最多的色相桶是陶土：它必须成为 seed，而不是先出现的辅助色。
  assert.equal(result.seed, hexOf(175, 58, 3));
  // 第二个高饱和色相桶应被保留为辅助色；低饱和灰不得混进 palette。
  assert.deepEqual(result.palette, [
    hexOf(175, 58, 3),
    hexOf(214, 93, 14),
  ]);
});

test("companions are capped at 3 and deduplicated by hue bucket", () => {
  // 5 个单色各占一个色相桶（红/黄/绿/青/蓝），计数都超过最小面积门槛。
  const colors = [
    [255, 0, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
  ];
  const data = rgbaPixels(SAMPLE_SIZE, (index) => colors[index % colors.length]);
  const result = extractPaletteFromRgba(data);
  assert.equal(result.palette.length, 4); // 1 seed + 3 companions
  assert.equal(new Set(result.palette).size, result.palette.length);
  assert.equal(result.seed, result.palette[0]);
  for (const color of result.palette) assert.match(color, /^#[0-9a-f]{6}$/i);
});

test("same pixels produce identical palettes across runs", () => {
  const data = rgbaPixels(SAMPLE_SIZE, (index) => [index % 200 + 20, 120, 90]);
  const first = extractPaletteFromRgba(data);
  const second = extractPaletteFromRgba(data);
  assert.deepEqual(first, second);
});
