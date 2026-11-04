// 软件内更新流程的源码契约：Node 环境没有 Vue/Tauri runtime，
// 这里锁定「用户确认后下载安装 + 重启」这条接线不被退回成只打开发布页。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/AboutDialog.vue", import.meta.url),
  "utf8",
);

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
  assert.match(source, /if \(busyUpdate\.value\) return;/);
  assert.match(source, /:disabled="busyUpdate"/);
});

test("下载进度只在有 Content-Length 时显示百分比", () => {
  assert.match(source, /downloadPercent\(receivedBytes, totalBytes\)/);
  assert.match(
    source,
    /updateStatus === 'downloading' && downloadProgress !== null/,
  );
});
