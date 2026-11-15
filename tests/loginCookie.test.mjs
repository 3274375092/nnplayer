import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/loginCookie.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { hasUsableMusicUCookie } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("accepts a cookie that contains a usable MUSIC_U pair", () => {
  assert.equal(hasUsableMusicUCookie("MUSIC_U=abc123"), true);
  assert.equal(hasUsableMusicUCookie("__csrf=xyz; MUSIC_U=abc123; NMTID=1"), true);
  assert.equal(hasUsableMusicUCookie("  MUSIC_U = abc123 ; __csrf=xyz "), true);
});

test("rejects empty input and non-cookie text", () => {
  assert.equal(hasUsableMusicUCookie(""), false);
  assert.equal(hasUsableMusicUCookie("   "), false);
  assert.equal(hasUsableMusicUCookie("plain text without cookie pairs"), false);
  assert.equal(hasUsableMusicUCookie("MUSIC_U"), false);
});

test("rejects empty, placeholder and lookalike values", () => {
  assert.equal(hasUsableMusicUCookie("MUSIC_U=; __csrf=xyz"), false);
  assert.equal(hasUsableMusicUCookie("MUSIC_U=   ;"), false);
  assert.equal(hasUsableMusicUCookie("MUSIC_U=undefined"), false);
  assert.equal(hasUsableMusicUCookie("MUSIC_U=null"), false);
  // 别的键名里出现 MUSIC_U 不算（旧实现 includes() 的误判来源）。
  assert.equal(hasUsableMusicUCookie("MUSIC_U2=abc123"), false);
  assert.equal(hasUsableMusicUCookie("NOT_MUSIC_U=abc123"), false);
});

test("tolerates a malformed neighbouring pair without losing the real one", () => {
  assert.equal(hasUsableMusicUCookie("=broken; MUSIC_U=abc123; =alsobroken"), true);
  assert.equal(hasUsableMusicUCookie("MUSIC_U=abc123; MUSIC_U2="), true);
});
