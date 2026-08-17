import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as tick } from "node:timers/promises";
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

const syncUrl = await compileTypeScriptModule("../src/lyrics/desktopLyricsSync.ts");
const engineUrl = await compileTypeScriptModule(
  "../src/playback/playbackEngine.ts",
  new Map([["@/lyrics/desktopLyricsSync", syncUrl]]),
);
const { createPlaybackEngine } = await import(engineUrl);

/** 等待微任务与已排队的宏任务全部跑完（ended → next → loadAndPlay 链）。 */
async function flush() {
  await tick();
  await tick();
  await tick();
}

function song(id) {
  return { id, name: `S${id}`, artists: "a", album: "al", duration: 1000 };
}

/** fake MediaRuntime adapter：第二个 adapter 让 MediaRuntime seam 成为真实 seam。 */
function createFakeRuntime() {
  const handles = [];
  const runtime = {
    create(src, options) {
      const handle = {
        src,
        currentTime: 0,
        duration: NaN,
        playbackRate: 1,
        paused: true,
        ended: false,
        hasFutureData: true,
        destroyed: false,
        volume: options.volume,
        muted: options.muted,
        playCalls: 0,
        hasSource: () => !handle.destroyed,
        play: async () => {
          handle.playCalls += 1;
          handle.paused = false;
        },
        pause: () => {
          handle.paused = true;
        },
        seekTo: (seconds) => {
          handle.currentTime = seconds;
        },
        setVolume: (v) => {
          handle.volume = v;
        },
        setMuted: (m) => {
          handle.muted = m;
        },
        destroy: () => {
          handle.destroyed = true;
        },
        // 测试用：无论 destroy 与否都可以补发事件，模拟不守规矩的迟到事件。
        emit: (type, extra = {}) => options.onEvent({ type, ...extra }),
      };
      handles.push(handle);
      return handle;
    },
  };
  return { runtime, handles, last: () => handles[handles.length - 1] };
}

function createResolver() {
  const calls = [];
  let impl = async (id) => `url://${id}`;
  return {
    calls,
    callsFor: (id) => calls.filter((c) => c === id).length,
    set: (fn) => {
      impl = fn;
    },
    fn: (id) => {
      calls.push(id);
      return impl(id);
    },
  };
}

function createEngine(extra = {}) {
  const fake = createFakeRuntime();
  const resolver = createResolver();
  let nowMs = 0;
  const engine = createPlaybackEngine({
    runtime: fake.runtime,
    resolveSongUrl: resolver.fn,
    now: () => nowMs,
    ...extra,
  });
  return { engine, fake, resolver, advance: (ms) => (nowMs += ms) };
}

test("Media Generation 隔离：destroy 后的迟到事件被丢弃", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  const first = fake.last();
  first.emit("playing");
  assert.equal(engine.getState().playing, true);

  await engine.next();
  assert.equal(first.destroyed, true);
  assert.equal(engine.getState().index, 1);
  const handleCount = fake.handles.length;

  // 旧代际补发迟到事件：不得触发自动切歌，也不得污染新状态。
  first.currentTime = 55;
  first.emit("timeupdate");
  first.emit("ended");
  await flush();

  assert.equal(engine.getState().index, 1);
  assert.notEqual(engine.getState().currentTime, 55);
  assert.equal(fake.handles.length, handleCount);
});

test("ended 自动切歌：loop-list 推进到下一首", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  fake.last().emit("playing");

  fake.last().emit("ended");
  await flush();

  assert.equal(engine.getState().index, 1);
  assert.equal(fake.last().src, "url://2");
  assert.equal(engine.getState().playing, false); // 新代际尚未确认 playing
});

test("ended 自动切歌：loop-one 重播当前歌曲", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  engine.togglePlayMode(); // loop-list → loop-one
  const first = fake.last();

  first.emit("ended");
  await flush();

  assert.equal(engine.getState().index, 0);
  assert.equal(fake.last().src, "url://1");
  assert.notEqual(fake.last(), first); // 重播也是新的 Media Generation
});

test("ended 自动切歌：shuffle 选择不同歌曲", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  engine.togglePlayMode(); // → loop-one
  engine.togglePlayMode(); // → shuffle

  fake.last().emit("ended");
  await flush();

  // 队列只有 2 首时，「随机且不同」只能是另一首。
  assert.equal(engine.getState().index, 1);
  assert.equal(fake.last().src, "url://2");
});

test("错误重试：连续 3 次装载失败后停止自动切换", async () => {
  const { engine, resolver } = createEngine();
  resolver.set(async () => {
    throw new Error("boom");
  });

  await engine.playList([song(1), song(2), song(3)], 0);
  await flush();

  // 1 失败 → 跳 2 失败 → 跳 3 失败 → 达到上限停止，不再绕回。
  assert.deepEqual(resolver.calls, [1, 2, 3]);
  assert.equal(engine.getState().index, 2);
  assert.equal(engine.getState().loading, false);
  assert.equal(engine.getState().playing, false);
});

test("暂停后的媒体错误不触发自动切歌", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  const first = fake.last();
  first.emit("playing");
  engine.pause();

  const callsBefore = resolver.calls.length;
  first.emit("error", { error: new Error("network") });
  await flush();

  assert.equal(first.destroyed, true); // 坏 source 必须销毁
  assert.equal(engine.getState().index, 0); // 但不自动跳歌
  assert.equal(resolver.calls.length, callsBefore);
});

test("URL 缓存：预取与装载共享一次上游请求", async () => {
  const { engine, fake, resolver } = createEngine();
  const pending = new Map();
  resolver.set((id) => new Promise((res) => pending.set(id, res)));

  const playing = engine.playList([song(1), song(2)], 0);
  await flush();
  pending.get(1)("url://1");
  await playing;
  await flush();

  // 装载成功后 loop-list 预取了歌曲 2（尚未返回）。
  assert.equal(resolver.callsFor(2), 1);

  const advancing = engine.next();
  await flush();
  // next 的装载复用预取中的同一请求，不再发起新 invoke。
  assert.equal(resolver.callsFor(2), 1);
  pending.get(2)("url://2");
  await advancing;

  assert.equal(fake.last().src, "url://2");
});

test("URL 缓存：TTL 过期后重新请求（假时钟）", async () => {
  const { engine, resolver, advance } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  assert.equal(resolver.callsFor(1), 1);

  await engine.next();
  advance(4 * 60 * 1000); // 超过 3 分钟 TTL
  await engine.prev();

  assert.equal(resolver.callsFor(1), 2);
});

test("auth epoch 切换：迟到的 URL 结果不回写，装载被取消", async () => {
  const { engine, fake, resolver } = createEngine();
  const pending = new Map();
  resolver.set((id) => new Promise((res) => pending.set(id, res)));

  const loading = engine.playSong(song(9));
  await flush();
  assert.equal(engine.getState().loading, true);

  engine.notifyAuthEpochChanged(1);
  pending.get(9)("url://9"); // 旧账号的结果此刻才返回
  await loading;
  await flush();

  // 装载被取消：没有创建任何 Media Generation，状态已被会话隔离重置。
  assert.equal(fake.handles.length, 0);
  assert.equal(engine.getState().currentSongId, null);
  assert.equal(engine.getState().loading, false);

  // 缓存未被旧 epoch 回写：重新播放必须重新请求上游。
  resolver.set(async (id) => `url://${id}`);
  await engine.playSong(song(9));
  assert.equal(resolver.callsFor(9), 2);
  assert.equal(fake.last().src, "url://9");
});

test("seek 需要有限 duration，并 clamp 到区间且递增 seekRevision", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1)], 0);
  const handle = fake.last();

  const before = engine.getState().seekRevision;
  engine.seek(30); // duration 仍是 NaN → 忽略
  assert.equal(engine.getState().seekRevision, before);

  handle.duration = 240;
  handle.emit("durationchange");
  engine.seek(9999);
  assert.equal(handle.currentTime, 240);
  assert.equal(engine.getState().currentTime, 240);
  assert.equal(engine.getState().seekRevision, before + 1);
});

test("音量与静音应用到当前句柄，且传入新代际", async () => {
  const { engine, fake } = createEngine({ initialVolume: 0.5 });
  await engine.playList([song(1), song(2)], 0);
  assert.equal(fake.last().volume, 0.5);

  engine.setVolume(0);
  assert.equal(engine.getState().muted, true); // 音量 0 视为静音
  engine.setVolume(0.7);
  assert.equal(engine.getState().muted, false);
  assert.equal(fake.last().volume, 0.7);

  await engine.next();
  // 新 Media Generation 携带当前音量/静音状态创建。
  assert.equal(fake.last().volume, 0.7);
  assert.equal(fake.last().muted, false);
});
