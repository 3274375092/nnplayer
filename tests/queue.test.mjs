import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/queue.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const { remainingQueueDurationMs } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

/** 只关心时长的最小 Song 形状。 */
const song = (duration) => ({ id: duration, name: "", artists: "", album: "", duration });

test("sums the whole queue when nothing has played", () => {
  const queue = [song(60_000), song(120_000), song(30_000)];
  assert.equal(remainingQueueDurationMs(queue, 0, 0), 210_000);
});

test("subtracts only the elapsed part of the current track", () => {
  const queue = [song(60_000), song(120_000), song(30_000)];
  assert.equal(remainingQueueDurationMs(queue, 1, 30), 120_000);
  assert.equal(remainingQueueDurationMs(queue, 1, 60), 90_000);
  assert.equal(remainingQueueDurationMs(queue, 1, 90), 60_000);
  assert.equal(remainingQueueDurationMs(queue, 1, 120), 30_000);
});

test("clamps elapsed time to the current track and never goes negative", () => {
  const queue = [song(60_000), song(30_000)];
  assert.equal(remainingQueueDurationMs(queue, 0, 600), 30_000);
  assert.equal(remainingQueueDurationMs(queue, 0, 10_000), 30_000);
  assert.equal(remainingQueueDurationMs(queue, 0, Number.NaN), 90_000);
  assert.equal(remainingQueueDurationMs(queue, 0, -5), 90_000);
});

test("handles an empty queue and an index without a current track", () => {
  assert.equal(remainingQueueDurationMs([], 0, 12), 0);
  assert.equal(remainingQueueDurationMs([], -1, 12), 0);
  // 没有当前曲时从队首算起（与队列抽屉的展示口径一致）。
  assert.equal(remainingQueueDurationMs([song(10_000), song(5_000)], -1, 3), 15_000);
});

test("tolerates missing durations and an out-of-range index", () => {
  // 后端异常载荷可能把 duration 整个省掉：`?? 0` 兜底必须让求和仍是数字
  // 而不是 NaN（此前这里传 duration: 0，根本没走到兜底分支）。
  const missingDuration = { id: 1, name: "", artists: "", album: "" };
  assert.equal(
    remainingQueueDurationMs([missingDuration, song(1_000)], -1, 0),
    1_000,
  );
  // 当前曲缺时长时，已播部分按 0 计，后面的曲目仍完整计入剩余时长。
  assert.equal(
    remainingQueueDurationMs([missingDuration, song(1_000)], 0, 5),
    1_000,
  );
  // 显式的 0 时长曲目仍是合法的零长曲，不应被当成缺失。
  assert.equal(
    remainingQueueDurationMs([{ ...missingDuration, duration: 0 }], 0, 5),
    0,
  );
  assert.equal(remainingQueueDurationMs([song(1_000)], 99, 5), 1_000);
});

test("treats non-finite elapsed time as zero", () => {
  // Infinity 与 NaN 共用 Number.isFinite 哨兵：已播时长非有限时按 0 处理，
  // 不能把整条队列的剩余时长算成 NaN 或负数。
  const queue = [song(60_000), song(30_000)];
  assert.equal(
    remainingQueueDurationMs(queue, 0, Number.POSITIVE_INFINITY),
    90_000,
  );
  assert.equal(
    remainingQueueDurationMs(queue, 0, Number.NEGATIVE_INFINITY),
    90_000,
  );
});
