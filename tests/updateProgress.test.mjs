// 下载进度契约：没有 Content-Length 时不猜百分比；已下载字节不越界。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/updateProgress.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { downloadPercent } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("没有 Content-Length 时返回 null", () => {
  assert.equal(downloadPercent(0, 0), null);
  assert.equal(downloadPercent(1024, 0), null);
  assert.equal(downloadPercent(1024, Number.NaN), null);
  assert.equal(downloadPercent(1024, Number.POSITIVE_INFINITY), null);
});

test("正常进度四舍五入到整数百分比", () => {
  assert.equal(downloadPercent(0, 100), 0);
  assert.equal(downloadPercent(1, 3), 33);
  assert.equal(downloadPercent(2, 3), 67);
  assert.equal(downloadPercent(50, 100), 50);
  assert.equal(downloadPercent(100, 100), 100);
});

test("超过总长度或收到异常值时收敛到 0–100", () => {
  assert.equal(downloadPercent(150, 100), 100);
  assert.equal(downloadPercent(-10, 100), 0);
  assert.equal(downloadPercent(Number.NaN, 100), 0);
});
