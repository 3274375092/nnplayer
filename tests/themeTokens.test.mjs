import assert from "node:assert/strict";
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

/** 封面换肤允许改变的色相范围：陶土≈20°，琥珀≈40°，两端各留窗口余量。 */
const WARM_ACCENT_HUE_MIN = 10;
const WARM_ACCENT_HUE_MAX = 55;

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
  min = WARM_ACCENT_HUE_MIN,
  max = WARM_ACCENT_HUE_MAX,
) {
  const { h } = hexToHsl(hex);
  assert.ok(
    h >= min && h <= max,
    `${label}: ${hex} hue ${h.toFixed(1)}° must stay inside the warm ${min}–${max}° window`,
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
 * 复算 accent-subtle 洗色在真实渲染里的合成色：accent-subtle 是 12% 透明层，
 * 侧栏 = surface-soft 叠 canvas，窄窗侧栏浮层 = 纸色，队列徽标 = 叠两次的 raised。
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
  const canvas = mixHex("#f6f7f6", background, 0.36);
  const surfaceSoft = mixHex(canvas, GRUVBOX_LIGHT_THEME.foreground, 0.05);
  const raised = mixHex("#ffffff", card, 0.42);
  return {
    sidebar: wash(surfaceSoft),
    overlaySidebar: wash(background),
    queueBadge: wash(raised, 2),
    raised,
  };
}

function assertThemeReadable(derived, label) {
  const backgrounds = [
    derived.tokens["--color-bg"],
    derived.tokens["--color-bg-from"],
    derived.tokens["--color-bg-to"],
  ];
  const accent = derived.tokens["--color-accent"];
  const accentSecondary = derived.tokens["--color-accent-secondary"];
  const onAccent = derived.tokens["--color-on-accent"];
  const accentOnSubtle = derived.tokens["--color-accent-on-subtle"];
  const backdrops = accentSubtleBackdrops({
    background: derived.tokens["--color-bg"],
    accent,
  });

  for (const background of backgrounds) {
    assert.ok(
      contrastRatio(accent, background) >= ACCENT_MIN_CONTRAST,
      `${label}: accent ${accent} is not readable on ${background}`,
    );
    assert.ok(
      contrastRatio(accentSecondary, background) >= ACCENT_MIN_CONTRAST,
      `${label}: secondary accent ${accentSecondary} is not visible on ${background}`,
    );
  }
  for (const surface of [
    GRUVBOX_LIGHT_THEME.card,
    GRUVBOX_LIGHT_THEME.cardHover,
    backdrops.raised,
  ]) {
    assert.ok(
      contrastRatio(accent, surface) >= ACCENT_MIN_CONTRAST,
      `${label}: accent ${accent} is not readable on floating surface ${surface}`,
    );
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

  const gradientSegments = [
    [backgrounds[1], backgrounds[0]],
    [backgrounds[0], backgrounds[2]],
  ];
  for (const [start, end] of gradientSegments) {
    for (let step = 0; step <= 20; step += 1) {
      const surface = mixHex(start, end, step / 20);
      assert.ok(
        contrastRatio(accent, surface) >= ACCENT_MIN_CONTRAST,
        `${label}: accent ${accent} is not readable on gradient color ${surface}`,
      );
      assert.ok(
        contrastRatio(accentSecondary, surface) >= ACCENT_MIN_CONTRAST,
        `${label}: secondary accent ${accentSecondary} is not visible on gradient color ${surface}`,
      );
      for (const textColor of [
        GRUVBOX_LIGHT_THEME.foreground,
        GRUVBOX_LIGHT_THEME.textSecondary,
        GRUVBOX_LIGHT_THEME.textTertiary,
      ]) {
        assert.ok(
          contrastRatio(textColor, surface) >= BODY_MIN_CONTRAST,
          `${label}: text ${textColor} is not readable on gradient color ${surface}`,
        );
      }
    }
  }

  for (const surface of [...backgrounds, GRUVBOX_LIGHT_THEME.card]) {
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
    "--color-bg-from": GRUVBOX_LIGHT_THEME.backgroundHard,
    "--color-bg-to": GRUVBOX_LIGHT_THEME.backgroundSoft,
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
    "--color-ring": "transparent",
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
    assertWarmHue(ambient, "static ambient default");
  }
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
  for (const token of [
    "--color-bg-from",
    "--color-bg-to",
    "--color-ambient-primary",
    "--color-ambient-secondary",
  ]) {
    assert.notEqual(violetGold.tokens[token], mono.tokens[token]);
    assert.notEqual(violetGold.tokens[token], greenRed.tokens[token]);
  }

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

test("warm covers keep their terracotta/amber hue instead of being flattened", () => {
  const terracottaAccent = deriveCoverTheme(DEFAULT_THEME_SEED).tokens[
    "--color-accent"
  ];
  const terracottaHue = hexToHsl(terracottaAccent).h;
  assert.ok(
    hueDistance(terracottaHue, 19) <= 2,
    `terracotta cover must stay terracotta, got ${terracottaAccent} (${terracottaHue.toFixed(1)}°)`,
  );

  const amberAccent = deriveCoverTheme("#d79921").tokens["--color-accent"];
  const amberHue = hexToHsl(amberAccent).h;
  assert.ok(
    hueDistance(amberHue, 40) <= 2,
    `amber cover must stay amber, got ${amberAccent} (${amberHue.toFixed(1)}°)`,
  );
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

test("cover-derived backgrounds always stay warm paper", () => {
  for (let hue = 0; hue < 360; hue += 6) {
    for (const saturation of [0.12, 0.6, 0.95]) {
      for (const lightness of [0.15, 0.5, 0.85]) {
        const seed = hslToHex(hue, saturation, lightness);
        const derived = deriveCoverTheme(seed);
        for (const token of [
          "--color-bg",
          "--color-bg-from",
          "--color-bg-to",
        ]) {
          const paper = derived.tokens[token];
          assertWarmPaper(paper, `${token} for cover ${seed}`);
          const { h } = hexToHsl(paper);
          assert.ok(
            h >= 20 && h <= 60,
            `${token} for cover ${seed}: ${paper} hue ${h.toFixed(1)}° is not a warm paper`,
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
    for (const token of ["--color-bg", "--color-bg-from", "--color-bg-to"]) {
      assertWarmPaper(derived.tokens[token], `${token} for cold cover ${seed}`);
    }
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
