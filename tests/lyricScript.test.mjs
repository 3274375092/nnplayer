import assert from "node:assert/strict";
import { test } from "node:test";

import { langForLyric } from "../src/utils/lyricScript.ts";

test("空值与纯符号返回 undefined", () => {
  assert.equal(langForLyric(""), undefined);
  assert.equal(langForLyric(null), undefined);
  assert.equal(langForLyric(undefined), undefined);
  assert.equal(langForLyric("   "), undefined);
  assert.equal(langForLyric("♪ ♪ ♪"), undefined);
  assert.equal(langForLyric("2026 - 11 - 03"), undefined);
});

test("中文歌词按 zh 处理", () => {
  assert.equal(langForLyric("我的秘密在你面前"), "zh");
  assert.equal(langForLyric("你不要那样看着我的眼睛"), "zh");
});

test("日文假名优先于汉字按 ja 处理", () => {
  assert.equal(langForLyric("君の名前を呼ぶ"), "ja");
  assert.equal(langForLyric("さよなら"), "ja");
  assert.equal(langForLyric("カタカナだけ"), "ja");
  assert.equal(langForLyric("漢字とひらがな"), "ja");
});

test("韩文按 ko 处理", () => {
  assert.equal(langForLyric("너의 이름을 부르면"), "ko");
});

test("拉丁字母歌词按 en 处理", () => {
  assert.equal(langForLyric("come on babe girl please stop it"), "en");
  assert.equal(langForLyric("OK Overture"), "en");
});

test("混合文字按出现的最强信号判定", () => {
  assert.equal(langForLyric("baby我只是想有你陪"), "zh");
  assert.equal(langForLyric("Forever 君と"), "ja");
});
