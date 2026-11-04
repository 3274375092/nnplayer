// updater 清单生成契约：平台键、签名 trim、URL 编码、缺失签名失败。
// 发布流程最后一步调用同一个 buildUpdaterManifest，测试不依赖 GitHub。

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildUpdaterManifest } from "../tools/updater-manifest.mjs";

const execFileAsync = promisify(execFile);
const toolPath = fileURLToPath(
  new URL("../tools/updater-manifest.mjs", import.meta.url),
);
const baseUrl = "https://github.com/owner/repo/releases/download/v0.6.0";

async function withTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "nnplayer-updater-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeSignature(dir, artifactName, signature) {
  const artifactPath = join(dir, artifactName);
  await writeFile(`${artifactPath}.sig`, `${signature}\n`, "utf8");
  return artifactPath;
}

test("生成 windows 与 linux 平台条目，签名去掉尾随换行", async (t) => {
  const dir = await withTempDir(t);
  const win = await writeSignature(
    dir,
    "nnplayer_0.6.0_x64-setup.exe",
    "win-sig",
  );
  const deb = await writeSignature(
    dir,
    "nnplayer_0.6.0_amd64.deb",
    "deb-sig",
  );

  const manifest = await buildUpdaterManifest({
    version: "0.6.0",
    notes: "详见 https://github.com/owner/repo/releases/tag/v0.6.0",
    baseUrl,
    targets: [
      { target: "windows-x86_64", path: win },
      { target: "linux-x86_64-deb", path: deb },
    ],
  });

  assert.equal(manifest.version, "0.6.0");
  assert.equal(
    manifest.notes,
    "详见 https://github.com/owner/repo/releases/tag/v0.6.0",
  );
  assert.deepEqual(manifest.platforms, {
    "windows-x86_64": {
      signature: "win-sig",
      url: `${baseUrl}/nnplayer_0.6.0_x64-setup.exe`,
    },
    "linux-x86_64-deb": {
      signature: "deb-sig",
      url: `${baseUrl}/nnplayer_0.6.0_amd64.deb`,
    },
  });
});

test("直接传 .sig 路径、base URL 尾斜杠与空格文件名都正确", async (t) => {
  const dir = await withTempDir(t);
  const appImage = await writeSignature(dir, "my app.AppImage", "app-sig");

  const manifest = await buildUpdaterManifest({
    version: "0.6.0",
    baseUrl: `${baseUrl}/`,
    targets: [
      { target: "linux-x86_64", path: `${appImage}.sig` },
    ],
  });

  assert.deepEqual(manifest.platforms["linux-x86_64"], {
    signature: "app-sig",
    url: `${baseUrl}/my%20app.AppImage`,
  });
  assert.equal("notes" in manifest, false);
});

test("缺失签名文件时给出可定位的错误", async (t) => {
  const dir = await withTempDir(t);

  await assert.rejects(
    buildUpdaterManifest({
      version: "0.6.0",
      baseUrl,
      targets: [
        { target: "linux-x86_64-deb", path: join(dir, "missing.deb") },
      ],
    }),
    /missing updater signature: .*missing\.deb\.sig/,
  );
});

test("空签名文件不会生成空平台条目", async (t) => {
  const dir = await withTempDir(t);
  const deb = join(dir, "empty.deb");
  await writeFile(`${deb}.sig`, "\n", "utf8");

  await assert.rejects(
    buildUpdaterManifest({
      version: "0.6.0",
      baseUrl,
      targets: [{ target: "linux-x86_64-deb", path: deb }],
    }),
    /empty updater signature: .*empty\.deb\.sig/,
  );
});

test("重复 target 直接失败，不静默覆盖", async (t) => {
  const dir = await withTempDir(t);
  const deb = await writeSignature(dir, "dup.deb", "deb-sig");

  await assert.rejects(
    buildUpdaterManifest({
      version: "0.6.0",
      baseUrl,
      targets: [
        { target: "linux-x86_64-deb", path: deb },
        { target: "linux-x86_64-deb", path: deb },
      ],
    }),
    /duplicate updater target: linux-x86_64-deb/,
  );
});

test("CLI 写出可被 updater 读取的 latest.json", async (t) => {
  const dir = await withTempDir(t);
  const win = await writeSignature(
    dir,
    "nnplayer_0.6.0_x64-setup.exe",
    "win-sig",
  );
  const deb = await writeSignature(
    dir,
    "nnplayer_0.6.0_amd64.deb",
    "deb-sig",
  );
  const out = join(dir, "latest.json");

  await execFileAsync(process.execPath, [
    toolPath,
    "--version",
    "0.6.0",
    "--notes",
    "详见 release",
    "--base-url",
    baseUrl,
    "--out",
    out,
    "--target",
    `windows-x86_64=${win}`,
    "--target",
    `linux-x86_64-deb=${deb}`,
  ]);

  const written = JSON.parse(await readFile(out, "utf8"));
  assert.deepEqual(Object.keys(written.platforms).sort(), [
    "linux-x86_64-deb",
    "windows-x86_64",
  ]);
  assert.equal(written.platforms["windows-x86_64"].signature, "win-sig");
});
