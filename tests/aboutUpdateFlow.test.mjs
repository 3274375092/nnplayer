// 软件内更新流程的源码契约：Node 环境没有 Vue/Tauri runtime，
// 这里锁定「用户确认后下载安装 + 重启」这条接线不被退回成只打开发布页，
// 并附加重入时序、纯模块接线、失败文案与 live region 的锚点。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/AboutDialog.vue", import.meta.url),
  "utf8",
);

/** 取出一个无参 async 函数的函数体（顶格右花括号视为结尾）。 */
function asyncFunctionBody(name) {
  const pattern = new RegExp(
    `async\\s+function\\s+${name}\\s*\\(\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\}`,
  );
  const match = pattern.exec(source);
  assert.ok(match, `找不到 ${name} 的函数实现`);
  return match[1];
}

test("发现新版本后由用户确认下载并安装，而不是只打开发布页", () => {
  assert.match(source, /update\.download\(/);
  assert.match(
    source,
    /update\.install\(\{\s*restartAfterInstall:\s*true\s*\}\)/,
  );
  assert.match(source, /@tauri-apps\/plugin-process/);
  assert.match(source, /relaunch\(\)/);
});

test("下载/安装进行中禁止关闭弹层，避免用户误以为已取消", () => {
  assert.match(source, /if\s*\(\s*busyUpdate\.value\s*\)\s*return;/);
  assert.match(source, /:disabled="busyUpdate"/);
});

test("下载进度只在有 Content-Length 时显示百分比", () => {
  assert.match(
    source,
    /downloadPercent\(\s*receivedBytes\s*,\s*totalBytes\s*\)/,
  );
  assert.match(
    source,
    /updateStatus\s*===\s*['"]downloading['"]\s*&&\s*downloadProgress\s*!==\s*null/,
  );
});

test("checkUpdates 在第一个 await 之前同步置为 checking（堵住 close IPC 重入窗口）", () => {
  const body = asyncFunctionBody("checkUpdates");
  const checkingAt = body.search(
    /updateStatus\.value\s*=\s*['"]checking['"]/,
  );
  const firstAwaitAt = body.search(/\bawait\b/);
  assert.notEqual(checkingAt, -1, "checkUpdates 必须先同步置为 checking");
  assert.notEqual(
    firstAwaitAt,
    -1,
    "checkUpdates 应保留 await close/check 等异步步骤",
  );
  assert.ok(
    checkingAt < firstAwaitAt,
    "checking 若晚于第一个 await，close() 的 IPC 窗口内双击会并发 check() 并泄漏 Update 句柄",
  );
  // 释放旧句柄仍要在 check 之前完成，避免复用已关闭的 Update。
  assert.match(body, /await\s+closePendingUpdate\s*\(\s*\)/);
  assert.ok(
    body.search(/await\s+closePendingUpdate\s*\(\s*\)/) <
      body.search(/await\s+check\s*\(/),
    "checkUpdates 应先释放旧句柄再发起 check()",
  );
});

test("更新状态机与重试动作由纯模块 updateFlow 决定", () => {
  assert.match(
    source,
    /import\s*\{[^}]*nextInstallAction[^}]*\}\s*from\s*["']@\/utils\/updateFlow["']/,
  );
  assert.match(source, /nextInstallAction\(\s*updateStatus\.value\s*,/);
  // UpdateStatus 只在纯模块里定义，组件不再维护第二份联合类型。
  assert.doesNotMatch(source, /type\s+UpdateStatus\s*=/);
});

test("重试安装分支不再手写状态判断，而是复用 installAction 的决策", () => {
  const body = asyncFunctionBody("installUpdate");
  assert.match(body, /const\s+action\s*=\s*installAction\.value;/);
  assert.match(body, /if\s*\(\s*action\s*===\s*['"]install['"]\s*\)/);
  assert.match(body, /if\s*\(\s*action\s*===\s*['"]download['"]\s*\)/);
});

test("下载失败文案不臆断网络原因，只给重试与发布页入口", () => {
  assert.match(source, /下载更新失败，请重试或前往发布页手动下载。/);
  assert.doesNotMatch(source, /下载更新失败，请检查网络/);
});

test("live region 只播报低频状态，高频百分比移到 aria-hidden 独立节点", () => {
  // downloading 摘要必须是纯字面量：拼百分比会让 aria-live 随每个 Progress 事件播报。
  const downloadingCase =
    /case\s*['"]downloading['"]\s*:\s*([\s\S]*?)case\s*['"]installing['"]/.exec(
      source,
    );
  assert.ok(downloadingCase, "找不到 updateSummary 的 downloading 分支");
  assert.match(downloadingCase[1], /return\s*['"]正在下载更新…['"];/);
  assert.doesNotMatch(downloadingCase[1], /%/);

  // 百分比展示节点对读屏隐藏；进度值改由 progressbar 的 aria-valuetext 表达。
  assert.match(source, /class="about-update-percent"\s+aria-hidden="true"/);
  assert.match(source, /\{\{\s*downloadProgress\s*\?\?\s*0\s*\}\}\s*%/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /:aria-valuetext="[^"]*已下载[^"]*"/);
});
