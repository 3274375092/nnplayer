import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function compileTypeScriptModule(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  // "@/types/music" 只有 type-only import，转译后被擦除，无需替换。
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const {
  AUDIO_QUALITY_OPTIONS,
  DEFAULT_AUDIO_QUALITY,
  normalizeAudioQuality,
  readStoredAudioQuality,
  writeStoredAudioQuality,
  audioQualityOption,
  audioQualityRank,
  formatBitrate,
  formatBitrateShort,
  actualQualityShortLabel,
  formatActualQuality,
  isQualityDowngraded,
} = await import(await compileTypeScriptModule("../src/utils/audioQuality.ts"));

function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
  return store;
}

test("六档音质选项齐全且 value 唯一", () => {
  assert.deepEqual(
    AUDIO_QUALITY_OPTIONS.map((o) => o.value),
    ["standard", "higher", "exhigh", "lossless", "hires", "jymaster"],
  );
  assert.equal(new Set(AUDIO_QUALITY_OPTIONS.map((o) => o.value)).size, 6);
  for (const o of AUDIO_QUALITY_OPTIONS) {
    assert.ok(o.label && o.shortLabel && o.hint, `${o.value} 文案齐全`);
  }
});

test("normalizeAudioQuality：合法值原样，非法值回落默认档", () => {
  for (const o of AUDIO_QUALITY_OPTIONS) {
    assert.equal(normalizeAudioQuality(o.value), o.value);
  }
  // 环绕声等特效档不在可选范围。
  assert.equal(normalizeAudioQuality("sky"), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality("jyeffect"), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality("dolby"), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality(""), DEFAULT_AUDIO_QUALITY);
  // 用非默认档位的全大写形式：若实现意外大小写不敏感地接受，会得到
  // lossless 而不是默认 exhigh，断言才能区分“回落默认”与“大小写折叠”。
  assert.equal(normalizeAudioQuality("LOSSLESS"), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality(320000), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality(null), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality(undefined), DEFAULT_AUDIO_QUALITY);
  assert.equal(normalizeAudioQuality({ value: "lossless" }), DEFAULT_AUDIO_QUALITY);
});

test("持久化：写读回环，损坏值回落默认，localStorage 故障静默", () => {
  const prev = globalThis.localStorage;
  const store = stubLocalStorage();
  try {
    writeStoredAudioQuality("lossless");
    assert.equal(readStoredAudioQuality(), "lossless");

    // key 从桩里取，不复制生产字面量：key 漂移时这里直接失败。
    const [storedKey] = store.keys();
    assert.ok(storedKey, "写档位后应记录存储 key");
    store.set(storedKey, "sky"); // 旧版本/手改的非法值
    assert.equal(readStoredAudioQuality(), DEFAULT_AUDIO_QUALITY);

    store.clear();
    assert.equal(readStoredAudioQuality(), DEFAULT_AUDIO_QUALITY);

    globalThis.localStorage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    assert.equal(readStoredAudioQuality(), DEFAULT_AUDIO_QUALITY);
    assert.doesNotThrow(() => writeStoredAudioQuality("hires"));
  } finally {
    globalThis.localStorage = prev;
  }
});

test("audioQualityOption 返回对应选项元数据", () => {
  assert.equal(audioQualityOption("exhigh").shortLabel, "320K");
  assert.equal(audioQualityOption("jymaster").label, "超清母带");
});

test("formatBitrate：bps → kbps 文本，未知值返回 null", () => {
  assert.equal(formatBitrate(320_000), "320 kbps");
  assert.equal(formatBitrate(999_000), "999 kbps");
  assert.equal(formatBitrate(0), null); // 后端 br 缺失时的未知标记
  assert.equal(formatBitrate(-1), null);
  assert.equal(formatBitrate(Number.NaN), null);
});

test("audioQualityRank 与选项顺序一致，用于判断降级", () => {
  assert.deepEqual(
    AUDIO_QUALITY_OPTIONS.map((o) => audioQualityRank(o.value)),
    [0, 1, 2, 3, 4, 5],
  );
});

test("formatBitrateShort：压缩为徽标短文本，未知值返回 null", () => {
  assert.equal(formatBitrateShort(320_000), "320K");
  assert.equal(formatBitrateShort(1_411_200), "1411K");
  assert.equal(formatBitrateShort(0), null);
  assert.equal(formatBitrateShort(null), null);
  assert.equal(formatBitrateShort(Number.NaN), null);
});

test("actualQualityShortLabel：档位优先，档位未知时才用码率", () => {
  assert.equal(actualQualityShortLabel("exhigh", 999_000), "320K");
  assert.equal(actualQualityShortLabel("hires", null), "Hi-Res");
  assert.equal(actualQualityShortLabel(null, 320_000), "320K");
  assert.equal(actualQualityShortLabel(null, 0), null);
  assert.equal(actualQualityShortLabel(null, null), null);
});

test("formatActualQuality：完整描述实际档位与码率，未知不谎报", () => {
  assert.equal(formatActualQuality("exhigh", 320_000), "极高 · 320 kbps");
  assert.equal(formatActualQuality("lossless", 0), "无损");
  assert.equal(formatActualQuality(null, 320_000), "320 kbps（档位未知）");
  assert.equal(formatActualQuality(null, null), null);
});

test("isQualityDowngraded：仅实际档位已知且低于所选时成立", () => {
  assert.equal(isQualityDowngraded("exhigh", "lossless"), true);
  assert.equal(isQualityDowngraded("standard", "jymaster"), true);
  assert.equal(isQualityDowngraded("lossless", "lossless"), false);
  // 实际档位比所选更高或未知时不能误报降级。
  assert.equal(isQualityDowngraded("lossless", "exhigh"), false);
  assert.equal(isQualityDowngraded(null, "lossless"), false);
});
