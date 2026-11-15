export const DEFAULT_THEME_SEED = "#af3a03";
export const DEFAULT_DESKTOP_ACCENT = "#d65d0e";

/**
 * 封面换肤只允许改变「光」，不允许夺走品牌身份：UI 强调色的色相必须收敛在
 * 暖色窗口内（陶土≈20°、琥珀≈40°），绿/蓝/紫封面只影响背景与环境光的暖度。
 */
export const COVER_ACCENT_HUE_MIN = 10;
/** 暖色输入窗口的上界（暖金末端）；它是折叠的输入边界，不是输出上界。 */
export const COVER_ACCENT_HUE_MAX = 55;
/** 十六进制量化会让测量 hue 偏移近 0.5°，映射窗口内留 1° 余量。 */
const ACCENT_HUE_MAPPED_MIN = COVER_ACCENT_HUE_MIN + 1;
/**
 * 原样保留的暖色区间上界（陶土≈20°、琥珀≈40°）。40°–55° 的暖金必须连续折回
 * 陶土一侧：暖金/卡其封面（灰阶人像的暖色底、旧唱片纸色）若原样保留，配合下面的
 * 饱和度下限会派生出橄榄棕强调色（实测 #665C19），品牌就读不出「烧陶土」了。
 */
const ACCENT_HUE_KEEP_MAX = 40;
/** 55° 暖金折叠后的落点：仍在陶土/琥珀家族内，但明显偏红。 */
const ACCENT_HUE_FOLD_TOP = 26;
const TERRACOTTA_HUE = 20;
/** 背景/环境光色相向陶土靠拢的比例，保留封面差异但纸面始终暖。 */
const AMBIENT_HUE_PULL = 0.68;
/** 纸面派生的表面参数，必须与 styles.css 的同名公式一致，否则推导会静默
 *  校验一个不再存在的合成面：侧栏是 5% 墨色叠纸色（--color-surface-soft），
 *  行/卡片 hover 是 6% 墨色叠纸色（--color-surface-strong，alpha 的取舍见
 *  accessibleTintedSurface），raised 是卡片纸混白。 */
export const RAISED_NEUTRAL = "#ffffff";
export const RAISED_CARD_WEIGHT = 0.42;
export const SURFACE_SOFT_ALPHA = 0.05;
export const SURFACE_STRONG_ALPHA = 0.06;
/** accent-subtle 洗色的透明度：测试复算合成面时也引用这个单源值。 */
export const ACCENT_SUBTLE_ALPHA = 0.12;
/** 强调色文字叠在 accent-subtle 洗色上的下限（比纸面强调色再留一点渲染余量）。 */
const ACCENT_ON_SUBTLE_MIN_CONTRAST = 4.65;
/**
 * 三级文字（时间、元信息、占位符）在真实合成面上的下限。
 *
 * 与正文同用 4.65：它承载的是 11–12px 的真实信息（播放时间、音质档位、搜索占位符），
 * 不是装饰。封面染色后，`accent-subtle` 洗色（当前歌曲行/激活导航）与双重嵌套的
 * `surface-soft`（侧栏输入框）会比纸面更暗，静态 ash 在这两种面上只剩 4.33–4.46:1；
 * 低于 AA。这里按“真实合成面”推导一个只在需要时略微压暗的三级文字色。
 */
const TEXT_TERTIARY_MIN_CONTRAST = 4.65;
/** 推导下限：比泥炭（secondary）再深就会和二级文字混成同一档。 */
const TEXT_TERTIARY_MIN_LIGHTNESS = 0.28;

export const GRUVBOX_LIGHT_THEME = {
  background: "#fbf1c7",
  backgroundHard: "#f9f5d7",
  backgroundSoft: "#f2e5bc",
  card: "#f9f5d7",
  cardHover: "#ebdbb2",
  // No-Line Rule（DESIGN.md）：边框/描边 token 一律解析为 transparent，
  // 分区只靠表面明度、留白与阴影。旧值 #d5c4a1 既不在调色板里，也没有任何读取点。
  border: "transparent",
  borderStrong: "transparent",
  foreground: "#282828",
  textSecondary: "#504945",
  textTertiary: "#665c54",
} as const;

export const DYNAMIC_THEME_CSS_VARIABLES = [
  "--color-bg",
  "--color-ambient-primary",
  "--color-ambient-secondary",
  "--color-accent",
  "--color-on-accent",
  "--color-accent-secondary",
  "--color-accent-subtle",
  "--color-accent-on-subtle",
  "--color-glow",
  "--color-text-tertiary",
] as const;

export type DynamicThemeVariable =
  (typeof DYNAMIC_THEME_CSS_VARIABLES)[number];

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface DerivedCoverTheme {
  tokens: Record<DynamicThemeVariable, string>;
  uiAccent: string;
  desktopAccent: string;
}

export type CoverPaletteInput = string | readonly string[];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const delta = max - min;
    s = l > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / delta + 2) * 60;
        break;
      default:
        h = ((rn - gn) / delta + 4) * 60;
        break;
    }
  }

  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const normalizedHue = ((h % 360) + 360) % 360;
  const safeSaturation = clamp(s, 0, 1);
  const safeLightness = clamp(l, 0, 1);
  const chroma =
    (1 - Math.abs(2 * safeLightness - 1)) * safeSaturation;
  const huePrime = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (huePrime < 1) {
    r = chroma;
    g = x;
  } else if (huePrime < 2) {
    r = x;
    g = chroma;
  } else if (huePrime < 3) {
    g = chroma;
    b = x;
  } else if (huePrime < 4) {
    g = x;
    b = chroma;
  } else if (huePrime < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const match = safeLightness - chroma / 2;
  const toHex = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseHex(hex: string): HSL {
  const normalized = /^#[\da-f]{6}$/i.test(hex)
    ? hex
    : DEFAULT_THEME_SEED;
  return rgbToHsl(
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  );
}

function normalizePalette(input: CoverPaletteInput): string[] {
  const candidates = typeof input === "string" ? [input] : input;
  const palette: string[] = [];
  const used = new Set<string>();

  for (const candidate of candidates) {
    if (!/^#[\da-f]{6}$/i.test(candidate)) continue;
    const normalized = candidate.toLowerCase();
    if (used.has(normalized)) continue;
    used.add(normalized);
    palette.push(normalized);
    if (palette.length >= 4) break;
  }

  return palette.length > 0 ? palette : [DEFAULT_THEME_SEED];
}

function hexChannels(hex: string): [number, number, number] {
  const normalized = /^#[\da-f]{6}$/i.test(hex)
    ? hex
    : DEFAULT_THEME_SEED;
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function mixHex(base: string, tint: string, amount: number): string {
  const baseChannels = hexChannels(base);
  const tintChannels = hexChannels(tint);
  const weight = clamp(amount, 0, 1);
  const channels = baseChannels.map((value, index) =>
    Math.round(value + (tintChannels[index] - value) * weight),
  );
  return `#${channels
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function relativeLuminance(hex: string): number {
  const channels = hexChannels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
}

export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function foregroundFor(background: string): string {
  const dark = GRUVBOX_LIGHT_THEME.foreground;
  const light = GRUVBOX_LIGHT_THEME.background;
  return contrastRatio(background, dark) >= contrastRatio(background, light)
    ? dark
    : light;
}

function accessibleDarkAccent(
  h: number,
  s: number,
  initialLightness: number,
  surfaces: string[],
): { color: string; lightness: number } {
  let lightness = clamp(initialLightness, 0.24, 0.44);
  let color = hslToHex(h, s, lightness);
  while (
    surfaces.some((surface) => contrastRatio(color, surface) < 4.6) &&
    lightness > 0.16
  ) {
    lightness = Math.max(0.16, lightness - 0.01);
    color = hslToHex(h, s, lightness);
  }
  return { color, lightness };
}

const THEME_TEXT_COLORS = [
  GRUVBOX_LIGHT_THEME.foreground,
  GRUVBOX_LIGHT_THEME.textSecondary,
  GRUVBOX_LIGHT_THEME.textTertiary,
] as const;
const TINTED_SURFACE_MIN_CONTRAST = 4.65;

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

/**
 * 把封面色相连续折叠进暖色窗口：10°–40° 的暖色原样保留（陶土≈20°、琥珀≈40°），
 * 40°–55° 的暖金连续折回陶土一侧（52° ≈ 29°），窗口外的冷色圆弧压缩到
 * [11°, 26°]，因此绿/蓝/紫/暖金封面都只能改变暖度与深浅，不能取代品牌色相；
 * 三段在 11°、40°、55° 处都连续，所以切歌仍有可见变化。
 */
function warmHue(rawHue: number): number {
  const hue = normalizeHue(rawHue);
  if (hue >= ACCENT_HUE_MAPPED_MIN && hue <= ACCENT_HUE_KEEP_MAX) {
    return hue;
  }
  if (hue > ACCENT_HUE_KEEP_MAX && hue < COVER_ACCENT_HUE_MAX) {
    const position =
      (hue - ACCENT_HUE_KEEP_MAX) /
      (COVER_ACCENT_HUE_MAX - ACCENT_HUE_KEEP_MAX);
    return (
      ACCENT_HUE_KEEP_MAX +
      (ACCENT_HUE_FOLD_TOP - ACCENT_HUE_KEEP_MAX) * position
    );
  }
  const coldSpan = ACCENT_HUE_FOLD_TOP - ACCENT_HUE_MAPPED_MIN;
  const coldArc = 360 - (COVER_ACCENT_HUE_MAX - ACCENT_HUE_MAPPED_MIN);
  const position =
    hue > ACCENT_HUE_KEEP_MAX
      ? hue - COVER_ACCENT_HUE_MAX
      : hue + 360 - COVER_ACCENT_HUE_MAX;
  return ACCENT_HUE_FOLD_TOP - (coldSpan * position) / coldArc;
}

/** 背景/环境光色相：先折叠进暖色窗口，再向陶土色相拉近，纸面永远带暖。 */
function ambientHue(rawHue: number): number {
  const hue = warmHue(rawHue);
  return hue + (TERRACOTTA_HUE - hue) * AMBIENT_HUE_PULL;
}

function ambientTint(color: HSL): string {
  return hslToHex(
    ambientHue(color.h),
    clamp(color.s * 0.72 + 0.12, 0.2, 0.58),
    0.55,
  );
}

function ambientStrength(color: HSL, offset = 0): number {
  return 0.08 + clamp(color.s, 0, 0.8) * 0.1 + offset;
}

/**
 * 背景染色要同时守住纸面、纸面上的侧栏（surface-soft 叠纸色）与行/卡片 hover
 * 面（surface-strong 叠纸色）：侧栏叠 5% 墨色、hover 面叠 6% 墨色，三级正文与
 * 强调色都真正落座在后者上。染色按这几层里较暗的一层校验，下限 4.65:1 吸收
 * 十六进制量化与渲染的小幅亮度波动。
 *
 * hover 面的 6% 是刻意取舍：纸面改为封面染色纸（f48b16b）后，9% 的 hover 面
 * 会把可读染色压到最大通道差仅 6/255（均值 5.2），封面染色基本不可见；6% 仍保证
 * hover 上三级正文 ≥4.65:1、强调色/次强调色 ≥4.6:1，同时把染色保留在
 * 15/255 左右（v0.5.3 基线 18/255 的约 83%，均值 12.4 对基线 13.9）。
 * 这两个 alpha 必须与 styles.css 的 surface-soft / surface-strong 公式同步。
 */
function accessibleTintedSurface(
  base: string,
  tint: string,
  initialStrength: number,
): string {
  let strength = clamp(initialStrength, 0, 1);
  let color = mixHex(base, tint, strength);
  const inkOverlay = (value: string, alpha: number) =>
    mixHex(value, GRUVBOX_LIGHT_THEME.foreground, alpha);
  const paintedSurfaces = (value: string) => [
    value,
    inkOverlay(value, SURFACE_SOFT_ALPHA),
    inkOverlay(value, SURFACE_STRONG_ALPHA),
  ];

  while (
    paintedSurfaces(color).some((surface) =>
      THEME_TEXT_COLORS.some(
        (textColor) =>
          contrastRatio(textColor, surface) < TINTED_SURFACE_MIN_CONTRAST,
      ),
    ) &&
    strength > 0
  ) {
    strength = Math.max(0, strength - 0.005);
    color = mixHex(base, tint, strength);
  }

  return color;
}

/**
 * accent-subtle 是 12% 的透明洗色，真实底色由它叠在下面的派生面上决定：
 * 侧栏 = surface-soft 叠纸色，窄窗侧栏浮层 = --color-bg，队列徽标 = 叠两次的
 * raised 纸面。这里按 styles.css 的公式复算这几种合成色，供下限推导逐个校验。
 */
function accentSubtleBackdrops(
  background: string,
  accent: string,
): string[] {
  const wash = (base: string, layers = 1): string => {
    let color = base;
    for (let layer = 0; layer < layers; layer += 1) {
      color = mixHex(color, accent, ACCENT_SUBTLE_ALPHA);
    }
    return color;
  };
  const surfaceSoft = mixHex(
    background,
    GRUVBOX_LIGHT_THEME.foreground,
    SURFACE_SOFT_ALPHA,
  );
  const raised = mixHex(
    RAISED_NEUTRAL,
    GRUVBOX_LIGHT_THEME.card,
    RAISED_CARD_WEIGHT,
  );

  return [
    wash(surfaceSoft),
    wash(background),
    wash(raised, 2),
  ];
}

/**
 * 叠在 accent-subtle 洗色上的强调色文字：沿用强调色的色相与饱和度，只压暗
 * 明度直到对所有真实洗色底都满足下限，保住“深陶土”的品牌声线，不换成正文墨色。
 */
function accessibleAccentOnSubtle(
  h: number,
  s: number,
  initialLightness: number,
  backdrops: string[],
): string {
  let lightness = clamp(initialLightness, 0.16, 0.44);
  let color = hslToHex(h, s, lightness);
  while (
    backdrops.some(
      (backdrop) =>
        contrastRatio(color, backdrop) < ACCENT_ON_SUBTLE_MIN_CONTRAST,
    ) &&
    lightness > 0.16
  ) {
    lightness = Math.max(0.16, lightness - 0.01);
    color = hslToHex(h, s, lightness);
  }
  return color;
}

/**
 * 三级文字真正落座的合成面。
 *
 * 只列 CSS 实际绘制的表面（`--color-bg` 的全窗纸底是唯一底）：侧栏 = surface-soft
 * 叠纸；侧栏搜索框再叠一层 surface-soft（双重嵌套）；行/卡片 hover = surface-strong
 * 叠纸；accent-subtle 洗色落在当前歌曲行（洗色叠纸）、激活导航（洗色叠侧栏）、
 * 队列“播放中”徽标（洗色叠两层 raised）；歌词卡/弹层是 raised 纸面。
 * 旧的三档纸面渐变（bg-from/bg-to）已不再绘制，因此不再参与这组下限推导。
 */
function tertiaryTextBackdrops(background: string, accent: string): string[] {
  const inkOverlay = (value: string, alpha: number) =>
    mixHex(value, GRUVBOX_LIGHT_THEME.foreground, alpha);
  const wash = (base: string, layers = 1): string => {
    let color = base;
    for (let layer = 0; layer < layers; layer += 1) {
      color = mixHex(color, accent, ACCENT_SUBTLE_ALPHA);
    }
    return color;
  };
  const sidebar = inkOverlay(background, SURFACE_SOFT_ALPHA);
  const sidebarInput = inkOverlay(sidebar, SURFACE_SOFT_ALPHA);
  const strong = inkOverlay(background, SURFACE_STRONG_ALPHA);
  const raised = mixHex(
    RAISED_NEUTRAL,
    GRUVBOX_LIGHT_THEME.card,
    RAISED_CARD_WEIGHT,
  );

  return [
    background,
    sidebar,
    sidebarInput,
    strong,
    wash(background),
    wash(sidebar),
    wash(strong),
    wash(raised, 2),
    GRUVBOX_LIGHT_THEME.card,
    GRUVBOX_LIGHT_THEME.cardHover,
  ];
}

/**
 * 只压暗明度、保持 ash 的色相与低饱和度：默认纸面上仍是 DESIGN 记录的 #665c54，
 * 只有真实合成面更暗时才向下让一小步，保住三级文字的“安静”性格。
 */
function accessibleTextTertiary(backdrops: string[]): string {
  const { h, s, l } = parseHex(GRUVBOX_LIGHT_THEME.textTertiary);
  let lightness = l;
  let color = hslToHex(h, s, lightness);
  while (
    backdrops.some(
      (backdrop) =>
        contrastRatio(color, backdrop) < TEXT_TERTIARY_MIN_CONTRAST,
    ) &&
    lightness > TEXT_TERTIARY_MIN_LIGHTNESS
  ) {
    lightness = Math.max(TEXT_TERTIARY_MIN_LIGHTNESS, lightness - 0.005);
    color = hslToHex(h, s, lightness);
  }
  return color;
}

/**
 * 将封面原色映射到浅色主题：结构色保持 Gruvbox Light，只让背景色温和
 * 强调色随封面变化。背景/环境光的 hue 向陶土拉近，强调色 hue 收进 10°–40°
 * 的暖色区间（40°–55° 的暖金折回陶土一侧），因此切歌仍有可见反馈，品牌却始终
 * 是暖陶土而不是封面主色。
 */
export function deriveCoverTheme(input: CoverPaletteInput): DerivedCoverTheme {
  const palette = normalizePalette(input);
  const primary = parseHex(palette[0]);
  const companions = palette
    .slice(1)
    .map(parseHex)
    .filter((color) => hueDistance(color.h, primary.h) >= 18);
  const analogousColor = (offset: number): HSL => ({
    h: (primary.h + offset + 360) % 360,
    s: primary.s,
    l: primary.l,
  });
  const backgroundFromSource = companions[0] ?? analogousColor(24);
  const backgroundToSource = companions[1] ?? analogousColor(-24);
  const ambientPrimary = hslToHex(
    ambientHue(backgroundFromSource.h),
    clamp(backgroundFromSource.s * 0.94 + 0.14, 0.42, 0.74),
    0.5,
  );
  const ambientSecondary = hslToHex(
    ambientHue(backgroundToSource.h),
    clamp(backgroundToSource.s * 0.94 + 0.14, 0.42, 0.74),
    0.5,
  );

  const background = accessibleTintedSurface(
    GRUVBOX_LIGHT_THEME.background,
    ambientTint(primary),
    ambientStrength(primary),
  );
  // 染色区间的两端只用于校验强调色/正文下限：CSS 已不再绘制三档纸面渐变，
  // 但它们代表染色的最亮/最暗范围，保留进下限循环可以保证任何染色结果都可读。
  const backgroundFrom = accessibleTintedSurface(
    GRUVBOX_LIGHT_THEME.backgroundHard,
    ambientTint(backgroundFromSource),
    ambientStrength(backgroundFromSource, 0.04),
  );
  const backgroundTo = accessibleTintedSurface(
    GRUVBOX_LIGHT_THEME.backgroundSoft,
    ambientTint(backgroundToSource),
    ambientStrength(backgroundToSource, 0.025),
  );

  const { h, s, l } = primary;
  const accentHue = warmHue(h);
  // 饱和度下限压过灰化封面的橄榄偏色：冷/灰封面也要读成「深陶土」而不是橄榄棕。
  // 暖金封面（40°–55°）的色相已在上一步折回陶土一侧，因此下限不会再把它推成橄榄。
  const accentSaturation = clamp(s * 1.08 + 0.18, 0.6, 0.76);
  const accentSurfaces = [
    background,
    // 侧栏（surface-soft 叠纸色）是激活导航/播放中图标落座的表面，也参与下限。
    mixHex(background, GRUVBOX_LIGHT_THEME.foreground, SURFACE_SOFT_ALPHA),
    // 行/卡片 hover（surface-strong 叠纸色）上歌名会切成强调色，是更暗的一面。
    mixHex(background, GRUVBOX_LIGHT_THEME.foreground, SURFACE_STRONG_ALPHA),
    backgroundFrom,
    backgroundTo,
    GRUVBOX_LIGHT_THEME.card,
    GRUVBOX_LIGHT_THEME.cardHover,
  ];
  const { color: accent, lightness: accentLightness } = accessibleDarkAccent(
    accentHue,
    accentSaturation,
    clamp(l * 0.72, 0.32, 0.42),
    accentSurfaces,
  );
  const { color: accentSecondary } = accessibleDarkAccent(
    warmHue(h + 8),
    clamp(accentSaturation * 0.9, 0.44, 0.68),
    Math.min(0.44, accentLightness + 0.08),
    accentSurfaces,
  );
  const accentOnSubtle = accessibleAccentOnSubtle(
    accentHue,
    accentSaturation,
    accentLightness,
    accentSubtleBackdrops(background, accent),
  );
  const desktopAccent = hslToHex(
    accentHue,
    clamp(s * 1.06 + 0.2, 0.58, 0.82),
    0.58,
  );
  // 三级文字按“它真正落座的合成面”推导，而不是按纸面本体：洗色/嵌套透明层
  // 比纸面更暗，静态 ash 在染色状态下会跌破 AA（评审 P1）。
  const textTertiary = accessibleTextTertiary(
    tertiaryTextBackdrops(background, accent),
  );

  return {
    tokens: {
      "--color-bg": background,
      "--color-ambient-primary": ambientPrimary,
      "--color-ambient-secondary": ambientSecondary,
      "--color-accent": accent,
      "--color-on-accent": foregroundFor(accent),
      "--color-accent-secondary": accentSecondary,
      "--color-accent-subtle": hexToRgba(accent, ACCENT_SUBTLE_ALPHA),
      "--color-accent-on-subtle": accentOnSubtle,
      "--color-glow": hexToRgba(accent, 0.22),
      "--color-text-tertiary": textTertiary,
    },
    uiAccent: accent,
    desktopAccent,
  };
}
