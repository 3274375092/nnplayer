import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/utils/themeTokens.ts", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const theme = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const {
  DEFAULT_THEME_SEED,
  DYNAMIC_THEME_CSS_VARIABLES,
  GRUVBOX_LIGHT_THEME,
  RAISED_CARD_WEIGHT,
  RAISED_NEUTRAL,
  SURFACE_SOFT_ALPHA,
  SURFACE_STRONG_ALPHA,
  contrastRatio,
  deriveCoverTheme,
  hslToHex,
  rgbToHsl,
} = theme;

async function readSourceTree(directory) {
  const chunks = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(
      `${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory()) {
      chunks.push(...(await readSourceTree(child)));
    } else if (/\.(?:css|ts|vue)$/.test(entry.name)) {
      chunks.push({ path: child.pathname, text: await readFile(child, "utf8") });
    }
  }
  return chunks;
}

function mixHex(base, tint, amount) {
  const channels = (hex) =>
    hex
      .slice(1)
      .match(/../g)
      .map((value) => Number.parseInt(value, 16));
  const baseChannels = channels(base);
  const tintChannels = channels(tint);
  return `#${baseChannels
    .map((value, index) =>
      Math.round(value + (tintChannels[index] - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function hexToHsl(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16));
  return rgbToHsl(...channels);
}

function hueDistance(a, b) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

/**
 * 封面换肤允许的强调色相窗口：10°–40° 的暖色原样保留（陶土≈20°、琥珀≈40°），
 * 40°–55° 的暖金连续折回陶土一侧（52° ≈ 29°），冷色圆弧压到 11°–26°。
 * 输出窗口因此是 10°–40°，断言留到 42° 吸收十六进制量化的 ±0.5° 偏移。
 */
const ACCENT_HUE_MIN = 10;
const ACCENT_HUE_MAX = 42;
/** 暖色输入上界（暖金末端）：只用于静态环境光兜底的"必须暖"断言。 */
const WARM_INPUT_HUE_MAX = 55;
/** 暖金折回后的落点下限：40°–55° 的封面必须仍落在琥珀/陶土家族内。 */
const ACCENT_GOLD_FOLD_MIN = 26;

/**
 * DESIGN 记录的派生下限：强调色对纸面 ≥4.6:1，正文/洗色上的文字 ≥4.65:1。
 * 实现（themeTokens.ts）已按这两个下限推导，测试此前只断言 4.5，比系统更松。
 */
const ACCENT_MIN_CONTRAST = 4.6;
const BODY_MIN_CONTRAST = 4.65;
/** 静态首屏默认（无封面主题）的 accent-subtle 文字色，须与 styles.css 同步。 */
const STATIC_ACCENT_ON_SUBTLE = "#a03503";

function hexChannels(hex) {
  return hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16));
}

function assertWarmHue(
  hex,
  label,
  min = ACCENT_HUE_MIN,
  max = ACCENT_HUE_MAX,
) {
  const { h } = hexToHsl(hex);
  assert.ok(
    h >= min && h <= max,
    `${label}: ${hex} hue ${h.toFixed(1)}° must stay inside the warm ${min}–${max}° window`,
  );
}

/**
 * 橄榄/卡其强调色是这次修复的对象：hue 已越过 44° 的绿金区间，且饱和度被
 * 下限顶到 ≥0.60（实测 #665C19 = hsl(52.2, 0.61, 0.25)）。两个条件同时成立
 * 即为"读不出烧陶土"的回归。
 */
function assertNotOlive(hex, label) {
  const { h, s } = hexToHsl(hex);
  assert.ok(
    !(h > 44 && s >= 0.5),
    `${label}: ${hex} hsl(${h.toFixed(1)}, ${s.toFixed(2)}) is an olive/khaki accent, not terracotta`,
  );
  assert.ok(
    h <= 44,
    `${label}: ${hex} hue ${h.toFixed(1)}° must stay on the terracotta side of 44°`,
  );
}


function assertWarmPaper(hex, label) {
  const [r, g, b] = hexChannels(hex);
  assert.ok(
    r > g && g > b,
    `${label}: ${hex} must remain warm paper (expected red > green > blue, got ${r}/${g}/${b})`,
  );
}

/**
 * 应用真实绘制的纸面：页面与侧栏都以 `--color-bg` 为底（styles.css / App.vue），
 * 侧栏再叠 surface-soft 墨色，行/卡片 hover 再叠 surface-strong 墨色，raised
 * 由卡片纸混白。三档背景渐变（bg-from/bg-to）与中层 canvas 都已从 CSS 与 token
 * 层移除，这里校验的是真正绘制的表面；alpha 直接取自主题模块的导出常量，
 * 保证测试复算与推导用的是同一份单源值。
 */
function paintedPaperSurfaces(background) {
  const surfaceSoft = mixHex(
    background,
    GRUVBOX_LIGHT_THEME.foreground,
    SURFACE_SOFT_ALPHA,
  );
  const surfaceStrong = mixHex(
    background,
    GRUVBOX_LIGHT_THEME.foreground,
    SURFACE_STRONG_ALPHA,
  );
  const raised = mixHex(
    RAISED_NEUTRAL,
    GRUVBOX_LIGHT_THEME.card,
    RAISED_CARD_WEIGHT,
  );
  return {
    background,
    sidebar: surfaceSoft,
    strong: surfaceStrong,
    card: GRUVBOX_LIGHT_THEME.card,
    cardHover: GRUVBOX_LIGHT_THEME.cardHover,
    raised,
  };
}

/**
 * 复算 accent-subtle 洗色在真实渲染里的合成色：accent-subtle 是 12% 透明层，
 * 侧栏 = surface-soft 叠纸色，窄窗侧栏浮层 = 纸色，队列徽标 = 叠两次的 raised。
 * 公式与 styles.css 的派生面一致；测试独立复算，避免推导自证。
 */
function accentSubtleBackdrops({
  background,
  accent,
  card = GRUVBOX_LIGHT_THEME.card,
}) {
  const wash = (base, layers = 1) => {
    let color = base;
    for (let layer = 0; layer < layers; layer += 1) {
      color = mixHex(color, accent, 0.12);
    }
    return color;
  };
  const surfaces = paintedPaperSurfaces(background);
  const raised = mixHex(RAISED_NEUTRAL, card, RAISED_CARD_WEIGHT);
  return {
    sidebar: wash(surfaces.sidebar),
    overlaySidebar: wash(background),
    queueBadge: wash(raised, 2),
    raised,
  };
}

function assertThemeReadable(derived, label) {
  const background = derived.tokens["--color-bg"];
  const surfaces = paintedPaperSurfaces(background);
  const accent = derived.tokens["--color-accent"];
  const accentSecondary = derived.tokens["--color-accent-secondary"];
  const onAccent = derived.tokens["--color-on-accent"];
  const accentOnSubtle = derived.tokens["--color-accent-on-subtle"];
  const backdrops = accentSubtleBackdrops({
    background,
    accent,
  });

  for (const [name, surface] of Object.entries(surfaces)) {
    assert.ok(
      contrastRatio(accent, surface) >= ACCENT_MIN_CONTRAST,
      `${label}: accent ${accent} is not readable on the ${name} surface ${surface}`,
    );
    assert.ok(
      contrastRatio(accentSecondary, surface) >= ACCENT_MIN_CONTRAST,
      `${label}: secondary accent ${accentSecondary} is not visible on the ${name} surface ${surface}`,
    );
    for (const textColor of [
      GRUVBOX_LIGHT_THEME.foreground,
      GRUVBOX_LIGHT_THEME.textSecondary,
      GRUVBOX_LIGHT_THEME.textTertiary,
    ]) {
      assert.ok(
        contrastRatio(textColor, surface) >= BODY_MIN_CONTRAST,
        `${label}: text ${textColor} is not readable on the ${name} surface ${surface}`,
      );
    }
  }
  assert.ok(
    contrastRatio(onAccent, accent) >= ACCENT_MIN_CONTRAST,
    `${label}: on-accent ${onAccent} is not readable on ${accent}`,
  );
  // 激活导航与队列徽标：强调色文字叠在 accent-subtle 洗色上，必须对每种真实洗色底达标。
  assert.match(
    accentOnSubtle,
    /^#[\da-f]{6}$/i,
    `${label}: accent-on-subtle must be a hex color, got ${accentOnSubtle}`,
  );
  for (const [name, backdrop] of Object.entries(backdrops)) {
    if (name === "raised") continue;
    assert.ok(
      contrastRatio(accentOnSubtle, backdrop) >= ACCENT_MIN_CONTRAST,
      `${label}: accent-on-subtle ${accentOnSubtle} is not readable on the ${name} wash ${backdrop}`,
    );
  }

  for (const surface of [
    background,
    surfaces.sidebar,
    GRUVBOX_LIGHT_THEME.card,
  ]) {
    const subtleSurface = mixHex(surface, accent, 0.12);
    assert.ok(
      contrastRatio(GRUVBOX_LIGHT_THEME.foreground, subtleSurface) >=
        BODY_MIN_CONTRAST,
      `${label}: primary text is not readable on subtle accent surface ${subtleSurface}`,
    );
  }
}

test("Gruvbox Light defaults keep all text tiers readable", () => {
  assert.equal(DEFAULT_THEME_SEED, "#af3a03");
  for (const surface of [
    GRUVBOX_LIGHT_THEME.background,
    GRUVBOX_LIGHT_THEME.backgroundHard,
    GRUVBOX_LIGHT_THEME.backgroundSoft,
    GRUVBOX_LIGHT_THEME.card,
    GRUVBOX_LIGHT_THEME.cardHover,
  ]) {
    for (const textColor of [
      GRUVBOX_LIGHT_THEME.foreground,
      GRUVBOX_LIGHT_THEME.textSecondary,
      GRUVBOX_LIGHT_THEME.textTertiary,
    ]) {
      assert.ok(
        contrastRatio(textColor, surface) >= BODY_MIN_CONTRAST,
        `${textColor} must remain readable on the default surface ${surface}`,
      );
    }
  }

  // 首屏静态默认（无封面主题）同样要满足洗色上的强调色下限。
  const staticBackdrops = accentSubtleBackdrops({
    background: GRUVBOX_LIGHT_THEME.background,
    accent: DEFAULT_THEME_SEED,
  });
  for (const name of ["sidebar", "overlaySidebar", "queueBadge"]) {
    assert.ok(
      contrastRatio(STATIC_ACCENT_ON_SUBTLE, staticBackdrops[name]) >=
        ACCENT_MIN_CONTRAST,
      `static accent-on-subtle ${STATIC_ACCENT_ON_SUBTLE} is not readable on the ${name} wash ${staticBackdrops[name]}`,
    );
  }
});

test("CSS defaults stay synchronized with the Gruvbox token source", () => {
  const expected = {
    "--color-bg": GRUVBOX_LIGHT_THEME.background,
    "--color-ambient-primary": "#d79921",
    "--color-ambient-secondary": "#a95823",
    "--color-card": GRUVBOX_LIGHT_THEME.card,
    "--color-card-hover": GRUVBOX_LIGHT_THEME.cardHover,
    "--color-border": "transparent",
    "--color-border-strong": "transparent",
    "--color-accent": DEFAULT_THEME_SEED,
    "--color-on-accent": GRUVBOX_LIGHT_THEME.background,
    "--color-accent-secondary": "#d65d0e",
    "--color-accent-subtle": "rgba(175, 58, 3, 0.12)",
    "--color-accent-on-subtle": STATIC_ACCENT_ON_SUBTLE,
    "--color-text-primary": GRUVBOX_LIGHT_THEME.foreground,
    "--color-text-secondary": GRUVBOX_LIGHT_THEME.textSecondary,
    "--color-text-tertiary": GRUVBOX_LIGHT_THEME.textTertiary,
    "--color-glow": "rgba(175, 58, 3, 0.14)",
  };
  for (const name of DYNAMIC_THEME_CSS_VARIABLES) {
    assert.ok(name in expected, `${name} needs an explicit default CSS token`);
  }
  const escapeRegExp = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [name, value] of Object.entries(expected)) {
    assert.match(
      styles,
      new RegExp(`${escapeRegExp(name)}:\\s*${escapeRegExp(value)};`, "i"),
      `${name} must match the shared Gruvbox default`,
    );
  }
  // 无封面时的静态兜底光也必须是暖色：登录页不允许出现冷青/冷蓝光晕。
  for (const ambient of [
    expected["--color-ambient-primary"],
    expected["--color-ambient-secondary"],
  ]) {
    assertWarmHue(ambient, "static ambient default", ACCENT_HUE_MIN, WARM_INPUT_HUE_MAX);
  }
});

test("CSS derived surfaces stay single-sourced from themeTokens.ts", async () => {
  // 这些常量让推导复算 styles.css 的合成面；只改一边时推导会静默校验一个
  // 不再存在的表面（v0.5.1 的 canvas 单源守卫被删后的回退），这里反向锁住公式。
  const app = await readFile(
    new URL("../src/App.vue", import.meta.url),
    "utf8",
  );
  const assertAlphaUnit = (constant, label) =>
    assert.ok(
      Number.isFinite(constant) && constant > 0 && constant < 1,
      `${label} must stay a positive alpha below 1`,
    );

  assertAlphaUnit(SURFACE_SOFT_ALPHA, "SURFACE_SOFT_ALPHA");
  assertAlphaUnit(SURFACE_STRONG_ALPHA, "SURFACE_STRONG_ALPHA");
  assertAlphaUnit(RAISED_CARD_WEIGHT, "RAISED_CARD_WEIGHT");

  const surfaceSoft = styles.match(
    /--color-surface-soft:\s*color-mix\(in srgb,\s*var\(--color-text-primary\)\s+(\d+(?:\.\d+)?)%,\s*transparent\)/,
  );
  assert.ok(
    surfaceSoft,
    "styles.css must derive --color-surface-soft from var(--color-text-primary)",
  );
  assert.equal(
    Number(surfaceSoft[1]) / 100,
    SURFACE_SOFT_ALPHA,
    "--color-surface-soft must use the SURFACE_SOFT_ALPHA ink mix",
  );

  const surfaceStrong = styles.match(
    /--color-surface-strong:\s*color-mix\(in srgb,\s*var\(--color-text-primary\)\s+(\d+(?:\.\d+)?)%,\s*transparent\)/,
  );
  assert.ok(
    surfaceStrong,
    "styles.css must derive --color-surface-strong from var(--color-text-primary)",
  );
  assert.equal(
    Number(surfaceStrong[1]) / 100,
    SURFACE_STRONG_ALPHA,
    "--color-surface-strong must use the SURFACE_STRONG_ALPHA ink mix",
  );

  const raised = styles.match(
    /--color-raised:\s*color-mix\(in srgb,\s*var\(--color-card\)\s+(\d+(?:\.\d+)?)%,\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\)/i,
  );
  assert.ok(
    raised,
    "styles.css must derive --color-raised from var(--color-card) mixed with white",
  );
  assert.equal(
    Number(raised[1]) / 100,
    RAISED_CARD_WEIGHT,
    "--color-raised must use the RAISED_CARD_WEIGHT card mix",
  );
  const expandHex = (hex) =>
    hex.length === 4
      ? `#${hex
          .slice(1)
          .split("")
          .map((channel) => channel + channel)
          .join("")}`
      : hex;
  assert.equal(
    expandHex(raised[2]).toLowerCase(),
    RAISED_NEUTRAL.toLowerCase(),
    "--color-raised must mix toward the RAISED_NEUTRAL white",
  );

  // 中层 canvas 已从绘制链移除：若样式或组件重新引入，纸面单源会再次分叉。
  const tree = await readSourceTree(new URL("../src/", import.meta.url));
  for (const file of tree) {
    assert.ok(
      !file.text.includes("--color-canvas"),
      `${file.path} must not reference the removed --color-canvas token`,
    );
  }
  // 纸底只由 --color-bg 绘制：窗口（body）与主题根（.theme-root）必须同步染同一张纸。
  assert.match(
    styles,
    /body\s*\{[^}]*background:\s*var\(--color-bg\)\s*;/,
    "body must paint the themed paper with var(--color-bg)",
  );
  assert.match(
    app,
    /\.theme-root\s*\{[^}]*background:\s*var\(--color-bg\)\s*;/,
    ".theme-root must paint the themed paper with var(--color-bg)",
  );
});

test("dead theme tokens are gone from the dynamic write path", () => {
  // styles.css 已删除这些声明；写路径也必须停止写它们，否则每次换歌都会
  // 重新注入一个没有消费者的变量（旧的 --color-ring 还是可见的 28% 描边色）。
  const dead = [
    "--color-bg-from",
    "--color-bg-to",
    "--color-ring",
    "--color-highlight",
    "--color-shadow",
  ];
  for (const name of dead) {
    assert.ok(
      !DYNAMIC_THEME_CSS_VARIABLES.includes(name),
      `${name} must not be in DYNAMIC_THEME_CSS_VARIABLES`,
    );
  }
  const derived = deriveCoverTheme(DEFAULT_THEME_SEED);
  for (const name of dead) {
    assert.ok(
      !(name in derived.tokens),
      `${name} must not be written by deriveCoverTheme`,
    );
  }
  // matches 是完整的 token 名，避免误伤 --color-bg 这类前缀相同的活 token。
  for (const name of ["--color-bg-from", "--color-bg-to", "--color-ring"]) {
    assert.ok(
      !new RegExp(`"${name}"`).test(source),
      `themeTokens.ts must not mention the retired token ${name}`,
    );
  }
});

test("tailwind exposes the compositor-only playback animations and no black shadows", () => {
  // 跨文件契约（FIX-CONTEXT #1/#38）：A/B 用 animate-play-ring / animate-pulse-fade；
  // 纸面阴影只允许 Raised/Floating（styles.css 的 --shadow-*），不再提供 Tailwind
  // 默认黑色投影条目。
  const config = readFileSync(
    new URL("../tailwind.config.js", import.meta.url),
    "utf8",
  );
  assert.match(
    config,
    /"play-ring":\s*\{\s*"0%":\s*\{\s*transform:\s*"scale\(0\.85\)",\s*opacity:\s*"0\.5"\s*\},\s*"75%,\s*100%":\s*\{\s*transform:\s*"scale\(1\.6\)",\s*opacity:\s*"0"\s*\}/,
    "tailwind.config.js must define the play-ring keyframes (transform/opacity only)",
  );
  assert.match(
    config,
    /"play-ring":\s*"play-ring 2s ease-out infinite"/,
    "tailwind.config.js must expose animation.play-ring",
  );
  assert.match(
    config,
    /"pulse-fade":\s*\{\s*"0%,\s*100%":\s*\{\s*opacity:\s*"1"\s*\},\s*"50%":\s*\{\s*opacity:\s*"0\.35"\s*\}\s*,\s*\}/,
    "tailwind.config.js must define the pulse-fade keyframes (opacity only)",
  );
  assert.match(
    config,
    /"pulse-fade":\s*"pulse-fade 2s ease-in-out infinite"/,
    "tailwind.config.js must expose animation.pulse-fade",
  );
  // Two-Shadow Rule：不再提供 Tailwind 的 boxShadow 比例尺，也不允许黑色投影字面量
  // （旧 soft 是纯黑投影；旧的 play-pulse keyframe 也在迁移到 play-ring 后删除）。
  assert.ok(
    !/boxShadow\s*:/.test(config),
    "tailwind.config.js must not define any boxShadow outside the Raised/Floating tokens",
  );
  assert.ok(
    !/rgba\(0,\s*0,\s*0/.test(config.toLowerCase()),
    "tailwind.config.js must not embed a black drop shadow",
  );
});


test("cover-derived light themes remain readable across the color wheel", () => {
  for (let hue = 0; hue < 360; hue += 3) {
    for (const saturation of [0.12, 0.5, 0.9]) {
      for (const lightness of [0.2, 0.5, 0.8]) {
        const seed = hslToHex(hue, saturation, lightness);
        const derived = deriveCoverTheme(seed);
        assertThemeReadable(derived, seed);
      }
    }
  }
});

test("multi-color cover palettes vary ambient roles without adding a second UI accent", () => {
  const primary = "#458588";
  const mono = deriveCoverTheme(primary);
  const violetGold = deriveCoverTheme([primary, "#b16286", "#d79921"]);
  const greenRed = deriveCoverTheme([primary, "#689d6a", "#cc241d"]);

  assert.equal(
    mono.tokens["--color-bg"],
    violetGold.tokens["--color-bg"],
    "the primary background role must continue to follow the dominant color",
  );
  const primaryAccentHue = hexToHsl(mono.tokens["--color-accent"]).h;
  for (const derived of [violetGold, greenRed]) {
    assert.ok(
      hueDistance(
        primaryAccentHue,
        hexToHsl(derived.tokens["--color-accent"]).h,
      ) <= 1,
      "ambient companions must not change the primary UI accent hue",
    );
  }
  // 多色封面的角色分工只体现在环境光上：背景主色仍跟主导色，两端环境光可变。
  for (const token of [
    "--color-ambient-primary",
    "--color-ambient-secondary",
  ]) {
    assert.notEqual(violetGold.tokens[token], mono.tokens[token]);
    assert.notEqual(violetGold.tokens[token], greenRed.tokens[token]);
  }
  // 背景主色只跟主导色（companions 只影响环境光），不同主导色仍必须染出不同纸面。
  assert.notEqual(
    mono.tokens["--color-bg"],
    deriveCoverTheme("#689d6a").tokens["--color-bg"],
    "different dominant covers must still tint the paper differently",
  );

  for (const derived of [violetGold, greenRed]) {
    const accentHue = hexToHsl(derived.tokens["--color-accent"]).h;
    const secondaryHue = hexToHsl(
      derived.tokens["--color-accent-secondary"],
    ).h;
    assert.ok(
      hueDistance(accentHue, secondaryHue) <= 10,
      "interactive accent gradients must stay in one hue family",
    );
  }

  assertThemeReadable(violetGold, "violet/gold palette");
  assertThemeReadable(greenRed, "green/red palette");
});

test("multi-color gradients stay readable across representative hue combinations", () => {
  for (const palette of [
    ["#050561", "#056133", "#edd7f4"],
    ["#fa9eb5", "#33293d", "#fcf3cf"],
  ]) {
    assertThemeReadable(
      deriveCoverTheme(palette),
      `gradient regression ${palette.join(" / ")}`,
    );
  }

  const companionOffsets = [
    [42, 132],
    [96, 216],
    [168, 288],
  ];
  for (let hue = 0; hue < 360; hue += 12) {
    for (const [fromOffset, toOffset] of companionOffsets) {
      const palette = [
        hslToHex(hue, 0.72, 0.42),
        hslToHex(hue + fromOffset, 0.64, 0.5),
        hslToHex(hue + toOffset, 0.58, 0.58),
      ];
      assertThemeReadable(deriveCoverTheme(palette), palette.join(" / "));
    }
  }
});

test("dynamic CSS-variable colors do not use unsupported Tailwind opacity modifiers", async () => {
  const sources = await readSourceTree(
    new URL("../src/", import.meta.url),
  );
  const unsupportedModifier =
    /!?(?:bg|border|from|to|ring|shadow|text)-accent(?:-secondary|-subtle)?\/(?:\[[^\]]+\]|[\w.]+)/g;

  for (const file of sources) {
    assert.deepEqual(
      [...file.text.matchAll(unsupportedModifier)].map((match) => match[0]),
      [],
      `${file.path} uses an accent opacity modifier that Tailwind cannot generate from a CSS variable`,
    );
  }
});

test("different covers tint the background while preserving a light base", () => {
  const red = deriveCoverTheme("#cc241d").tokens["--color-bg"];
  const blue = deriveCoverTheme("#458588").tokens["--color-bg"];
  assert.notEqual(red, blue);
  assert.ok(contrastRatio(GRUVBOX_LIGHT_THEME.foreground, red) >= 7);
  assert.ok(contrastRatio(GRUVBOX_LIGHT_THEME.foreground, blue) >= 7);
});

test("cover accents converge into the warm brand window across the color wheel", () => {
  for (let hue = 0; hue < 360; hue += 3) {
    for (const saturation of [0.12, 0.5, 0.9]) {
      for (const lightness of [0.2, 0.5, 0.8]) {
        const seed = hslToHex(hue, saturation, lightness);
        const derived = deriveCoverTheme(seed);
        assertWarmHue(
          derived.tokens["--color-accent"],
          `accent for cover ${seed}`,
        );
        assertWarmHue(
          derived.tokens["--color-accent-secondary"],
          `secondary accent for cover ${seed}`,
        );
        assertWarmHue(derived.desktopAccent, `desktop accent for cover ${seed}`);
      }
    }
  }
});

test("warm covers keep their terracotta hue; warm golds fold back toward terracotta", () => {
  // ≤40° 的暖色必须原样保留（不得被折叠夺走性格）。
  const terracottaAccent = deriveCoverTheme(DEFAULT_THEME_SEED).tokens[
    "--color-accent"
  ];
  const terracottaHue = hexToHsl(terracottaAccent).h;
  assert.ok(
    hueDistance(terracottaHue, 19) <= 2,
    `terracotta cover must stay terracotta, got ${terracottaAccent} (${terracottaHue.toFixed(1)}°)`,
  );
  for (const hue of [28, 34, 40]) {
    const accent = deriveCoverTheme(hslToHex(hue, 0.7, 0.4)).tokens[
      "--color-accent"
    ];
    assert.ok(
      hueDistance(hexToHsl(accent).h, hue) <= 2,
      `warm cover at ${hue}° must keep its hue, got ${accent} (${hexToHsl(accent).h.toFixed(1)}°)`,
    );
  }

  // 40°–55° 的暖金折回陶土一侧：琥珀封面不再固定在 40°，但仍在琥珀/陶土家族内。
  const amberAccent = deriveCoverTheme("#d79921").tokens["--color-accent"];
  const amberHue = hexToHsl(amberAccent).h;
  assert.ok(
    amberHue >= 30 && amberHue <= ACCENT_HUE_MAX,
    `amber cover must fold into the amber/terracotta band, got ${amberAccent} (${amberHue.toFixed(1)}°)`,
  );
});

test("warm-neutral khaki/gold covers fold to terracotta instead of olive", () => {
  // 回归对象：审计实拍里灰阶暖调封面派生出 #665C19（hue 52.2°）橄榄强调色，
  // 播放键/主按钮/已唱歌词全部变卡其。暖金覆盖层现在必须折回陶土一侧。
  const warmNeutralSeeds = [];
  for (let hue = 46; hue <= 54; hue += 2) {
    for (const saturation of [0.15, 0.25, 0.35]) {
      for (const lightness of [0.45, 0.55, 0.65]) {
        warmNeutralSeeds.push(hslToHex(hue, saturation, lightness));
      }
    }
  }

  for (const seed of warmNeutralSeeds) {
    const derived = deriveCoverTheme(seed);
    const accent = derived.tokens["--color-accent"];
    const accentHue = hexToHsl(accent).h;
    assert.ok(
      accentHue <= 44,
      `warm-neutral cover ${seed}: accent ${accent} hue ${accentHue.toFixed(1)}° must stay on the terracotta side of 44°`,
    );
    assertWarmHue(accent, `warm-neutral accent for ${seed}`);
    assertNotOlive(accent, `warm-neutral accent for ${seed}`);
    assertWarmHue(
      derived.tokens["--color-accent-secondary"],
      `warm-neutral secondary accent for ${seed}`,
    );
    assertWarmHue(
      derived.desktopAccent,
      `warm-neutral desktop accent for ${seed}`,
    );
    assertThemeReadable(derived, `warm-neutral ${seed}`);
  }

  // 审计报告中复现过的两个具体种子：折回后必须落在陶土/Ochre 家族，不再是橄榄金。
  const regressions = [
    [hslToHex(52, 0.3, 0.62), "#6a5f1b"],
    [hslToHex(48, 0.2, 0.55), "#6c5c1b"],
  ];
  for (const [seed, oliveRegression] of regressions) {
    const accent = deriveCoverTheme(seed).tokens["--color-accent"];
    const { h, s } = hexToHsl(accent);
    assert.ok(
      h >= 20 && h <= 36,
      `${seed}: accent ${accent} hue ${h.toFixed(1)}° must sit between terracotta(20°) and amber(36°)`,
    );
    assert.ok(s >= 0.58, `${seed}: accent ${accent} lost saturation (${s.toFixed(2)})`);
    const oliveHue = hexToHsl(oliveRegression).h;
    assert.ok(
      oliveHue - h >= 8,
      `${seed}: accent ${accent} (${h.toFixed(1)}°) must be clearly warmer than the old olive ${oliveRegression} (${oliveHue.toFixed(1)}°)`,
    );
  }
});

test("cold green/blue/pink covers fold onto warm accents while keeping breathing room", () => {
  const samples = {
    green: "#689d6a",
    blue: "#458588",
    pink: "#d3869b",
  };
  const derived = Object.fromEntries(
    Object.entries(samples).map(([name, seed]) => [
      name,
      deriveCoverTheme(seed),
    ]),
  );

  for (const [name, theme] of Object.entries(derived)) {
    assertThemeReadable(theme, `${name} sample ${samples[name]}`);
    const accent = theme.tokens["--color-accent"];
    assertWarmHue(accent, `${name} accent`);
    assertWarmHue(
      theme.tokens["--color-accent-secondary"],
      `${name} secondary accent`,
    );
    assertWarmHue(theme.desktopAccent, `${name} desktop accent`);
    const seedHue = hexToHsl(samples[name]).h;
    assert.ok(
      hueDistance(seedHue, hexToHsl(accent).h) >= 10,
      `${name}: accent ${accent} must stop copying the cover hue ${seedHue.toFixed(1)}°`,
    );
  }

  const accents = new Set(
    Object.values(derived).map((theme) => theme.tokens["--color-accent"]),
  );
  assert.equal(
    accents.size,
    3,
    "green/blue/pink covers must still produce distinct accents",
  );
  const backgrounds = new Set(
    Object.values(derived).map((theme) => theme.tokens["--color-bg"]),
  );
  assert.equal(
    backgrounds.size,
    3,
    "green/blue/pink covers must still tint the paper differently",
  );
});

test("muted covers keep the derived accent above the terracotta saturation floor", () => {
  // 用户确认：灰/冷封面把强调色推到 S≈0.48 的橄榄棕不是有意的。派生饱和度下限
  // 由 0.48 抬到 0.60；十六进制量化约损失 0.005，故实测下界取 0.58。
  const mutedSeeds = [
    "#4b5563",
    "#689d6a",
    "#458588",
    "#7a7a7a",
    "#b16286",
    "#6b5a3a",
  ];
  for (const seed of mutedSeeds) {
    const accent = deriveCoverTheme(seed).tokens["--color-accent"];
    const { s } = hexToHsl(accent);
    assert.ok(
      s >= 0.58,
      `muted cover ${seed}: accent ${accent} saturation ${s.toFixed(3)} fell below the 0.58 measured floor`,
    );
  }

  // 暖色封面本就触顶 0.76，抬高下限不得夺走它们的陶土/琥珀饱和度性格。
  for (const seed of [DEFAULT_THEME_SEED, "#d79921"]) {
    const accent = deriveCoverTheme(seed).tokens["--color-accent"];
    const { s } = hexToHsl(accent);
    assert.ok(
      s >= 0.74,
      `warm cover ${seed}: accent ${accent} saturation ${s.toFixed(3)} lost its terracotta/amber character`,
    );
  }
});

test("cover-derived backgrounds always stay warm paper", () => {
  for (let hue = 0; hue < 360; hue += 6) {
    for (const saturation of [0.12, 0.6, 0.95]) {
      for (const lightness of [0.15, 0.5, 0.85]) {
        const seed = hslToHex(hue, saturation, lightness);
        const derived = deriveCoverTheme(seed);
        {
          const paper = derived.tokens["--color-bg"];
          assertWarmPaper(paper, `--color-bg for cover ${seed}`);
          const { h } = hexToHsl(paper);
          assert.ok(
            h >= 20 && h <= 60,
            `--color-bg for cover ${seed}: ${paper} hue ${h.toFixed(1)}° is not a warm paper`,
          );
        }
        for (const token of [
          "--color-ambient-primary",
          "--color-ambient-secondary",
        ]) {
          const ambient = derived.tokens[token];
          assertWarmHue(ambient, `${token} for cover ${seed}`);
          assert.ok(
            hueDistance(hexToHsl(ambient).h, 20) <= 14,
            `${token} for cover ${seed}: ${ambient} must pull toward terracotta`,
          );
        }
      }
    }
  }

  for (const seed of ["#689d6a", "#458588", "#d3869b", "#b16286", "#4b5563"]) {
    const derived = deriveCoverTheme(seed);
    assertWarmPaper(derived.tokens["--color-bg"], `--color-bg for cold cover ${seed}`);
  }
});

test("invalid seeds safely fall back to the default theme seed", () => {
  assert.deepEqual(
    deriveCoverTheme("not-a-color"),
    deriveCoverTheme(DEFAULT_THEME_SEED),
  );
  assert.deepEqual(
    deriveCoverTheme(["#458588", "invalid", "#458588"]),
    deriveCoverTheme("#458588"),
  );
});

test("ink-mix text colors stay above the body contrast floor", async () => {
  // 评审发现：48% / 52% 墨色在纸上只有 2.8–3.2:1，是整页最弱的一处对比度。
  // 正文级小字必须 ≥4.65:1（DESIGN 的正文对染色纸下限）；在动态染色纸最暗端点
  // （#f2e5bc）上，68% 墨色约 4.67:1，因此把 68% 作为源码下限
  // （装饰性分隔符除外，它不承载信息）。
  const tree = await readSourceTree(new URL("../src/", import.meta.url));
  const pattern =
    /color:\s*color-mix\(in srgb, var\(--color-text-primary\)\s+(\d+)%,\s*transparent\)/g;
  const offenders = [];
  for (const { path, text } of tree) {
    for (const match of text.matchAll(pattern)) {
      const amount = Number(match[1]);
      if (amount >= 68) continue;
      if (path.endsWith("DailyRecommend.vue") && amount === 45) continue;
      offenders.push(`${path}: ${amount}%`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `ink mixes below 68% are too light for body text: ${offenders.join(", ")}`,
  );
});
