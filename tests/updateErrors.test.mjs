// 更新错误分类契约：只把 updater 的「平台条目缺失」识别为 unsupported，
// 网络/超时/未知错误必须继续走通用失败态，避免误导用户。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/updateErrors.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { isUnsupportedPlatformError } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("TargetsNotFound 文案识别为当前平台缺失", () => {
  const message =
    'None of the fallback platforms `["linux-x86_64-deb", "linux-x86_64"]` were found in the response `platforms` object';
  assert.equal(isUnsupportedPlatformError(message), true);
});

test("TargetNotFound 文案识别为当前平台缺失", () => {
  assert.equal(
    isUnsupportedPlatformError(
      new Error(
        "the platform `linux-x86_64` was not found in the response `platforms` object",
      ),
    ),
    true,
  );
});

test("网络与超时错误不被误判为平台缺失", () => {
  assert.equal(
    isUnsupportedPlatformError(new Error("request timed out after 10s")),
    false,
  );
  assert.equal(
    isUnsupportedPlatformError(
      "Could not fetch a valid release JSON from the remote",
    ),
    false,
  );
});

test("非错误值安全回落", () => {
  assert.equal(isUnsupportedPlatformError(undefined), false);
  assert.equal(isUnsupportedPlatformError(null), false);
  assert.equal(isUnsupportedPlatformError(42), false);
  assert.equal(isUnsupportedPlatformError({}), false);
});

test("对象形态的 message 也能识别", () => {
  assert.equal(
    isUnsupportedPlatformError({
      message:
        "the platform `linux-x86_64` was not found in the response `platforms` object",
    }),
    true,
  );
});
