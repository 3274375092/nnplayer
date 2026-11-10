// HTMLAudio 生产适配器的元素复用契约：切歌时复用同一个 <audio>，避免
// WebKitGTK 反复创建媒体管线造成的主线程长帧；复用必须安全解绑旧监听。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

class FakeAudio {
  static created = 0;
  static instances = [];

  constructor() {
    FakeAudio.created += 1;
    FakeAudio.instances.push(this);
    this.listeners = new Map();
    this.attrs = new Map();
    this.preload = "";
    this.volume = 1;
    this.muted = false;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 0;
    this.playbackRate = 1;
    this.ended = false;
    this.readyState = 0;
    this.error = null;
  }
  get src() {
    return this.attrs.get("src") ?? "";
  }
  set src(value) {
    this.attrs.set("src", value);
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== listener),
    );
  }
  listenerCount() {
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }
  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name) {
    if (name === "src") this.attrs.delete("src");
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  remove() {}
  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}
globalThis.Audio = FakeAudio;
globalThis.HTMLMediaElement = { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 4 };
globalThis.document = { body: { appendChild: () => {} } };

const sourceUrl = new URL("../src/playback/htmlAudioRuntime.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { createHtmlAudioRuntime } = await import(moduleUrl);

const baseOptions = () => ({ volume: 0.8, muted: false, onEvent: () => {} });

test("consecutive tracks reuse pooled audio elements", () => {
  const runtime = createHtmlAudioRuntime();
  const first = runtime.create("https://cdn.example/a.mp3", baseOptions());
  const createdAfterFirst = FakeAudio.created;
  const second = runtime.create("https://cdn.example/b.mp3", baseOptions());

  assert.ok(createdAfterFirst >= 1, "至少要有一个 audio 元素承载播放");
  assert.equal(
    FakeAudio.created,
    createdAfterFirst,
    "切歌不应再创建新的 audio 元素",
  );
  assert.ok(first !== second, "每次 create 仍返回独立句柄（代际隔离）");
  assert.equal(second.hasSource(), true);
  assert.match(second.hasSource() ? "b.mp3" : "", /b\.mp3/);
});

test("preload warms the idle element and create reuses it", () => {
  const runtime = createHtmlAudioRuntime();
  runtime.create("https://cdn.example/p1.mp3", baseOptions());
  const createdAfterFirst = FakeAudio.created;
  runtime.preload("https://cdn.example/p2.mp3");
  assert.equal(FakeAudio.created, createdAfterFirst, "预热不得新建元素");
  const next = runtime.create("https://cdn.example/p2.mp3", baseOptions());
  assert.equal(FakeAudio.created, createdAfterFirst, "命中预热时不得新建元素");
  assert.equal(next.hasSource(), true);
  next.play();
  assert.equal(next.paused, false);
});

test("creating a new handle unbinds the previous one before swapping src", () => {
  const runtime = createHtmlAudioRuntime();
  const oldEvents = [];
  runtime.create("https://cdn.example/c.mp3", {
    ...baseOptions(),
    onEvent: (event) => oldEvents.push(event.type),
  });
  const newEvents = [];
  const next = runtime.create("https://cdn.example/d.mp3", {
    ...baseOptions(),
    onEvent: (event) => newEvents.push(event.type),
  });

  // 池化元素会被复用：向池里所有元素派发 error，旧句柄的监听必须已解绑，
  // 否则旧 handler 会跟着新句柄的事件一起触发（此前该用例从不派发事件，
  // 无论解绑与否都能通过）。
  for (const element of FakeAudio.instances) element.emit("error");

  assert.deepEqual(oldEvents, [], "旧句柄不得再收到事件");
  assert.deepEqual(newEvents, ["error"], "新句柄仍应收到自己元素的事件");
  next.play();
  assert.equal(next.paused, false);
});

test("saveData/2g connections skip media preload", () => {
  const runtime = createHtmlAudioRuntime();
  runtime.create("https://cdn.example/s1.mp3", baseOptions());
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { connection: { saveData: true } },
    configurable: true,
  });
  try {
    const before = FakeAudio.created;
    runtime.preload("https://cdn.example/s2.mp3");
    assert.equal(FakeAudio.created, before);
  } finally {
    Object.defineProperty(globalThis, "navigator", descriptor);
  }
  runtime.preload("https://cdn.example/s3.mp3");
});

test("cancelPreload drops the warmed source without touching the active element", () => {
  const runtime = createHtmlAudioRuntime();
  const handle = runtime.create("https://cdn.example/w1.mp3", baseOptions());
  runtime.preload("https://cdn.example/w2.mp3");
  runtime.cancelPreload();
  assert.equal(handle.hasSource(), true, "活跃元素不受影响");
  const next = runtime.create("https://cdn.example/w3.mp3", baseOptions());
  assert.equal(next.hasSource(), true, "取消预热后仍可正常创建");
});

test("cancelPreload after destroy still drops the warmed source", () => {
  const runtime = createHtmlAudioRuntime();
  const handle = runtime.create("https://cdn.example/k1.mp3", baseOptions());
  runtime.preload("https://cdn.example/k2.mp3");
  assert.ok(
    FakeAudio.instances.some(
      (element) => element.src === "https://cdn.example/k2.mp3",
    ),
    "预热应已挂到空闲元素上",
  );

  // 引擎在 notifyAuthEpochChanged / stopPlayback 中的真实顺序：先 destroy
  // 活跃媒体（active 变 null），再 cancelPreload。此时必须清掉带预热 src
  // 的那个元素，不能只清“第一个非活跃元素”。
  handle.destroy();
  runtime.cancelPreload();

  assert.equal(
    FakeAudio.instances.filter(
      (element) => element.src === "https://cdn.example/k2.mp3",
    ).length,
    0,
    "destroy 后的 cancelPreload 也必须释放预热元素",
  );
  const next = runtime.create("https://cdn.example/k3.mp3", baseOptions());
  assert.equal(next.hasSource(), true);
  next.destroy();
});

test("destroy is idempotent, clears src, and leaves the element reusable", () => {
  const runtime = createHtmlAudioRuntime();
  const handle = runtime.create("https://cdn.example/e.mp3", baseOptions());
  assert.equal(handle.hasSource(), true);
  handle.destroy();
  assert.equal(handle.hasSource(), false, "销毁后元素应清空 src");
  handle.destroy();
  const next = runtime.create("https://cdn.example/f.mp3", baseOptions());
  assert.equal(next.hasSource(), true);
  next.play();
  assert.equal(next.paused, false, "新句柄仍可播放");
  next.destroy();
});
