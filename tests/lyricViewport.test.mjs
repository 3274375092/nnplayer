import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/lyrics/lyricViewport.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const viewport = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("small lyric lists render all lines", () => {
  assert.deepEqual(viewport.getLyricRenderRange(160, 40), { start: 0, end: 160 });
});

test("large lyric lists keep the active line and original indexes", () => {
  const range = viewport.getLyricRenderRange(1000, 500);
  assert.deepEqual(range, {
    start: 484,
    end: 517,
  });
  assert.equal(range.end - range.start, 33);
  assert.deepEqual(viewport.getLyricRenderRange(1000, -1), {
    start: 0,
    end: 17,
  });
  assert.deepEqual(viewport.getLyricRenderRange(1000, 999), {
    start: 983,
    end: 1000,
  });
  assert.deepEqual(viewport.getLyricRenderRange(1000, 16), {
    start: 0,
    end: 33,
  });
});

test("height prefix and virtual padding preserve unrendered space", () => {
  const prefix = viewport.buildLyricHeightPrefix(4, [10, 20], 30);
  assert.deepEqual([...prefix], [0, 10, 30, 60, 90]);
  assert.deepEqual(
    viewport.getLyricVirtualPadding(prefix, { start: 1, end: 3 }),
    { top: 10, bottom: 30 },
  );
});
