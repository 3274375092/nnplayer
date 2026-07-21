import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/coverImage.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const coverImage = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("coverImageUrl returns empty string for falsy input", () => {
  assert.equal(coverImage.coverImageUrl(null, 100), "");
  assert.equal(coverImage.coverImageUrl(undefined, 100), "");
  assert.equal(coverImage.coverImageUrl("", 100), "");
});

test("coverImageUrl appends param for NCM hosts", () => {
  const result = coverImage.coverImageUrl(
    "https://p1.music.126.net/abc.jpg",
    100,
    1,
  );
  // In Node.js window.devicePixelRatio is undefined, so DPR defaults to 1.
  // 100 * 1 = 100, clamped to [1, 1200], so param=100y100
  assert.ok(result.includes("param=100y100"));
});

test("coverImageUrl respects 2x pixel ratio", () => {
  const result = coverImage.coverImageUrl(
    "https://p1.music.126.net/abc.jpg",
    100,
    2,
  );
  assert.ok(result.includes("param=200y200"));
});

test("coverImageUrl does not modify non-NCM URLs", () => {
  const url = "https://example.com/cover.jpg";
  const result = coverImage.coverImageUrl(url, 100);
  assert.equal(result, url);
});

test("coverImageUrl handles subdomain NCM hosts", () => {
  const result = coverImage.coverImageUrl(
    "https://p4.music.126.net/cover.jpg",
    50,
    1,
  );
  assert.ok(result.includes("param=50y50"));
});

test("coverImageUrl handles music.163.com hosts", () => {
  const result = coverImage.coverImageUrl(
    "https://music.163.com/api/img/cover.jpg",
    100,
    1,
  );
  assert.ok(result.includes("param=100y100"));
});

test("coverImageUrl handles protocol-relative URLs", () => {
  // protocol-relative or invalid URL returns as-is
  const result = coverImage.coverImageUrl("//p1.music.126.net/cover.jpg", 100);
  assert.equal(result, "//p1.music.126.net/cover.jpg");
});

test("coverImageUrl handles data: URLs", () => {
  const url = "data:image/png;base64,abc123";
  const result = coverImage.coverImageUrl(url, 100);
  assert.equal(result, url);
});

test("coverImageUrl caches results for same inputs", () => {
  const url = "https://p1.music.126.net/unique.jpg";
  const first = coverImage.coverImageUrl(url, 200);
  const second = coverImage.coverImageUrl(url, 200);
  // Same object identity due to cache
  assert.equal(first, second);
});

test("coverImageUrl respects devicePixelRatio", () => {
  const result1x = coverImage.coverImageUrl(
    "https://p1.music.126.net/cover.jpg",
    100,
    1,
  );
  const result2x = coverImage.coverImageUrl(
    "https://p1.music.126.net/cover.jpg",
    100,
    2,
  );
  assert.ok(result1x.includes("param=100y100"));
  assert.ok(result2x.includes("param=200y200"));
});

test("coverImageUrl clamps DPR to MAX_DEVICE_PIXEL_RATIO", () => {
  const result = coverImage.coverImageUrl(
    "https://p1.music.126.net/cover.jpg",
    100,
    5,
  );
  // MAX_DEVICE_PIXEL_RATIO is 2, so 100 * 2 = 200
  assert.ok(result.includes("param=200y200"));
});

test("coverImageUrl clamps DPR to minimum 1", () => {
  const result = coverImage.coverImageUrl(
    "https://p1.music.126.net/cover.jpg",
    100,
    0,
  );
  assert.ok(result.includes("param=100y100"));
});
