import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileStyle, parse } from "vue/compiler-sfc";

const filename = new URL(
  "../src/components/GlobalNotice.vue",
  import.meta.url,
);
const source = await readFile(filename, "utf8");
const { descriptor } = parse(source, { filename: filename.pathname });

const compiledCss = descriptor.styles
  .map((style) =>
    compileStyle({
      source: style.content,
      filename: filename.pathname,
      id: "data-v-queue-test",
      scoped: Boolean(style.scoped),
    }).code,
  )
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

test("queue-open notice suppression never hides the whole document", () => {
  // 打开抽屉不能把 body 本身也设为不可见。
  assert.doesNotMatch(
    compiledCss,
    /body\.queue-drawer-open\s*\{\s*visibility:\s*hidden;?\s*\}/,
  );

  // 只隐藏与抽屉内恢复状态重复的那条全局播放提示。
  assert.match(
    compiledCss,
    /body\.queue-drawer-open\s+\.notice--suppress-behind-queue\s*\{\s*visibility:\s*hidden;?\s*\}/,
  );
});
