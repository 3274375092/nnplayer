import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/recentSearches.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("records new searches newest-first and de-duplicates case-insensitively", () => {
  const storage = fakeStorage();
  assert.deepEqual(addRecentSearch("晚风", storage), ["晚风"]);
  assert.deepEqual(addRecentSearch("海边", storage), ["海边", "晚风"]);
  assert.deepEqual(addRecentSearch("  晚风  ", storage), ["晚风", "海边"]);
  assert.deepEqual(addRecentSearch("WANFENG", storage), ["WANFENG", "晚风", "海边"]);
});

test("caps the list at six entries", () => {
  const storage = fakeStorage();
  for (const query of ["a", "b", "c", "d", "e", "f", "g"]) {
    addRecentSearch(query, storage);
  }
  assert.deepEqual(loadRecentSearches(storage), ["g", "f", "e", "d", "c", "b"]);
});

test("ignores blank queries and corrupt storage", () => {
  const storage = fakeStorage();
  assert.deepEqual(addRecentSearch("   ", storage), []);
  assert.deepEqual(loadRecentSearches(fakeStorage({ "nnplayer.recentSearches": "{broken" })), []);
  assert.deepEqual(
    loadRecentSearches(fakeStorage({ "nnplayer.recentSearches": '{"not":"array"}' })),
    [],
  );
  assert.deepEqual(
    loadRecentSearches(fakeStorage({ "nnplayer.recentSearches": '["a",2,"b","A"]' })),
    ["a", "b"],
  );
});

test("caps legacy storage with more than six entries on load", () => {
  // 旧版本/手改的 localStorage 可能超过上限：读取时就要收敛到 6 条（新→旧）。
  const legacy = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const storage = fakeStorage({
    "nnplayer.recentSearches": JSON.stringify(legacy),
  });
  assert.deepEqual(loadRecentSearches(storage), ["a", "b", "c", "d", "e", "f"]);
});

test("persists under the nnplayer.recentSearches key", () => {
  // 键名是跨版本契约：改名会让既有历史静默消失。写入后断言真实存储的键，
  // 这样上面的损坏数据断言即使键名漂移也不会假装通过。
  const storage = fakeStorage();
  addRecentSearch("晚风", storage);
  assert.ok(
    storage.data.has("nnplayer.recentSearches"),
    "recent searches must persist under nnplayer.recentSearches",
  );
  assert.deepEqual(
    JSON.parse(storage.data.get("nnplayer.recentSearches")),
    ["晚风"],
  );
});

test("clears history and tolerates unavailable storage", () => {
  const storage = fakeStorage();
  addRecentSearch("晚风", storage);
  clearRecentSearches(storage);
  assert.deepEqual(loadRecentSearches(storage), []);
  assert.deepEqual(loadRecentSearches(null), []);
  assert.deepEqual(addRecentSearch("晚风", null), []);
  clearRecentSearches(null);
});

test("survives a storage that throws on write", () => {
  const storage = fakeStorage();
  storage.setItem = () => {
    throw new Error("QuotaExceeded");
  };
  // 写入失败时本次会话仍返回新列表（界面可继续用），但不会持久化。
  assert.deepEqual(addRecentSearch("晚风", storage), ["晚风"]);
  assert.deepEqual(loadRecentSearches(storage), []);
});

test("survives a storage that throws on read or remove", () => {
  const readThrows = fakeStorage();
  readThrows.getItem = () => {
    throw new Error("SecurityError");
  };
  // 读失败按空历史处理；写入仍可用，本次会话照常返回新列表。
  assert.deepEqual(loadRecentSearches(readThrows), []);
  assert.deepEqual(addRecentSearch("晚风", readThrows), ["晚风"]);

  const removeThrows = fakeStorage();
  removeThrows.removeItem = () => {
    throw new Error("SecurityError");
  };
  // 清不掉历史不影响搜索，错误必须被吞掉。
  assert.doesNotThrow(() => clearRecentSearches(removeThrows));
});
