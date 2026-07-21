import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function compileTypeScriptModule(relativePath, replacements = new Map()) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  let compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  for (const [specifier, replacement] of replacements) {
    compiled = compiled.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  }
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const lyricTimingUrl = await compileTypeScriptModule(
  "../src/utils/lyricTiming.ts",
);
const lyricFrameUrl = await compileTypeScriptModule(
  "../src/lyrics/lyricFrame.ts",
  new Map([["@/utils/lyricTiming", lyricTimingUrl]]),
);
const lyricFrame = await import(lyricFrameUrl);

test("Lyric Frame selects the last line at a shared timestamp", () => {
  const currentTokens = [{ char: "A", startMs: 0, endMs: 500 }];
  const timeline = {
    lines: [
      { time: 1000, text: "first" },
      { time: 2000, text: "fallback" },
      { time: 2000, text: "precise" },
    ],
    tokensByLine: [[], [], currentTokens],
  };

  const frame = lyricFrame.projectLyricFrame(timeline, 2250);

  assert.equal(frame.activeLineIndex, 2);
  assert.equal(frame.lineProgressMs, 250);
  assert.equal(frame.tokens, currentTokens);
});

test("Lyric Frame preserves sub-millisecond line progress", () => {
  const frame = lyricFrame.projectLyricFrame(
    { lines: [{ time: 1000, text: "line" }], tokensByLine: [[]] },
    1250.75,
  );

  assert.equal(frame.lineProgressMs, 250.75);
});

test("Karaoke projection reuses token arrays and objects across Playback Positions", () => {
  const projector = lyricFrame.createKaraokeFrameProjector();
  const source = [
    { char: "A", startMs: 0, endMs: 500 },
    { char: "B", startMs: 500, endMs: 1000 },
  ];

  const firstFrame = projector.project(source, 250);
  const firstTokens = firstFrame.tokens;
  const firstToken = firstTokens[0];
  assert.deepEqual(firstTokens.map((token) => token.progress), [0.5, 0]);

  const secondFrame = projector.project(source, 750);
  assert.notEqual(secondFrame, firstFrame);
  assert.equal(secondFrame.tokens, firstTokens);
  assert.equal(secondFrame.tokens[0], firstToken);
  assert.deepEqual(secondFrame.tokens.map((token) => token.progress), [1, 0.5]);
});

test("Karaoke projectors isolate consumers at different Playback Positions", () => {
  const source = [{ char: "A", startMs: 0, endMs: 1000 }];
  const mainWindow = lyricFrame.createKaraokeFrameProjector();
  const desktopWindow = lyricFrame.createKaraokeFrameProjector();

  const mainFrame = mainWindow.project(source, 250);
  const desktopFrame = desktopWindow.project(source, 750);

  assert.notEqual(mainFrame.tokens, desktopFrame.tokens);
  assert.equal(mainFrame.tokens[0].progress, 0.25);
  assert.equal(desktopFrame.tokens[0].progress, 0.75);
});

test("Karaoke projection rebuilds render tokens only when the active source changes", () => {
  const projector = lyricFrame.createKaraokeFrameProjector();
  const firstSource = [{ char: "A", startMs: 0, endMs: 500 }];
  const secondSource = [{ char: "B", startMs: 0, endMs: 500 }];

  const firstTokens = projector.project(firstSource, 100).tokens;
  const secondTokens = projector.project(secondSource, 100).tokens;

  assert.notEqual(secondTokens, firstTokens);
  assert.equal(secondTokens[0].char, "B");
  assert.equal(firstTokens[0].char, "A");
});
