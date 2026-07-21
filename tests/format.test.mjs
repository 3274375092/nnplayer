import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/utils/format.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const format = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("fmtDuration formats whole minutes", () => {
  assert.equal(format.fmtDuration(0), "00:00");
  assert.equal(format.fmtDuration(60), "01:00");
  assert.equal(format.fmtDuration(120), "02:00");
  assert.equal(format.fmtDuration(3600), "60:00");
});

test("fmtDuration formats seconds with leading zero", () => {
  assert.equal(format.fmtDuration(5), "00:05");
  assert.equal(format.fmtDuration(65), "01:05");
  assert.equal(format.fmtDuration(125), "02:05");
});

test("fmtDuration handles fractional seconds", () => {
  assert.equal(format.fmtDuration(1.9), "00:01");
  assert.equal(format.fmtDuration(60.999), "01:00");
});

test("fmtDuration handles edge cases", () => {
  assert.equal(format.fmtDuration(-1), "00:00");
  assert.equal(format.fmtDuration(Number.NaN), "00:00");
  assert.equal(format.fmtDuration(Number.POSITIVE_INFINITY), "00:00");
});

test("fmtDurationMs converts milliseconds to mm:ss", () => {
  assert.equal(format.fmtDurationMs(0), "00:00");
  assert.equal(format.fmtDurationMs(1000), "00:01");
  assert.equal(format.fmtDurationMs(60000), "01:00");
  assert.equal(format.fmtDurationMs(65000), "01:05");
  assert.equal(format.fmtDurationMs(654321), "10:54");
});

test("fmtDurationMs handles edge cases", () => {
  assert.equal(format.fmtDurationMs(-1), "00:00");
  assert.equal(format.fmtDurationMs(Number.NaN), "00:00");
  assert.equal(format.fmtDurationMs(Number.POSITIVE_INFINITY), "00:00");
});

test("fmtDuration large values", () => {
  assert.equal(format.fmtDuration(3661), "61:01");
  assert.equal(format.fmtDuration(9999), "166:39");
});
