import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 卡拉OK 按词分组是零依赖纯函数：直接转译 src/lyrics/karaokeWords.ts 后执行，
// 不引入 Vue / DOM，覆盖渲染层依赖的分组契约（词内不断、CJK 逐字、空白断点）。
async function compileTypeScriptModule(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
}

const compiled = await compileTypeScriptModule("../src/lyrics/karaokeWords.ts");
const { groupKaraokeTokensIntoWords } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

/** 把一行歌词切成逐字 token（与 YRC 解析一致：每个 token 一个字形）。 */
function tokenize(text, startMs = 0) {
  return Array.from(text).map((char, index) => ({
    char,
    startMs: startMs + index,
    endMs: startMs + index + 1,
  }));
}

/** 渲染层实际读取的字段：组文本 + 是否整词不断 + 是否空白断点组。 */
function describeGroups(groups) {
  return groups.map((group) => ({
    text: group.tokens.map((token) => token.char).join(""),
    nowrap: group.nowrap,
    isSpace: group.isSpace,
  }));
}

/** 分组只重排渲染节点，不允许丢 token / 改顺序：拼接后必须与输入逐 token 相等。 */
function assertTokensPreserved(groups, tokens) {
  assert.deepEqual(
    groups.flatMap((group) => group.tokens),
    tokens,
  );
}

test("英文多词：按空格分组，每个词整词不可断", () => {
  const tokens = tokenize("So let me play my violin for you");
  const groups = groupKaraokeTokensIntoWords(tokens);

  assertTokensPreserved(groups, tokens);
  const words = groups
    .filter((group) => group.nowrap)
    .map((group) => group.tokens.map((token) => token.char).join(""));
  assert.deepEqual(words, [
    "So",
    "let",
    "me",
    "play",
    "my",
    "violin",
    "for",
    "you",
  ]);

  // 词之间各有一个空白组：断行只会落在这些空格上，而不是词内部。
  const spaces = groups.filter((group) => group.isSpace);
  assert.equal(spaces.length, 7);
  for (const space of spaces) {
    assert.equal(space.nowrap, false);
    assert.equal(
      space.tokens.map((token) => token.char).join(""),
      " ",
    );
  }
  // 组类型互斥：词组不是空白组，空白组不是词组。
  for (const group of groups) assert.ok(!(group.nowrap && group.isSpace));
});

test("词内标点：you, / don't 都留在同一个不可断的词组里", () => {
  assert.deepEqual(describeGroups(groupKaraokeTokensIntoWords(tokenize("you,"))), [
    { text: "you,", nowrap: true, isSpace: false },
  ]);
  assert.deepEqual(
    describeGroups(groupKaraokeTokensIntoWords(tokenize("don't stop"))),
    [
      { text: "don't", nowrap: true, isSpace: false },
      { text: " ", nowrap: false, isSpace: true },
      { text: "stop", nowrap: true, isSpace: false },
    ],
  );
});

test("无空格 CJK：逐字成组，仍按字换行（不强制 nowrap）", () => {
  const tokens = tokenize("你好世界");
  const groups = groupKaraokeTokensIntoWords(tokens);

  assertTokensPreserved(groups, tokens);
  assert.deepEqual(describeGroups(groups), [
    { text: "你", nowrap: false, isSpace: false },
    { text: "好", nowrap: false, isSpace: false },
    { text: "世", nowrap: false, isSpace: false },
    { text: "界", nowrap: false, isSpace: false },
  ]);
});

test("中英混排：CJK 逐字、英文整词，互不吞并", () => {
  const tokens = tokenize("你好hello世界");
  const groups = groupKaraokeTokensIntoWords(tokens);

  assertTokensPreserved(groups, tokens);
  assert.deepEqual(describeGroups(groups), [
    { text: "你", nowrap: false, isSpace: false },
    { text: "好", nowrap: false, isSpace: false },
    { text: "hello", nowrap: true, isSpace: false },
    { text: "世", nowrap: false, isSpace: false },
    { text: "界", nowrap: false, isSpace: false },
  ]);

  // 带空格的中英混排：空格仍是词间断点。
  assert.deepEqual(
    describeGroups(groupKaraokeTokensIntoWords(tokenize("你好 world"))),
    [
      { text: "你", nowrap: false, isSpace: false },
      { text: "好", nowrap: false, isSpace: false },
      { text: " ", nowrap: false, isSpace: true },
      { text: "world", nowrap: true, isSpace: false },
    ],
  );
});

test("单字符 token：英文单字整词、单个 CJK 字逐字", () => {
  assert.deepEqual(describeGroups(groupKaraokeTokensIntoWords([{ char: "A" }])), [
    { text: "A", nowrap: true, isSpace: false },
  ]);
  assert.deepEqual(describeGroups(groupKaraokeTokensIntoWords([{ char: "好" }])), [
    { text: "好", nowrap: false, isSpace: false },
  ]);
});

test("空输入返回空数组（当前行没有逐字时间戳时不渲染分组）", () => {
  assert.deepEqual(groupKaraokeTokensIntoWords([]), []);
});

test("连续空白合并成一组，空格文本原样保留", () => {
  const tokens = tokenize("a  b");
  const groups = groupKaraokeTokensIntoWords(tokens);

  assertTokensPreserved(groups, tokens);
  assert.deepEqual(describeGroups(groups), [
    { text: "a", nowrap: true, isSpace: false },
    { text: "  ", nowrap: false, isSpace: true },
    { text: "b", nowrap: true, isSpace: false },
  ]);
});

test("RTL：按空格分词，词内 token 顺序与输入一致", () => {
  const tokens = tokenize("مرحبا بالعالم");
  const groups = groupKaraokeTokensIntoWords(tokens);

  assertTokensPreserved(groups, tokens);
  assert.deepEqual(describeGroups(groups), [
    { text: "مرحبا", nowrap: true, isSpace: false },
    { text: " ", nowrap: false, isSpace: true },
    { text: "بالعالم", nowrap: true, isSpace: false },
  ]);
});

test("空字符 token 不破坏分组，也不产生可见擦色节点", () => {
  const tokens = tokenize("ab");
  tokens.splice(1, 0, { char: "", startMs: 1, endMs: 1 });
  const groups = groupKaraokeTokensIntoWords(tokens);

  assertTokensPreserved(groups, tokens);
  // 空字符按空白处理（渲染层输出空文本），不会把 "a"/"b" 粘死或拆散。
  assert.deepEqual(describeGroups(groups), [
    { text: "a", nowrap: true, isSpace: false },
    { text: "", nowrap: false, isSpace: true },
    { text: "b", nowrap: true, isSpace: false },
  ]);
});
