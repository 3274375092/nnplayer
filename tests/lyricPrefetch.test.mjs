import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/lyrics/lyricPrefetch.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { getNextLyricPrefetchSongId } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const queue = [{ id: 1 }, { id: 2 }, { id: 3 }];

test("loop-list prefetches the next song in queue order", () => {
  assert.equal(
    getNextLyricPrefetchSongId({
      playMode: "loop-list",
      queue,
      index: 0,
      currentSongId: 1,
    }),
    2,
  );
  assert.equal(
    getNextLyricPrefetchSongId({
      playMode: "loop-list",
      queue,
      index: 2,
      currentSongId: 3,
    }),
    1,
  );
});

test("other play modes and degenerate queues skip prefetching", () => {
  for (const playMode of ["loop-one", "shuffle"]) {
    assert.equal(
      getNextLyricPrefetchSongId({
        playMode,
        queue,
        index: 0,
        currentSongId: 1,
      }),
      null,
      `${playMode} 不应预取`,
    );
  }
  assert.equal(
    getNextLyricPrefetchSongId({
      playMode: "loop-list",
      queue: [{ id: 7 }],
      index: 0,
      currentSongId: 7,
    }),
    null,
  );
  assert.equal(
    getNextLyricPrefetchSongId({
      playMode: "loop-list",
      queue,
      index: -1,
      currentSongId: null,
    }),
    null,
  );
  assert.equal(
    getNextLyricPrefetchSongId({
      playMode: "loop-list",
      queue,
      index: 0,
      currentSongId: 2,
    }),
    null,
    "下一首与当前媒体 id 相同（单曲队列/异常状态）时不重复预取",
  );
  assert.equal(
    getNextLyricPrefetchSongId({
      playMode: "loop-list",
      queue,
      index: 0,
      currentSongId: 1,
    }),
    2,
  );
});
