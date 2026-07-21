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

const sync = await loadTypeScriptModule("../src/lyrics/desktopLyricsSync.ts");

test("Lyric Session generation advances without persisted storage", () => {
  const wallTimeMs = 1_700_000_000_000;

  assert.equal(
    sync.computeNextLyricSessionGeneration([], wallTimeMs),
    wallTimeMs + 1,
  );
  assert.equal(
    sync.computeNextLyricSessionGeneration(
      [wallTimeMs + 4, undefined, Number.NaN],
      wallTimeMs,
    ),
    wallTimeMs + 5,
  );
});

function clock(overrides = {}) {
  return {
    sessionId: "session-a",
    sessionGeneration: 1,
    songId: 101,
    sequence: 1,
    timelineRevision: 1,
    mediaGeneration: 1,
    positionMs: 1200,
    sampledAt: 10_000,
    playbackRate: 1,
    seekRevision: 0,
    playing: true,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    ...clock(),
    songName: "Song A",
    artists: "Artist",
    lines: [{ time: 1000, text: "A" }],
    tokensByLine: [[]],
    ...overrides,
  };
}

test("an idle Timeline Snapshot cannot publish queued-song metadata or lyrics", () => {
  const result = sync.buildDesktopLyricsTimelineSnapshot(
    clock({ songId: null, playing: false }),
    {
      songId: 101,
      timelineSongId: 101,
      songName: "Queued Song",
      artists: "Queued Artist",
      lines: [{ time: 0, text: "must not leak" }],
      tokensByLine: [[{ char: "x", startMs: 0, endMs: 100 }]],
    },
  );

  assert.ok(result);
  assert.equal(result.songId, null);
  assert.equal(result.songName, "");
  assert.equal(result.artists, "");
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.tokensByLine, []);
});

test("an idle Timeline Snapshot clears previously ready lyrics atomically", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot());

  receiver.receiveSnapshot(snapshot({
    songId: null,
    sequence: 2,
    timelineRevision: 2,
    playing: false,
    songName: "Stale Song",
    artists: "Stale Artist",
    lines: [{ time: 0, text: "stale" }],
    tokensByLine: [[{ char: "s", startMs: 0, endMs: 100 }]],
  }));

  assert.equal(receiver.state.status, "idle");
  assert.equal(receiver.state.songId, null);
  assert.equal(receiver.state.songName, "");
  assert.equal(receiver.state.artists, "");
  assert.deepEqual(receiver.state.lines, []);
  assert.deepEqual(receiver.state.tokensByLine, []);
});

test("a new-song Clock Anchor suppresses the stale Lyric Timeline", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot());
  assert.equal(receiver.state.status, "ready");

  receiver.receiveClock(clock({
    songId: 202,
    sequence: 2,
    timelineRevision: 2,
    positionMs: 300,
  }));

  assert.equal(receiver.state.status, "syncing");
  assert.equal(receiver.state.songId, 202);
  assert.deepEqual(receiver.state.lines, []);

  receiver.receiveSnapshot(snapshot({
    songId: 202,
    sequence: 3,
    timelineRevision: 2,
    songName: "Song B",
    lines: [{ time: 0, text: "B" }],
  }));

  assert.equal(receiver.state.status, "ready");
  assert.equal(receiver.state.songName, "Song B");
  assert.deepEqual(receiver.state.lines, [{ time: 0, text: "B" }]);
});

test("a delayed old-song Timeline Snapshot cannot replace a newer Clock Anchor", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot({ sequence: 1 }));
  receiver.receiveClock(clock({
    songId: 202,
    sequence: 3,
    timelineRevision: 2,
    positionMs: 400,
  }));

  receiver.receiveSnapshot(snapshot({ sequence: 2 }));

  assert.equal(receiver.state.status, "syncing");
  assert.equal(receiver.state.songId, 202);
  assert.equal(receiver.state.positionMs, 400);
  assert.deepEqual(receiver.state.lines, []);
});

test("a matching Timeline Snapshot fills lyrics without rewinding a newer Clock Anchor", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveClock(clock({
    songId: 202,
    sequence: 3,
    timelineRevision: 2,
    mediaGeneration: 4,
    positionMs: 400,
  }));

  receiver.receiveSnapshot(snapshot({
    songId: 202,
    sequence: 2,
    timelineRevision: 2,
    mediaGeneration: 3,
    songName: "Song B",
    lines: [{ time: 0, text: "B" }],
    positionMs: 100,
  }));

  assert.equal(receiver.state.status, "ready");
  assert.equal(receiver.state.songName, "Song B");
  assert.equal(receiver.state.sequence, 3);
  assert.equal(receiver.state.mediaGeneration, 4);
  assert.equal(receiver.state.positionMs, 400);
});

test("a confirmed newer Lyric Session permanently rejects packets from the old session", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot({ sequence: 100 }));
  receiver.receiveSnapshot(snapshot({
    sessionId: "session-b",
    sessionGeneration: 2,
    songId: 202,
    sequence: 1,
    timelineRevision: 1,
    songName: "Song B",
    lines: [{ time: 0, text: "B" }],
  }));

  receiver.receiveClock(clock({ sequence: 101, positionMs: 999 }));

  assert.equal(receiver.state.sessionId, "session-b");
  assert.equal(receiver.state.sessionGeneration, 2);
  assert.equal(receiver.state.songName, "Song B");
  assert.equal(receiver.state.positionMs, 1200);
});

test("a stale Clock Anchor cannot rewind Playback Position", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot({ sequence: 5 }));
  receiver.receiveClock(clock({ sequence: 6, positionMs: 1600 }));
  receiver.receiveClock(clock({ sequence: 5, positionMs: 100 }));

  assert.equal(receiver.state.sequence, 6);
  assert.equal(receiver.state.positionMs, 1600);
});

test("Timeline Snapshot requests can start a new retry cycle after every attempt is lost", () => {
  const requests = [];
  const scheduled = [];
  const controller = sync.createSnapshotRequestController({
    request(songId) {
      requests.push(songId);
    },
    schedule(_delayMs, task) {
      scheduled.push(task);
      return task;
    },
    cancel() {},
  });

  controller.ensure(202);
  while (scheduled.length > 0) scheduled.shift()();
  controller.ensure(202);

  assert.deepEqual(requests, [202, 202, 202, 202]);
});

test("an anchored playback clock compensates transport once and advances monotonically", () => {
  const anchoredClock = sync.createAnchoredPlaybackClock();
  const result = anchoredClock.accept(
    clock({ positionMs: 1000, sampledAt: 10_000, playbackRate: 2 }),
    { wallTimeMs: 10_050, monotonicTimeMs: 200 },
  );

  assert.equal(result.needsRefresh, false);
  assert.equal(anchoredClock.positionAt(700), 2100);
});

test("a stale Timeline Snapshot cannot replace a newer revision of the same song", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot({
    sequence: 1,
    timelineRevision: 1,
    lines: [{ time: 0, text: "old" }],
  }));
  receiver.receiveSnapshot(snapshot({
    sequence: 3,
    timelineRevision: 2,
    lines: [{ time: 0, text: "new" }],
  }));
  receiver.receiveSnapshot(snapshot({
    sequence: 2,
    timelineRevision: 1,
    lines: [{ time: 0, text: "old" }],
  }));

  assert.equal(receiver.state.timelineRevision, 2);
  assert.deepEqual(receiver.state.lines, [{ time: 0, text: "new" }]);
});

test("an invalid Lyric Session packet cannot take ownership", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot());

  receiver.receiveClock(clock({
    sessionId: "",
    sessionGeneration: 2,
    songId: 202,
    sequence: 2,
  }));

  assert.equal(receiver.state.sessionId, "session-a");
  assert.equal(receiver.state.songId, 101);
});

test("an invalid Clock Anchor cannot corrupt a ready Lyric Frame", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot());

  receiver.receiveClock(clock({ sequence: 2, positionMs: Number.NaN }));

  assert.equal(receiver.state.status, "ready");
  assert.equal(receiver.state.positionMs, 1200);
});

test("a malformed Timeline Snapshot is rejected atomically", () => {
  const malformed = [
    { songName: null },
    { artists: null },
    { lines: null },
    { lines: [{ time: Number.NaN, text: "bad" }] },
    { tokensByLine: null },
    {
      tokensByLine: [[{ char: "x", startMs: 100, endMs: 50 }]],
    },
  ];

  for (const override of malformed) {
    const receiver = sync.createDesktopLyricsReceiver();
    receiver.receiveSnapshot(snapshot());
    const before = receiver.state;

    receiver.receiveSnapshot(snapshot({ sequence: 2, ...override }));

    assert.strictEqual(receiver.state, before);
  }
});

test("an anchored clock refreshes when transport age exceeds max", () => {
  const anchoredClock = sync.createAnchoredPlaybackClock(500);
  const result = anchoredClock.accept(
    clock({ positionMs: 10000, sampledAt: 5000, playbackRate: 1, playing: true }),
    { wallTimeMs: 20000, monotonicTimeMs: 15000 },
  );
  assert.equal(result.needsRefresh, true);
  const pos = anchoredClock.positionAt(16000);
  assert.ok(pos >= 9500, "position near anchor, not full wall-time compensation");
});

test("a stale clock anchor triggers refresh and resets monotonic base", () => {
  const anchoredClock = sync.createAnchoredPlaybackClock(500);
  anchoredClock.accept(
    clock({ positionMs: 10000, sampledAt: 9000, playbackRate: 1, playing: true }),
    { wallTimeMs: 9200, monotonicTimeMs: 1000 },
  );
  const result2 = anchoredClock.accept(
    clock({ positionMs: 30000, sampledAt: 5000, playbackRate: 1, playing: true }),
    { wallTimeMs: 30000, monotonicTimeMs: 2000 },
  );
  assert.equal(result2.needsRefresh, true);
  const pos2 = anchoredClock.positionAt(2500);
  assert.ok(pos2 >= 29500 && pos2 <= 31000);
});

test("Snapshot request resolves for matching song and ignores mismatched songs", () => {
  const pending = [];
  const runtime = {
    request: (id) => pending.push({ type: "request", id }),
    schedule: (ms, fn) => { const h = setTimeout(fn, ms); return h; },
    cancel: (h) => clearTimeout(h),
  };
  const ctrl = sync.createSnapshotRequestController(runtime, [500]);
  ctrl.ensure(101);
  assert.equal(pending.length, 1);
  ctrl.resolve(101);
  ctrl.ensure(202);
  ctrl.resolve(303);
  assert.ok(pending.length >= 1, "mismatched resolve does not clear");
  ctrl.dispose();
});

test("Snapshot request controller disposes and blocks further ensures", () => {
  let calls = 0;
  const rt = { request: () => { calls++; }, schedule: () => 1, cancel: () => {} };
  const ctrl = sync.createSnapshotRequestController(rt);
  ctrl.dispose();
  ctrl.ensure(101);
  assert.equal(calls, 0, "disposed controller never calls request");
});

test("an empty-lyric snapshot stays ready, not reset to syncing", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot({ songId: 202, sequence: 1, timelineRevision: 1, lines: [], tokensByLine: [] }));
  assert.equal(receiver.state.status, "ready");
  receiver.receiveClock(clock({ songId: 202, sequence: 2, timelineRevision: 1, positionMs: 500, playing: true }));
  assert.equal(receiver.state.status, "ready", "empty lyrics stay ready on clock");
});

test("a second clock anchor overrides the old monotonic base", () => {
  const anchoredClock = sync.createAnchoredPlaybackClock();
  anchoredClock.accept(
    clock({ positionMs: 10000, sampledAt: 1000, playbackRate: 1, playing: true }),
    { wallTimeMs: 1200, monotonicTimeMs: 1000 },
  );
  anchoredClock.accept(
    clock({ positionMs: 20000, sampledAt: 5000, playbackRate: 1, playing: true }),
    { wallTimeMs: 5200, monotonicTimeMs: 2000 },
  );
  const pos = anchoredClock.positionAt(3000);
  assert.ok(pos >= 20000, "second anchor overrides position base");
});

test("same-generation same-song clock-before-snapshot sequence keeps ready", () => {
  const receiver = sync.createDesktopLyricsReceiver();
  receiver.receiveSnapshot(snapshot({ songId: 202, sequence: 1, timelineRevision: 1 }));
  receiver.receiveClock(clock({ sessionGeneration: 2, songId: 202, sequence: 3, timelineRevision: 2 }));
  assert.equal(receiver.state.status, "syncing");
  receiver.receiveSnapshot(snapshot({ sessionGeneration: 2, songId: 202, sequence: 4, timelineRevision: 2 }));
  assert.equal(receiver.state.status, "ready");
  const before = { ...receiver.state };
  receiver.receiveClock(clock({ sessionGeneration: 2, songId: 202, sequence: 2, timelineRevision: 2 }));
  assert.deepEqual({ ...receiver.state }, before, "old sequence is no-op");
});
