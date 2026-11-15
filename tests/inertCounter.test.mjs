import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/inertCounter.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { acquireInertRefs, releaseInertRefs } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("首次持有时激活目标，重复持有只增加计数", () => {
  const counts = new Map();
  assert.deepEqual(acquireInertRefs(counts, ["#app"]), ["#app"]);
  assert.equal(counts.get("#app"), 1);
  // 第二个模态持有同一目标：不重复写 inert。
  assert.deepEqual(acquireInertRefs(counts, ["#app"]), []);
  assert.equal(counts.get("#app"), 2);
});

test("重叠持有者按后进先出释放：最后一个释放才解禁", () => {
  const counts = new Map();
  acquireInertRefs(counts, ["#app", ".app-main"]);
  acquireInertRefs(counts, ["#app"]);

  // 较新的模态先关：目标仍被旧模态持有，不能解禁。
  assert.deepEqual(releaseInertRefs(counts, ["#app"]), []);
  assert.equal(counts.get("#app"), 1);

  // 旧模态再关：这时才真正解禁。
  assert.deepEqual(releaseInertRefs(counts, ["#app", ".app-main"]), [
    "#app",
    ".app-main",
  ]);
  assert.equal(counts.size, 0);
});

test("多目标一次性释放时只返回真正归零的目标", () => {
  const counts = new Map();
  acquireInertRefs(counts, ["a", "b"]);
  acquireInertRefs(counts, ["b"]);
  assert.deepEqual(releaseInertRefs(counts, ["a", "b"]), ["a"]);
  assert.equal(counts.get("b"), 1);
});

test("重复释放是幂等的：忽略未知目标，不产生负数计数", () => {
  const counts = new Map();
  acquireInertRefs(counts, ["#app"]);
  assert.deepEqual(releaseInertRefs(counts, ["#app"]), ["#app"]);
  // 第二次释放（比如 dispose 与 watch 都触发）：不能再次返回目标。
  assert.deepEqual(releaseInertRefs(counts, ["#app"]), []);
  assert.equal(counts.has("#app"), false);
  assert.equal(counts.get("#app"), undefined);
});

test("同一次调用中的重复目标只登记一次", () => {
  const counts = new Map();
  assert.deepEqual(acquireInertRefs(counts, ["x", "x"]), ["x"]);
  assert.equal(counts.get("x"), 1);
  assert.deepEqual(releaseInertRefs(counts, ["x", "x"]), ["x"]);
  assert.equal(counts.size, 0);
});

test("空集合不影响计数", () => {
  const counts = new Map();
  assert.deepEqual(acquireInertRefs(counts, []), []);
  assert.deepEqual(releaseInertRefs(counts, []), []);
  assert.equal(counts.size, 0);
});

test("目标激活顺序与传入顺序一致（进度稳定便于断言）", () => {
  const counts = new Map();
  const targets = [".b", ".a", ".b", ".c"];
  assert.deepEqual(acquireInertRefs(counts, targets), [".b", ".a", ".c"]);
  assert.deepEqual(
    releaseInertRefs(counts, [".c", ".a", ".b"]),
    [".c", ".a", ".b"],
  );
  assert.equal(counts.size, 0);
});
