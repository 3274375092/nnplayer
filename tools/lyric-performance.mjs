import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import ts from "typescript";

async function loadTypeScriptModule(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const parser = await loadTypeScriptModule("../src/utils/lrcParser.ts");
const timing = await loadTypeScriptModule("../src/utils/lyricTiming.ts");

function makeLrc(lineCount) {
  return Array.from({ length: lineCount }, (_, index) => {
    const minutes = String(Math.floor(index / 600)).padStart(2, "0");
    const seconds = String(Math.floor((index % 600) / 10)).padStart(2, "0");
    const centiseconds = String(index % 100).padStart(2, "0");
    return `[${minutes}:${seconds}.${centiseconds}]line ${index} performance sample`;
  }).join("\n");
}

function makeYrc(lineCount) {
  return Array.from({ length: lineCount }, (_, index) => {
    const start = index * 1000;
    const words = Array.from({ length: 8 }, (_, word) =>
      `(${start + word * 100},100,0)word${word}`,
    ).join("");
    return `[${start},800]${words}`;
  }).join("\n");
}

function sample(name, task) {
  const start = performance.now();
  const result = task();
  const elapsed = performance.now() - start;
  return { name, elapsedMs: Number(elapsed.toFixed(3)), result };
}

for (const lineCount of [200, 1000, 5000]) {
  const lrc = makeLrc(lineCount);
  const yrc = makeYrc(lineCount);
  const lrcResult = sample(`parseLrc ${lineCount} lines`, () => parser.parseLrc(lrc));
  const yrcResult = sample(`parseYrc ${lineCount} lines`, () => parser.parseYrc(yrc));
  const alignResult = sample(`align ${lineCount} lines`, () =>
    timing.alignLyricTimelines(yrcResult.result.map((line) => ({
      time: line.time,
      text: parser.getYrcLineText(line),
    })), lrcResult.result)
  );
  console.log(JSON.stringify({
    name: `lyrics-${lineCount}`,
    inputChars: lrc.length + yrc.length,
    measurements: [lrcResult, yrcResult, alignResult].map(({ name, elapsedMs }) => ({ name, elapsedMs })),
  }));
}

const largeYrc = makeYrc(1000);
console.log(JSON.stringify({
  name: "parseYrc 50k-character sample",
  inputChars: largeYrc.length,
  measurements: [sample("parseYrc 50k-character sample", () => parser.parseYrc(largeYrc))]
    .map(({ name, elapsedMs }) => ({ name, elapsedMs })),
}));
