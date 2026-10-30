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

test("invalidateSongUrlCache 后同一歌曲重新请求上游", async () => {
  const { engine, resolver } = createEngine();
  await engine.playList([song(1)], 0);
  await flush();
  assert.equal(resolver.callsFor(1), 1);

  // 未失效时：单曲队列 next 走缓存，不再请求。
  await engine.next();
  await flush();
  assert.equal(resolver.callsFor(1), 1);

  // 失效后：同样的 next 重新请求上游（切音质场景）。
  engine.invalidateSongUrlCache();
  await engine.next();
  await flush();
  assert.equal(resolver.callsFor(1), 2);
});

test("invalidateSongUrlCache 后，在途旧请求的结果不得回写缓存或装载", async () => {
  const { engine, resolver, fake } = createEngine();
  let release;
  const gate = new Promise((r) => (release = r));
  resolver.set((id) => gate.then(() => `url-old://${id}`));

  const firstLoad = engine.playList([song(1)], 0);
  await flush();

  // 切音质：清缓存 + 立即重载，新请求返回新档位 URL。
  engine.invalidateSongUrlCache();
  resolver.set((id) => Promise.resolve(`url-new://${id}`));
  engine.reloadCurrent();
  await flush();

  release();
  await firstLoad;
  await flush();

  assert.equal(resolver.callsFor(1), 2);
  // 最终装载的是新代际的 URL，旧代际被丢弃。
  assert.equal(fake.last().src, "url-new://1");
  assert.equal(fake.last().destroyed, false);
  assert.equal(engine.getState().currentSongId, 1);

  // 缓存里是新档位 URL：再次 next 命中缓存、不再请求上游，
  // 且装载的仍是新 URL —— 旧请求既没回写缓存也没被复用。
  await engine.next();
  await flush();
  assert.equal(resolver.callsFor(1), 2);
  assert.equal(fake.last().src, "url-new://1");
});

test("reloadCurrent 按当前索引从头重新装载当前歌曲", async () => {
  const { engine, resolver, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  const first = fake.handles[0];
  first.emit("playing");
  first.currentTime = 42;

  engine.reloadCurrent();
  await flush();

  assert.equal(first.destroyed, true);
  // 未失效缓存时重装载直接复用 URL，不打扰上游。
  assert.equal(resolver.callsFor(1), 1);
  assert.equal(fake.last().src, "url://1");
  assert.equal(fake.last().playCalls, 1); // 播放中的重载按原意图继续播放
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().currentTime, 0);
});

test("reloadCurrent 在无当前歌曲时是 no-op", async () => {
  const { engine, resolver, fake } = createEngine();
  engine.reloadCurrent();
  await flush();
  assert.equal(resolver.calls.length, 0);
  assert.equal(fake.handles.length, 0);
  assert.equal(engine.getState().currentSongId, null);
});

test("reloadCurrent 在 auth epoch 清空已装载媒体后是 no-op", async () => {
  const { engine, resolver, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(engine.getState().currentSongId, 1);
  const callsBefore = resolver.calls.length;
  const handlesBefore = fake.handles.length;

  // 登出/换号：auth epoch 旋转，引擎隔离旧会话但保留队列/index。
  engine.notifyAuthEpochChanged(1);
  assert.equal(engine.getState().currentSongId, null);
  assert.deepEqual(engine.getState().queue.map((s) => s.id), [1, 2]);

  engine.reloadCurrent();
  await flush();

  // 保留的队列不得因为一次取参变化被隐式重新播放。
  assert.equal(resolver.calls.length, callsBefore);
  assert.equal(fake.handles.length, handlesBefore);
  assert.equal(engine.getState().currentSongId, null);
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().index, 0);
});

test("reloadCurrent 在暂停时保持暂停，之后 togglePlay 恢复新媒体", async () => {
  const { engine, resolver, fake } = createEngine();
  await engine.playList([song(1)], 0);
  await flush();
  const playing = fake.last();
  playing.emit("playing");
  assert.equal(engine.getState().playing, true);

  engine.pause();
  assert.equal(engine.getState().playing, false);

  engine.reloadCurrent();
  await flush();

  const reloaded = fake.last();
  assert.notEqual(reloaded, playing); // 重载仍是新的 Media Generation
  assert.equal(reloaded.destroyed, false);
  assert.equal(reloaded.playCalls, 0); // 暂停意图：重载不得调用 play()
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().currentTime, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(resolver.callsFor(1), 1); // URL 命中缓存，不打扰上游

  // 新句柄已装载 source：togglePlay 应走 resume() 播放它。
  engine.togglePlay();
  await flush();
  assert.equal(reloaded.playCalls, 1);
  assert.equal(reloaded.paused, false);
});

test("reloadCurrent 失败时不自动切歌、不改队列/索引/历史", async () => {
  const { engine, resolver, fake } = createEngine();
  await engine.playList([song(1), song(2), song(3)], 0);
  await flush();
  const queueBefore = engine.getState().queue.map((s) => s.id);
  const historyBefore = engine.getState().history.map((s) => s.id);
  const callsBefore = resolver.calls.length;

  // 切音质会先清 URL 缓存，因此重载必须重新请求上游；这里让请求失败。
  engine.invalidateSongUrlCache();
  resolver.set(async () => {
    throw new Error("Network");
  });
  engine.reloadCurrent();
  await flush();

  // 重载失败不进入 recoverFromPlaybackFailure → next()：队列/索引/历史保持不变。
  assert.equal(engine.getState().index, 0);
  assert.deepEqual(engine.getState().queue.map((s) => s.id), queueBefore);
  assert.deepEqual(engine.getState().history.map((s) => s.id), historyBefore);
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().loading, false);
  // 只发起了一次重载请求，没有把失败当成播放失败而连锁切歌。
  assert.equal(resolver.calls.length, callsBefore + 1);
  assert.equal(fake.last().destroyed, true);
});

test("reloadCurrent 不重复写入播放历史", async () => {
  const { engine } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.deepEqual(engine.getState().history.map((s) => s.id), [1]);

  engine.reloadCurrent();
  await flush();

  // 切音质重载不是一次新的播放：历史保持 [1]，不出现相邻重复。
  assert.deepEqual(engine.getState().history.map((s) => s.id), [1]);
});

test("暂停态连续两次切档：在途的暂停重载不得变成自动播放", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1)], 0);
  await flush();
  fake.last().emit("playing");
  assert.equal(engine.getState().playing, true);

  engine.pause();
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().loading, false);

  // 第一次切档：暂停意图 → autoplay=false，但取 URL 期间 state.loading=true。
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  resolver.set(() => gate.then(() => "url://1-lossless"));
  engine.invalidateSongUrlCache();
  engine.reloadCurrent();
  await flush();
  assert.equal(engine.getState().loading, true);
  assert.equal(engine.getState().playing, false);

  // 第二次切档落在第一次取 URL 尚未返回的窗口内：
  // 不得因为 loading=true 而把暂停态的意图误判成继续播放。
  engine.invalidateSongUrlCache();
  engine.reloadCurrent();
  await flush();

  release();
  await flush();

  assert.equal(fake.last().playCalls, 0);
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().loading, false);
  assert.equal(engine.getState().currentSongId, 1);
});

test("暂停态切档重载期间点击播放：第一次点击即开始播放", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1)], 0);
  await flush();
  fake.last().emit("playing");
  engine.pause();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  resolver.set(() => gate.then(() => "url://1-hires"));
  engine.invalidateSongUrlCache();
  engine.reloadCurrent();
  await flush();
  assert.equal(engine.getState().loading, true);
  assert.equal(engine.getState().playing, false);

  // 用户在重载期间点击播放：应开始播放（复用在途 URL 请求），而不是取消装载。
  const callsBefore = resolver.calls.length;
  engine.togglePlay();
  await flush();
  assert.equal(resolver.calls.length, callsBefore); // 复用同一个在途请求

  release();
  await flush();

  assert.equal(fake.last().playCalls, 1);
  fake.last().emit("playing");
  assert.equal(engine.getState().playing, true);
  assert.equal(engine.getState().loading, false);
  assert.equal(engine.getState().currentSongId, 1);
  // 重载后的播放不是新的一轮播放：不重复写历史。
  assert.deepEqual(engine.getState().history.map((s) => s.id), [1]);
});

test("invalidateSongUrlCache 保留当前媒体，仅让后续解析重新取 URL", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  const active = fake.last();
  active.currentTime = 42;
  active.emit("playing");
  await flush();
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().playing, true);
  assert.equal(engine.getState().currentTime, 42);
  assert.equal(resolver.callsFor(2), 1); // 下一首已被预取
  const callsBefore = resolver.calls.length;

  engine.invalidateSongUrlCache();
  await flush();

  // 契约：只清 URL 缓存与在途合并表，不动当前媒体与播放/时间状态。
  assert.equal(active.destroyed, false);
  assert.equal(fake.last(), active);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().playing, true);
  assert.equal(engine.getState().currentTime, 42);
  assert.equal(engine.getState().loading, false);
  assert.equal(resolver.calls.length, callsBefore); // 失效本身不发起请求

  // 下一次解析（next 装载下一首）必须重新请求上游，而不是复用旧缓存。
  await engine.next();
  await flush();
  assert.equal(resolver.callsFor(2), 2); // 1 次预取 + 1 次失效后重新请求
  assert.equal(fake.last().src, "url://2");
  assert.equal(engine.getState().currentSongId, 2);
});
