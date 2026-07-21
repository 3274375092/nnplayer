import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const transport = await loadTypeScriptModule(
  "../src/lyrics/desktopLyricsTransport.ts",
);

function createTimerRuntime() {
  let now = 0;
  let nextHandle = 0;
  const tasks = new Map();
  const requests = [];

  const runtime = {
    now: () => now,
    request: (songId) => requests.push(songId),
    schedule: (delayMs, task) => {
      const handle = ++nextHandle;
      tasks.set(handle, { at: now + delayMs, task });
      return handle;
    },
    cancel: (handle) => tasks.delete(handle),
  };

  function advanceTo(target) {
    while (true) {
      const next = [...tasks.entries()]
        .filter(([, scheduled]) => scheduled.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [handle, scheduled] = next;
      tasks.delete(handle);
      now = scheduled.at;
      scheduled.task();
    }
    now = target;
  }

  return { runtime, requests, advanceTo };
}

test("Timeline Snapshot recovery starts new retry cycles until transport returns", () => {
  const timer = createTimerRuntime();
  const recovery = transport.createDesktopLyricsSnapshotRecovery(
    timer.runtime,
    {
      burstRetryDelaysMs: [500, 1500],
      staleAfterMs: 5000,
      retryEveryMs: 2000,
    },
  );

  recovery.start(101);
  timer.advanceTo(1500);
  assert.deepEqual(timer.requests, [101, 101, 101]);

  recovery.noteAlive(202);
  recovery.resolve();
  timer.advanceTo(6499);
  assert.deepEqual(timer.requests, [101, 101, 101]);

  timer.advanceTo(6500);
  timer.advanceTo(8500);
  assert.deepEqual(timer.requests, [101, 101, 101, 202, 202, 202, 202]);

  recovery.dispose();
  timer.advanceTo(20_000);
  assert.equal(timer.requests.length, 7);
});

test("listener registration rolls back every completed listener on failure", async () => {
  const released = [];

  await assert.rejects(
    () =>
      transport.registerDesktopLyricsListenersAtomically([
        async () => () => released.push("snapshot"),
        async () => {
          throw new Error("Clock Anchor listener failed");
        },
        async () => () => released.push("appearance"),
      ]),
    /Clock Anchor listener failed/,
  );

  assert.deepEqual(released.sort(), ["appearance", "snapshot"]);
});
