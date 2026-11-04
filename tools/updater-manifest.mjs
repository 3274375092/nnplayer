// 生成 Tauri updater 的 latest.json。
//
// 发布流程里这是唯一写 latest.json 的地方：Windows / Linux 构建 job 只负责
// 上传安装包和 .sig，最后这个工具把所有平台的签名合并成一份清单。
//
// Linux 必须同时写入 deb / rpm / AppImage 的 target。tauri-plugin-updater
// 会先按 `linux-x86_64-<installer>` 查找，再回落到 `linux-x86_64`；如果清单
// 里只有 windows-x86_64，Linux 端会在版本比较之前就抛 TargetsNotFound。

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SIGNATURE_SUFFIX = ".sig";

function signaturePathFor(path) {
  return path.endsWith(SIGNATURE_SUFFIX) ? path : `${path}${SIGNATURE_SUFFIX}`;
}

function artifactNameFromSignaturePath(signaturePath) {
  const artifactName = basename(signaturePath).slice(0, -SIGNATURE_SUFFIX.length);
  if (!artifactName) {
    throw new Error(`invalid updater signature path: ${signaturePath}`);
  }
  return artifactName;
}

function assetUrl(baseUrl, artifactName) {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(artifactName)}`;
}

/**
 * 读取每个 target 的 .sig，生成 latest.json 的 platforms 映射。
 *
 * `targets` 是 [{ target, path }]，path 可以指向安装包，也可以直接指向 .sig；
 * 传安装包时会自动补 `.sig`。签名文件只做 trim，不做格式转换。
 */
export async function buildUpdaterManifest({
  version,
  notes,
  baseUrl,
  targets,
}) {
  if (!version?.trim()) {
    throw new Error("missing updater manifest version");
  }
  if (!baseUrl?.trim()) {
    throw new Error("missing updater manifest base URL");
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("missing updater targets");
  }

  const platforms = {};
  for (const { target, path } of targets) {
    if (!target?.trim()) {
      throw new Error("empty updater target name");
    }
    if (!path?.trim()) {
      throw new Error(`missing artifact path for updater target ${target}`);
    }
    if (Object.hasOwn(platforms, target)) {
      throw new Error(`duplicate updater target: ${target}`);
    }

    const signaturePath = signaturePathFor(path);
    const artifactName = artifactNameFromSignaturePath(signaturePath);
    let signature;
    try {
      signature = (await readFile(signaturePath, "utf8")).trim();
    } catch (error) {
      throw new Error(`missing updater signature: ${signaturePath}`, {
        cause: error,
      });
    }
    if (!signature) {
      throw new Error(`empty updater signature: ${signaturePath}`);
    }

    platforms[target] = {
      signature,
      url: assetUrl(baseUrl, artifactName),
    };
  }

  const manifest = { version: version.trim() };
  if (notes?.trim()) {
    manifest.notes = notes.trim();
  }
  manifest.platforms = platforms;
  return manifest;
}

function parseTargetArg(raw) {
  const separator = raw.indexOf("=");
  if (separator <= 0 || separator === raw.length - 1) {
    throw new Error(`invalid --target "${raw}", expected <platform>=<path>`);
  }
  return {
    target: raw.slice(0, separator),
    path: raw.slice(separator + 1),
  };
}

async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "string" },
      notes: { type: "string" },
      "base-url": { type: "string" },
      out: { type: "string" },
      target: { type: "string", multiple: true },
    },
  });

  if (!values.version) throw new Error("--version is required");
  if (!values["base-url"]) throw new Error("--base-url is required");
  if (!values.out) throw new Error("--out is required");
  if (!values.target?.length) throw new Error("at least one --target is required");

  const manifest = await buildUpdaterManifest({
    version: values.version,
    notes: values.notes,
    baseUrl: values["base-url"],
    targets: values.target.map(parseTargetArg),
  });

  await writeFile(values.out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `wrote ${values.out} with ${Object.keys(manifest.platforms).length} platform entries`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
