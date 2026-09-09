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

function assertThemeReadable(derived, label) {
  const backgrounds = [
    derived.tokens["--color-bg"],
    derived.tokens["--color-bg-from"],
    derived.tokens["--color-bg-to"],
  ];
  const accent = derived.tokens["--color-accent"];
  const accentSecondary = derived.tokens["--color-accent-secondary"];
  const onAccent = derived.tokens["--color-on-accent"];

  for (const background of backgrounds) {
    assert.ok(
      contrastRatio(accent, background) >= 4.5,
      `${label}: accent ${accent} is not readable on ${background}`,
    );
    assert.ok(
      contrastRatio(accentSecondary, background) >= 4.5,
      `${label}: secondary accent ${accentSecondary} is not visible on ${background}`,
    );
  }
  for (const surface of [
    GRUVBOX_LIGHT_THEME.card,
    GRUVBOX_LIGHT_THEME.cardHover,
  ]) {
    assert.ok(
      contrastRatio(accent, surface) >= 4.5,
      `${label}: accent ${accent} is not readable on card surface ${surface}`,
    );
  }
  assert.ok(
    contrastRatio(onAccent, accent) >= 4.5,
    `${label}: on-accent ${onAccent} is not readable on ${accent}`,
  );

  const gradientSegments = [
    [backgrounds[1], backgrounds[0]],
    [backgrounds[0], backgrounds[2]],
  ];
  for (const [start, end] of gradientSegments) {
    for (let step = 0; step <= 20; step += 1) {
      const surface = mixHex(start, end, step / 20);
      assert.ok(
        contrastRatio(accent, surface) >= 4.5,
        `${label}: accent ${accent} is not readable on gradient color ${surface}`,
      );
      assert.ok(
        contrastRatio(accentSecondary, surface) >= 4.5,
        `${label}: secondary accent ${accentSecondary} is not visible on gradient color ${surface}`,
      );
      for (const textColor of [
        GRUVBOX_LIGHT_THEME.foreground,
        GRUVBOX_LIGHT_THEME.textSecondary,
        GRUVBOX_LIGHT_THEME.textTertiary,
      ]) {
        assert.ok(
          contrastRatio(textColor, surface) >= 4.5,
          `${label}: text ${textColor} is not readable on gradient color ${surface}`,
        );
      }
    }
  }

  for (const surface of [...backgrounds, GRUVBOX_LIGHT_THEME.card]) {
    const subtleSurface = mixHex(surface, accent, 0.12);
    assert.ok(
      contrastRatio(GRUVBOX_LIGHT_THEME.foreground, subtleSurface) >= 4.5,
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
        contrastRatio(textColor, surface) >= 4.5,
        `${textColor} must remain readable on the default surface ${surface}`,
      );
    }
  }
});

test("CSS defaults stay synchronized with the Gruvbox token source", () => {
  const expected = {
    "--color-bg": GRUVBOX_LIGHT_THEME.background,
    "--color-bg-from": GRUVBOX_LIGHT_THEME.backgroundHard,
    "--color-bg-to": GRUVBOX_LIGHT_THEME.backgroundSoft,
    "--color-ambient-primary": "#d79921",
    "--color-ambient-secondary": "#458588",
    "--color-card": GRUVBOX_LIGHT_THEME.card,
    "--color-card-hover": GRUVBOX_LIGHT_THEME.cardHover,
    "--color-border": "transparent",
    "--color-border-strong": "transparent",
    "--color-accent": DEFAULT_THEME_SEED,
    "--color-on-accent": GRUVBOX_LIGHT_THEME.background,
    "--color-accent-secondary": "#d65d0e",
    "--color-accent-subtle": "rgba(175, 58, 3, 0.12)",
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
