// 更新流程纯决策契约：覆盖 available / download-error / install-error 的重试矩阵，
// 尤其锁定「下载已完成后的 install 失败只重试安装、不重新下载」。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/updateFlow.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { nextInstallAction } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const STATUSES = [
  "idle",
  "checking",
  "latest",
  "available",
  "downloading",
  "installing",
  "download-error",
  "install-error",
  "installed",
  "unsupported",
  "error",
];

const ACTIONS = ["install", "download", "none"];

test("available 状态点主按钮开始下载", () => {
  assert.equal(
    nextInstallAction("available", { hasHandle: true, downloaded: false }),
    "download",
  );
  assert.equal(
    nextInstallAction("available", { hasHandle: true, downloaded: true }),
    "download",
  );
});

test("download-error 状态重试下载，即使旧 downloaded 标记为真也不跳过下载", () => {
  assert.equal(
    nextInstallAction("download-error", { hasHandle: true, downloaded: false }),
    "download",
  );
  assert.equal(
    nextInstallAction("download-error", { hasHandle: true, downloaded: true }),
    "download",
  );
});

test("install-error 且已下载时只重试安装、不重新下载", () => {
  assert.equal(
    nextInstallAction("install-error", { hasHandle: true, downloaded: true }),
    "install",
  );
});

test("install-error 但尚未下载完成时没有可执行动作", () => {
  assert.equal(
    nextInstallAction("install-error", { hasHandle: true, downloaded: false }),
    "none",
  );
});

test("没有 Update 句柄时任何状态都不可执行", () => {
  for (const status of STATUSES) {
    for (const downloaded of [true, false]) {
      assert.equal(
        nextInstallAction(status, { hasHandle: false, downloaded }),
        "none",
        `${status} / downloaded=${downloaded}`,
      );
    }
  }
});

test("不可执行状态（非三种主按钮状态）一律返回 none", () => {
  const actionable = new Set(["available", "download-error", "install-error"]);
  for (const status of STATUSES) {
    if (actionable.has(status)) continue;
    for (const downloaded of [true, false]) {
      assert.equal(
        nextInstallAction(status, { hasHandle: true, downloaded }),
        "none",
        `${status} / downloaded=${downloaded}`,
      );
    }
  }
});

test("完整分支矩阵：状态 × 句柄 × 已下载 只返回三种动作且与预期一致", () => {
  for (const status of STATUSES) {
    for (const hasHandle of [true, false]) {
      for (const downloaded of [true, false]) {
        let expected = "none";
        if (hasHandle) {
          if (status === "available" || status === "download-error") {
            expected = "download";
          } else if (status === "install-error" && downloaded) {
            expected = "install";
          }
        }
        const actual = nextInstallAction(status, { hasHandle, downloaded });
        assert.ok(
          ACTIONS.includes(actual),
          `动作必须是 ${ACTIONS.join("/")} 之一，实际 ${actual}`,
        );
        assert.equal(
          actual,
          expected,
          `${status} / hasHandle=${hasHandle} / downloaded=${downloaded}`,
        );
      }
    }
  }
});
