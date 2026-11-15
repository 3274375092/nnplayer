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
  const preloaded = [];
  let cancelledPreloads = 0;
  const runtime = {
    preload(src) {
      preloaded.push(src);
    },
    cancelPreload() {
      cancelledPreloads += 1;
    },
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
  return {
    runtime,
    handles,
    preloaded,
    cancelledPreloads: () => cancelledPreloads,
    last: () => handles[handles.length - 1],
  };
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

test("auth epoch 变化时取消媒体预热，避免旧账号的缓冲残留", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  fake.last().emit("playing");
  await flush();
  const before = fake.cancelledPreloads();
  engine.notifyAuthEpochChanged(1);
  assert.ok(fake.cancelledPreloads() > before, "应调用 cancelPreload");
});

test("成功装载后为下一首预热媒体（runtime.preload）", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  fake.last().emit("playing");
  await flush();
  assert.deepEqual(fake.preloaded, ["url://2"]);
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

  // 停止自动切换时必须留下可见汇总：失败歌曲、连续次数与停止标记。
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure, "停止自动切换后必须有失败通报");
  assert.equal(failure.stage, "load");
  assert.equal(failure.stopped, true);
  assert.equal(failure.failCount, 3);
  assert.equal(failure.songId, 3);
  assert.deepEqual(failure.recentSongNames, ["S1", "S2", "S3"]);
  assert.equal(failure.kind, null); // 普通 Error 不带后端 kind，由映射层按未知处理
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

// =============== 播放失败通报生命周期（task-6 复核修复） ===============

test("reload 失败后切歌成功：清除旧失败通报，retry 不作用于新歌", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  engine.invalidateSongUrlCache();
  resolver.set(async () => {
    throw new Error("Network 断网");
  });
  engine.reloadCurrent();
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure?.stage, "reload");
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);

  // 网络恢复后用户切到下一首并成功开始播放：旧通报不应跨歌存活。
  resolver.set(async (id) => `url://${id}`);
  await engine.next();
  await flush();
  assert.equal(engine.getState().currentSongId, 2);
  assert.equal(engine.getState().lastPlaybackFailure, null);

  // 没有通报可重试时，retry 不得把当前装载的 S2 当成失败歌曲重载。
  await engine.retryFailedPlayback();
  await flush();
  assert.equal(engine.getState().currentSongId, 2);
  assert.equal(engine.getState().index, 1);
  assert.equal(fake.last().src, "url://2");
});

test("reload 失败后切歌尚未成功时 retry：重试目标仍是失败歌曲", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  engine.invalidateSongUrlCache();
  resolver.set(async () => {
    throw new Error("Network 断网");
  });
  engine.reloadCurrent();
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure?.stage, "reload");
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);

  // 让下一首的 URL 请求悬挂：currentSongId 已切到 2，但尚未成功开始播放。
  let releasePendingNext = () => {};
  resolver.set(
    (id) =>
      new Promise((resolve) => {
        releasePendingNext = () => resolve(`url://${id}`);
      }),
  );
  const pendingNext = engine.next();
  await flush();
  assert.equal(engine.getState().currentSongId, 2);
  // 用户意图播放尚未成功，因此 S1 的失败通报仍在。
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);

  // 网络恢复后点重试：必须重试失败歌曲 S1，而不是重载当前已装载的 S2。
  resolver.set(async (id) => `url://${id}`);
  const retry = engine.retryFailedPlayback();
  await flush();
  releasePendingNext();
  await Promise.allSettled([pendingNext, retry]);
  await flush();

  assert.equal(engine.getState().lastPlaybackFailure, null);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().index, 0);
  assert.equal(fake.last().src, "url://1");
});

test("自动跳歌恢复链的成功不清失败通报；用户点播成功后清除", async () => {
  const { engine, resolver } = createEngine();
  resolver.set(async (id) => {
    if (id === 1) throw new Error("Network");
    return `url://${id}`;
  });
  await engine.playList([song(1), song(2), song(3)], 0);
  await flush();

  // S1 装载失败 → 自动跳到 S2 成功；失败链内的成功不得吞掉 S1 的通报。
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure, "自动跳到下一首后失败通报必须保留");
  assert.equal(failure.songId, 1);
  assert.equal(failure.failCount, 1);
  assert.equal(engine.getState().currentSongId, 2);

  // 用户显式下一次：S3 成功开始播放后清除旧通报。
  await engine.next();
  await flush();
  assert.equal(engine.getState().currentSongId, 3);
  assert.equal(engine.getState().lastPlaybackFailure, null);
});

test("dismiss 清除失败通报；retry 重播失败歌曲并清通报", async () => {
  const { engine, fake, resolver } = createEngine();
  resolver.set(async (id) => {
    if (id === 1) throw new Error("Network");
    return `url://${id}`;
  });
  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);

  engine.dismissPlaybackFailure();
  assert.equal(engine.getState().lastPlaybackFailure, null);

  // 再次失败后点重试：网络恢复，应重播失败歌曲 S1。
  resolver.set(async (id) => {
    if (id === 1) throw new Error("Network");
    return `url://${id}`;
  });
  await engine.playSong(song(1));
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);
  assert.equal(engine.getState().currentSongId, 2); // 已自动跳到 S2

  resolver.set(async (id) => `url://${id}`);
  await engine.retryFailedPlayback();
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure, null);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().index, 0);
  assert.equal(fake.last().src, "url://1");
  assert.equal(fake.last().playCalls, 1);
});

test("失败歌曲已被移出队列：retry 明确 no-op 并保留通报", async () => {
  const { engine, resolver } = createEngine();
  resolver.set(async (id) => {
    if (id === 1) throw new Error("Network");
    return `url://${id}`;
  });
  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(engine.getState().currentSongId, 2);
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);

  // 用户把失败的 S1 从队列移除（当前播放的是 S2）。
  engine.removeFromQueue(0);
  await flush();
  assert.equal(engine.getState().queue.length, 1);
  assert.equal(engine.getState().queue[0]?.id, 2);

  await engine.retryFailedPlayback();
  await flush();

  // 不擅自播放别的歌，也不静默吞掉通报（用户仍可手动关闭）。
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);
  assert.equal(engine.getState().currentSongId, 2);
});

// =============== 队列插入（撤销删除） ===============

test("insertIntoQueue 把歌放回原位置且不替换当前曲", async () => {
  const { engine } = createEngine();
  await engine.playList([song(1), song(2), song(3)], 1);
  await flush();

  // 撤销当前曲之后的删除：插回 index 2，当前曲索引不变。
  engine.insertIntoQueue(2, song(9));
  assert.deepEqual(
    engine.getState().queue.map((s) => s.id),
    [1, 2, 9, 3],
  );
  assert.equal(engine.getState().index, 1);

  // 撤销当前曲之前的删除：插回 index 0，当前曲索引后移一位，播放的仍是 S2。
  engine.insertIntoQueue(0, song(8));
  assert.deepEqual(
    engine.getState().queue.map((s) => s.id),
    [8, 1, 2, 9, 3],
  );
  assert.equal(engine.getState().currentSongId, 2);
  assert.equal(engine.getState().queue[engine.getState().index]?.id, 2);
});

test("insertIntoQueue 夹住越界位置，不破坏队列与当前索引", async () => {
  const { engine } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();

  engine.insertIntoQueue(-5, song(7));
  engine.insertIntoQueue(99, song(8));
  assert.deepEqual(
    engine.getState().queue.map((s) => s.id),
    [7, 1, 2, 8],
  );
  assert.equal(engine.getState().queue[engine.getState().index]?.id, 1);
});

test("restoreQueueSnapshot 恢复队列，并把 index 指回正在播放的歌", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2), song(3)], 1);
  await flush();
  const playingSrc = fake.last().src;
  const handlesBefore = fake.handles.length;

  // 模拟“从这首歌开始”前的快照，然后用户点了另一首（媒体换成 S3），再撤销。
  const snapshotQueue = [...engine.getState().queue];
  const snapshotIndex = engine.getState().index;
  await engine.playList([song(1), song(3)], 0);
  await engine.playList([song(1), song(2), song(3)], 2);
  await flush();
  assert.equal(engine.getState().currentSongId, 3);

  engine.restoreQueueSnapshot(snapshotQueue, snapshotIndex);
  await flush();

  assert.deepEqual(
    engine.getState().queue.map((s) => s.id),
    [1, 2, 3],
  );
  // 正在播放的是 S3：index 必须指回它，而不是快照里的 S2。
  assert.equal(engine.getState().queue[engine.getState().index]?.id, 3);
  assert.equal(engine.getState().currentSongId, 3);
  // 队列结构恢复不触发新的媒体装载（最后一次装载来自上面的 playList）。
  assert.equal(fake.handles.length, handlesBefore + 2);
  assert.equal(fake.last().src, "url://3");
  assert.notEqual(playingSrc, undefined);
});

test("restoreQueueSnapshot 越界索引被夹住；恢复队列里没有正在播放的歌时停止媒体", async () => {
  const { engine } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  const handle = engine.getState().currentSongId;

  // S1 不在恢复后的队列里：不能留下 queue[index] 与媒体各说各话的状态。
  engine.restoreQueueSnapshot([song(7), song(8)], 99);
  assert.equal(engine.getState().index, 1);
  assert.equal(engine.getState().queue[engine.getState().index]?.id, 8);
  assert.equal(engine.getState().currentSongId, null);
  assert.notEqual(handle, null);

  engine.restoreQueueSnapshot([], 0);
  assert.equal(engine.getState().queue.length, 0);
  assert.equal(engine.getState().index, -1);
  assert.equal(engine.getState().currentSongId, null);
  assert.equal(engine.getState().playing, false);
});

test("restoreQueueSnapshot 保留无当前曲时的 -1 索引", () => {
  const { engine } = createEngine();

  engine.restoreQueueSnapshot([song(7), song(8)], -1);

  assert.deepEqual(
    engine.getState().queue.map((item) => item.id),
    [7, 8],
  );
  assert.equal(engine.getState().index, -1);
  assert.equal(engine.getState().currentSongId, null);
});

test("restoreQueueSnapshot 保留 duplicate songId 的快照 occurrence", async () => {
  const { engine } = createEngine();
  const first = {
    id: 7,
    name: "A1",
    artists: "a",
    album: "al",
    duration: 1000,
  };
  const middle = song(8);
  const second = {
    id: 7,
    name: "A2",
    artists: "a",
    album: "al",
    duration: 1000,
  };
  const last = song(9);
  await engine.playList([first, middle, second, last], 2);
  await flush();

  engine.restoreQueueSnapshot([first, middle, second, last], 2);
  await flush();

  assert.equal(engine.getState().index, 2);
  assert.equal(engine.getState().queue[2]?.name, "A2");
  assert.equal(engine.getState().currentSongId, 7);
});

test("队列结构修改后 currentSongId 始终等于 queue[index].id（不变量）", async () => {
  const { engine } = createEngine();
  await engine.playList([song(1), song(2), song(3)], 1);
  await flush();

  const assertInvariant = () => {
    const state = engine.getState();
    if (state.currentSongId === null) return;
    assert.equal(state.queue[state.index]?.id, state.currentSongId);
  };

  engine.insertIntoQueue(0, song(9));
  assertInvariant();
  engine.insertIntoQueue(4, song(8));
  assertInvariant();
  engine.reorderQueue(0, 4);
  assertInvariant();
  engine.removeFromQueue(0);
  await flush();
  assertInvariant();
  engine.restoreQueueSnapshot([song(2), song(3)], 0);
  await flush();
  assertInvariant();
  engine.clearQueue();
  assertInvariant();
});

test("非有限队列索引被拒绝，不会把 index 写成 NaN", async () => {
  const { engine } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();

  engine.insertIntoQueue(NaN, song(9));
  assert.deepEqual(
    engine.getState().queue.map((s) => s.id),
    [1, 2],
  );

  engine.restoreQueueSnapshot([song(7), song(8)], Number.NaN);
  assert.equal(Number.isFinite(engine.getState().index), true);
  assert.equal(engine.getState().queue[engine.getState().index]?.id, 7);
});

test("批量插回歌曲时下一首未变，不重复重建预取与预热", async () => {
  const { engine, fake, resolver } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(fake.preloaded.length, 1);
  assert.equal(resolver.callsFor(2), 1);

  // 「清空待播」撤销会逐首 insert：下一首始终是 S2，不得重复预取/load。
  for (let i = 0; i < 20; i += 1) engine.insertIntoQueue(i, song(100 + i));
  await flush();
  assert.equal(fake.preloaded.length, 1, "同一首下一曲只预热一次");
  assert.equal(resolver.callsFor(2), 1, "同一首下一曲只取址一次");
});

test("大队列快照恢复只通知一次，避免清空撤销 O(n²)", async () => {
  const { engine } = createEngine();
  const bigQueue = Array.from({ length: 1_000 }, (_, i) => song(i + 1));
  await engine.playList(bigQueue, 500);
  await flush();

  let notifications = 0;
  const stop = engine.subscribe(() => {
    notifications += 1;
  });
  engine.restoreQueueSnapshot(bigQueue, 500);
  stop();

  assert.equal(engine.getState().queue.length, 1_000);
  assert.equal(engine.getState().index, 500);
  assert.equal(notifications, 1);
});

test("insertIntoQueue 到空队列后可以从头播放", async () => {
  const { engine, fake } = createEngine();
  engine.insertIntoQueue(0, song(5));
  await flush();
  assert.deepEqual(
    engine.getState().queue.map((s) => s.id),
    [5],
  );
  // 只改队列结构，不擅自开始播放。
  assert.equal(engine.getState().playing, false);
  await engine.playList([song(5)], 0);
  await flush();
  assert.equal(fake.last().src, "url://5");
});

// =============== 同歌自动重试 / 不跳歌策略（因音质风控跳过歌曲的修复） ===============

/** 构造带 kind 的播放链路错误（后端 AppError 与引擎内部分类的形态）。 */
function failureError(kind, message = "失败") {
  return Object.assign(new Error(message), { kind });
}

test("风控失败：按 5s/20s/60s 阶梯自动重试 3 次，仍失败则停在当前歌曲、不自动跳歌", async () => {
  const waits = [];
  const { engine, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async () => {
    throw failureError("RiskControl", "检测到您的网络环境存在风险");
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();

  // 首次取址失败 → 通报“5 秒后第 1/3 次自动重试”，不请求下一首。
  assert.equal(waits.length, 1);
  assert.equal(waits[0].ms, 5_000);
  let failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.kind, "RiskControl");
  assert.deepEqual(failure.autoRetry, { attempt: 1, limit: 3, waitMs: 5_000 });
  assert.deepEqual(resolver.calls, [1]);

  // 第 1 次重试仍被风控 → 排定第 2 次（20s）。
  waits[0].resolve();
  await flush();
  await flush();
  assert.equal(waits.length, 2);
  assert.equal(waits[1].ms, 20_000);
  failure = engine.getState().lastPlaybackFailure;
  assert.deepEqual(failure.autoRetry, { attempt: 2, limit: 3, waitMs: 20_000 });

  // 第 2 次仍失败 → 排定第 3 次（60s）。
  waits[1].resolve();
  await flush();
  await flush();
  assert.equal(waits.length, 3);
  assert.equal(waits[2].ms, 60_000);
  failure = engine.getState().lastPlaybackFailure;
  assert.deepEqual(failure.autoRetry, { attempt: 3, limit: 3, waitMs: 60_000 });

  // 第 3 次也失败：阶梯用完，停在当前歌曲，交回手动重试。
  waits[2].resolve();
  await play;
  await flush();
  assert.deepEqual(resolver.calls, [1, 1, 1, 1]);
  assert.equal(resolver.callsFor(2), 0, "风控恢复期间绝不预取/请求下一首");
  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().loading, false);

  failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure, "停在当前歌曲时必须有可见失败通报");
  assert.equal(failure.songId, 1);
  assert.equal(failure.kind, "RiskControl");
  assert.equal(failure.advancedToNext, false, "未跳歌时不得谎称已跳歌");
  assert.equal(failure.retryCount, 3);
  assert.equal(failure.autoRetry, null, "阶梯用完后不再计划自动重试");
  assert.equal(failure.stopped, false);
});

test("风控恢复：阶梯重试成功即继续播放，清除通报并重新预取下一首", async () => {
  const waits = [];
  const { engine, fake, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  let attempts = 0;
  resolver.set(async (id) => {
    attempts += 1;
    if (attempts <= 2) {
      throw failureError("RiskControl", "检测到您的网络环境存在风险");
    }
    return `url://${id}`;
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(waits.length, 1);
  waits[0].resolve();
  await flush();
  await flush();
  assert.equal(waits.length, 2);
  waits[1].resolve();
  await play;
  await flush();
  await flush();

  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(fake.last().src, "url://1");
  assert.equal(fake.last().playCalls, 1);
  assert.equal(engine.getState().lastPlaybackFailure, null);
  // 恢复成功属于同一次显式点播：只写一次播放历史，预取在冷却解除后恢复。
  assert.deepEqual(
    engine.getState().history.map((item) => item.id),
    [1],
  );
  assert.equal(resolver.callsFor(2), 1);
  assert.equal(waits.length, 2, "成功恢复后不再排定新的自动重试");
});

test("风控等待期间用户切歌：恢复链取消，不再为旧歌重试", async () => {
  const waits = [];
  const { engine, fake, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async (id) => {
    if (id === 1) throw failureError("RiskControl", "检测到您的网络环境存在风险");
    return `url://${id}`;
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(waits.length, 1);

  // 用户切到下一首（新起一次装载）；旧等待晚到也不得复活旧歌的重试。
  await engine.next();
  await flush();
  waits[0].resolve();
  await flush();
  await flush();
  await play;
  await flush();

  assert.equal(waits.length, 1, "不得为旧歌再排定自动重试");
  assert.deepEqual(resolver.calls.slice(0, 2), [1, 2], "只保留旧歌首次取址，随后装载用户选的新歌");
  assert.equal(engine.getState().currentSongId, 2);
  assert.equal(fake.last().src, "url://2");
  assert.equal(fake.last().playCalls, 1);
});

test("风控冷却期间不预取下一首，恢复播放后解除冷却", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  resolver.set(async (id) => {
    if (id === 1) throw failureError("RiskControl", "检测到您的网络环境存在风险");
    return `url://${id}`;
  });

  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.deepEqual(resolver.calls, [1, 1, 1, 1]);
  assert.equal(resolver.callsFor(2), 0);

  // 冷却中队列结构变化不得触发下一首 URL 预取。
  engine.reorderQueue(0, 2);
  await flush();
  assert.equal(resolver.callsFor(2), 0, "风控冷却期内不得预取");

  // 用户手动重试并成功：冷却解除，下一次预取恢复。
  resolver.set(async (id) => `url://${id}`);
  await engine.retryFailedPlayback();
  await flush();
  await flush();
  assert.equal(engine.getState().currentSongId, 1);
  assert.ok(resolver.callsFor(2) > 0, "恢复播放后应重新预取下一首");
});

test("暂停发生在风控自动重试的取址窗口：立即取消重试并清掉虚假进度", async () => {
  const waits = [];
  let releaseRetry;
  let calls = 0;
  const resolver = createResolver();
  resolver.set(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(failureError("RiskControl", "风控"));
    }
    return new Promise((resolve) => {
      releaseRetry = resolve;
    });
  });
  const originalResolve = resolver.fn;
  const engine = createPlaybackEngine({
    runtime: createFakeRuntime().runtime,
    resolveSongUrl: originalResolve,
    now: () => 0,
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  waits[0].resolve();
  await flush();
  await flush();
  assert.ok(releaseRetry, "第二次取址必须已经开始");

  engine.pause();
  assert.equal(
    engine.getState().lastPlaybackFailure?.autoRetry,
    null,
  );
  releaseRetry("url://1");
  await play;
  await flush();

  assert.equal(engine.getState().loading, false);
  assert.equal(engine.getState().playing, false);
  assert.equal(
    engine.getState().lastPlaybackFailure?.autoRetry,
    null,
  );
  assert.equal(waits.length, 1, "暂停后旧链不得继续排下一次");
});

test("手动停止自动重试会取消已在途的取址，不允许迟到媒体起播", async () => {
  const waits = [];
  let releaseRetry;
  let calls = 0;
  const resolver = createResolver();
  resolver.set(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(failureError("RiskControl", "风控"));
    }
    return new Promise((resolve) => {
      releaseRetry = resolve;
    });
  });
  const originalResolve = resolver.fn;
  const fake = createFakeRuntime();
  const engine = createPlaybackEngine({
    runtime: fake.runtime,
    resolveSongUrl: originalResolve,
    now: () => 0,
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  waits[0].resolve();
  await flush();
  await flush();
  assert.equal(
    engine.getState().lastPlaybackFailure?.autoRetry?.waitMs,
    0,
  );
  assert.ok(releaseRetry, "自动重试的第二次取址应已在途");

  engine.cancelAutoRetry();
  releaseRetry("url://1");
  await play;
  await flush();

  assert.equal(fake.handles.length, 0, "取消后不得创建迟到媒体");
  assert.equal(engine.getState().playing, false);
  assert.equal(
    engine.getState().lastPlaybackFailure?.autoRetry,
    null,
  );
});

test("第一次等待前停止不把尚未发生的重试计入 retryCount", async () => {
  const waits = [];
  const { engine, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async () => {
    throw failureError("RiskControl", "风控");
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure?.retryCount, 0);
  engine.cancelAutoRetry();
  waits[0].resolve();
  await play;
  await flush();

  const failure = engine.getState().lastPlaybackFailure;
  assert.equal(failure?.autoRetry, null);
  assert.equal(failure?.retryCount, 0);
  assert.deepEqual(resolver.calls, [1], "尚未发生的重试不得计入");
});

test("旧风控计时器晚到，不得清掉手动重试新链的进度", async () => {
  const waits = [];
  const { engine, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async () => {
    throw failureError("RiskControl", "风控");
  });

  const initial = engine.playList([song(1), song(2)], 0);
  await flush();
  const oldWait = waits[0];
  const manual = engine.retryFailedPlayback();
  await flush();
  assert.equal(waits.length, 2);
  assert.equal(engine.getState().lastPlaybackFailure?.autoRetry?.attempt, 1);

  oldWait.resolve();
  await flush();
  await flush();
  assert.deepEqual(engine.getState().lastPlaybackFailure?.autoRetry, {
    attempt: 1,
    limit: 3,
    waitMs: 5_000,
  });

  engine.cancelAutoRetry();
  waits[1].resolve();
  await Promise.all([initial, manual]);
  await flush();
});

test("风控自动重试若变成网络错误：立即停止阶梯并停歌", async () => {
  const waits = [];
  let calls = 0;
  const resolver = createResolver();
  resolver.set(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(failureError("RiskControl", "风控"));
    }
    return Promise.reject(failureError("Network", "网络断开"));
  });
  const engine = createPlaybackEngine({
    runtime: createFakeRuntime().runtime,
    resolveSongUrl: resolver.fn,
    now: () => 0,
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  waits[0].resolve();
  await play;
  await flush();

  const failure = engine.getState().lastPlaybackFailure;
  assert.equal(failure?.kind, "Network");
  assert.equal(failure?.autoRetry, null);
  assert.equal(waits.length, 1, "非风控错误不得继续 20s/60s 阶梯");
  assert.equal(engine.getState().index, 0);
});

test("普通网络重试后才遇到风控：仍进入 5s/20s/60s 恢复阶梯", async () => {
  const waits = [];
  let calls = 0;
  const { engine, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(failureError("Network", "临时网络失败"));
    }
    return Promise.reject(failureError("RiskControl", "风控"));
  });

  const play = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(waits[0].ms, 600);
  waits[0].resolve();
  await flush();
  await flush();
  assert.deepEqual(waits.map((item) => item.ms), [600, 5_000]);
  assert.deepEqual(engine.getState().lastPlaybackFailure?.autoRetry, {
    attempt: 1,
    limit: 3,
    waitMs: 5_000,
  });

  engine.cancelAutoRetry();
  waits[1].resolve();
  await play;
  await flush();
});

test("流中断恢复成功后清除风控进度通报", async () => {
  const waits = [];
  let primaryCalls = 0;
  const { engine, fake, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async (id) => {
    if (id === 1) {
      primaryCalls += 1;
      if (primaryCalls === 2) {
        throw failureError("RiskControl", "风控");
      }
    }
    return `url://${id}`;
  });

  await engine.playList([song(1), song(2)], 0);
  await flush();
  fake.last().emit("playing");
  fake.last().emit("error", {
    error: failureError("Media", "流中断"),
  });
  await flush();

  assert.equal(waits.length, 1);
  waits[0].resolve();
  await flush();
  await flush();
  await flush();
  await flush();
  assert.deepEqual(
    waits.map((item) => item.ms),
    [300, 5_000],
    `waits=${waits.map((item) => item.ms).join(",")}`,
  );
  assert.equal(waits[1].ms, 5_000);
  assert.equal(engine.getState().lastPlaybackFailure?.autoRetry?.waitMs, 5_000);

  waits[1].resolve();
  await flush();
  await flush();
  await flush();

  assert.equal(engine.getState().lastPlaybackFailure, null);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(fake.last().src, "url://1");
});

test("网络临时失败：同歌重试成功则继续播放，不产生失败通报也不重复写历史", async () => {
  const { engine, fake, resolver } = createEngine({ wait: async () => {} });
  let attempt = 0;
  resolver.set(async (id) => {
    attempt += 1;
    if (attempt === 1) throw failureError("Network", "网络请求失败");
    return `url://${id}`;
  });

  await engine.playList([song(1), song(2)], 0);
  await flush();

  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(fake.last().src, "url://1");
  assert.equal(fake.last().playCalls, 1);
  assert.equal(engine.getState().lastPlaybackFailure, null);
  // 成功装载只写一次播放历史；预取下一首正常进行。
  assert.deepEqual(
    engine.getState().history.map((item) => item.id),
    [1],
  );
  assert.equal(resolver.callsFor(2), 1);
});

test("网络失败重试后仍失败：不自动跳歌，保留可见原因", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  resolver.set(async () => {
    throw failureError("Network", "网络请求失败");
  });

  await engine.playList([song(1), song(2)], 0);
  await flush();

  assert.deepEqual(resolver.calls, [1, 1]);
  assert.equal(engine.getState().index, 0);
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.kind, "Network");
  assert.equal(failure.advancedToNext, false);
});

test("媒体装载失败：同歌重试一次仍失败后按既有策略自动跳下一首", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  resolver.set(async (id) => {
    if (id === 1) throw failureError("Media", "播放源不可用");
    return `url://${id}`;
  });

  await engine.playList([song(1), song(2)], 0);
  await flush();

  // 首次取址 + 同歌重试 + 下一首装载；之后对 1 的调用是列表循环预取。
  assert.deepEqual(resolver.calls.slice(0, 3), [1, 1, 2]);
  assert.equal(engine.getState().index, 1);
  assert.equal(engine.getState().currentSongId, 2);
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure, "自动跳歌后失败通报必须保留");
  assert.equal(failure.songId, 1);
  assert.equal(failure.advancedToNext, true);
  assert.equal(failure.retryCount, 1);
  assert.equal(failure.stopped, false);
});

test("取播放地址超时：同歌重试成功则继续播放（不再永远卡在 loading）", async () => {
  const { engine, fake, resolver } = createEngine({
    wait: async () => {},
    resolveTimeoutMs: 10,
  });
  let attempt = 0;
  resolver.set(async (id) => {
    attempt += 1;
    if (attempt === 1) return new Promise(() => {});
    return `url://${id}`;
  });

  const loading = engine.playList([song(1), song(2)], 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await loading;
  await flush();

  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().loading, false);
  assert.equal(fake.last().src, "url://1");
  assert.equal(engine.getState().lastPlaybackFailure, null);
});

test("媒体起播超时：重试后仍超时则停在当前歌曲，不自动跳歌", async () => {
  const base = createFakeRuntime();
  const runtime = {
    create(src, options) {
      const handle = base.runtime.create(src, options);
      handle.play = () => new Promise(() => {});
      return handle;
    },
  };
  const resolver = createResolver();
  const engine = createPlaybackEngine({
    runtime,
    resolveSongUrl: resolver.fn,
    wait: async () => {},
    loadTimeoutMs: 10,
  });

  const loading = engine.playList([song(1), song(2)], 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await loading;
  await flush();

  assert.deepEqual(resolver.calls, [1, 1]);
  assert.equal(engine.getState().index, 0);
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.kind, "Timeout");
  assert.equal(failure.advancedToNext, false);
  assert.match(failure.message, /音频加载超时/);
});

test("媒体起播超时：重试后成功则继续播放", async () => {
  const base = createFakeRuntime();
  let created = 0;
  const runtime = {
    create(src, options) {
      const handle = base.runtime.create(src, options);
      created += 1;
      if (created === 1) handle.play = () => new Promise(() => {});
      return handle;
    },
  };
  const resolver = createResolver();
  const engine = createPlaybackEngine({
    runtime,
    resolveSongUrl: resolver.fn,
    wait: async () => {},
    loadTimeoutMs: 10,
  });

  const loading = engine.playList([song(1), song(2)], 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await loading;
  await flush();

  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().lastPlaybackFailure, null);
  assert.equal(base.last().src, "url://1");
});

test("播放中流中断：同歌换新 URL 重试成功，不跳歌", async () => {
  const { engine, fake, resolver } = createEngine({ wait: async () => {} });
  await engine.playList([song(1), song(2)], 0);
  const first = fake.last();
  first.emit("playing");
  assert.equal(engine.getState().playing, true);

  resolver.set(async (id) => `fresh://${id}`);
  first.emit("error", { error: { code: 2 } });
  await flush();

  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(fake.last().src, "fresh://1");
  assert.equal(fake.last().playCalls, 1);
  assert.equal(engine.getState().lastPlaybackFailure, null);
  // 初始装载 + 流中断重试各请求一次；预取下一首不算在内。
  assert.equal(resolver.callsFor(1), 2);
});

// =============== 重试预算生命周期 / 事实字段边界（审查修复回归） ===============

test("单曲队列 + 单曲循环：Media 失败不得谎称已自动跳到下一首", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  engine.togglePlayMode(); // loop-list -> loop-one
  resolver.set(async () => {
    throw failureError("Media", "播放源不可用");
  });

  await engine.playList([song(1)], 0);
  await flush();

  // 单曲队列的 next() 是 no-op：实际停在原曲，事实字段不能说“已跳到下一首”。
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.songId, 1);
  assert.equal(failure.advancedToNext, false);
  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().playing, false);
});

test("重试等待期间用户点播放：同一首歌的新尝试重新获得重试预算", async () => {
  const waits = [];
  const { engine, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async () => {
    throw failureError("Network", "网络请求失败");
  });

  const firstPlay = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(waits.length, 1, "首次失败后进入同歌重试等待");
  assert.equal(waits[0].ms, 600);

  // UI 此刻是停止态：用户点播放开启新一轮装载（旧重试等待必须被取消）。
  engine.togglePlay();
  await flush();
  assert.equal(waits.length, 2, "用户的新尝试失败后仍应获得一次同歌重试");

  waits[0].resolve(); // 旧等待晚到：不得复活旧重试。
  await firstPlay;
  waits[1].resolve();
  await flush();
  await flush();

  // 首次装载失败 + 用户新装载失败 + 用户新装载的同歌重试，恰好 3 次取址。
  assert.deepEqual(resolver.calls, [1, 1, 1]);
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.kind, "Network");
  assert.equal(failure.advancedToNext, false);
  assert.equal(failure.retryCount, 1);
});

test("auth epoch 变化后同歌重试预算重置：新会话保留完整重试机会", async () => {
  const waits = [];
  const { engine, resolver } = createEngine({
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
  });
  resolver.set(async () => {
    throw failureError("Network", "网络请求失败");
  });

  const firstPlay = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(waits.length, 1);

  engine.notifyAuthEpochChanged(1); // 换号：旧装载与旧重试全部作废。
  waits[0].resolve();
  await firstPlay;
  await flush();

  // 新会话里重播同一首歌：失败后必须重新拥有一次自动重试。
  const secondPlay = engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(waits.length, 2, "新会话不应继承旧会话已用掉的同歌重试预算");
  waits[1].resolve();
  await secondPlay;
  await flush();
});

test("流中断停止自动切歌后，连续失败链归零（下一次失败从 1 重新计数）", async () => {
  const { engine, fake, resolver } = createEngine({ wait: async () => {} });
  await engine.playList([song(1), song(2), song(3), song(4)], 0);
  await flush();

  // S1 流中断（Media）：同歌重试也失败 → 自动跳歌，连败计数 1。
  resolver.set(async (id) => {
    if (id === 1) throw failureError("Media", "播放源不可用");
    return `url://${id}`;
  });
  const s1 = fake.last();
  s1.emit("playing");
  s1.emit("error", { error: { code: 4 } });
  await flush();
  await flush();
  assert.equal(engine.getState().currentSongId, 2);

  // S2 流中断（Network）：重试失败后停在当前歌曲，连败链应随本轮结束归零。
  resolver.set(async (id) => {
    if (id === 2) throw failureError("Network", "网络请求失败");
    return `url://${id}`;
  });
  const s2 = fake.last();
  s2.emit("playing");
  s2.emit("error", { error: failureError("Network", "网络请求失败") });
  await flush();
  await flush();
  const stopped = engine.getState().lastPlaybackFailure;
  assert.ok(stopped);
  assert.equal(stopped.songId, 2);
  assert.equal(stopped.advancedToNext, false);

  // 用户播放 S3；S3 的 Media 失败跳歌时 failCount 必须从 1 重新开始。
  engine.invalidateSongUrlCache(); // 避免 S3 的预取缓存掩盖上游失败
  resolver.set(async (id) => {
    if (id === 3) throw failureError("Media", "播放源不可用");
    return `url://${id}`;
  });
  await engine.playSong(song(3));
  await flush();
  await flush();

  const after = engine.getState().lastPlaybackFailure;
  assert.ok(after);
  assert.equal(after.songId, 3);
  assert.equal(after.failCount, 1, "上一首的连败不得跨出“停止自动切歌”继续累计");
});

test("非法超时配置（NaN）回退默认值：不会立即误报超时", async () => {
  const { engine, resolver } = createEngine({
    wait: async () => {},
    resolveTimeoutMs: NaN,
  });
  resolver.set(
    (id) =>
      new Promise((resolve) => setTimeout(() => resolve(`url://${id}`), 25)),
  );

  const loading = engine.playList([song(1)], 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await loading;

  assert.equal(engine.getState().lastPlaybackFailure, null);
  assert.equal(engine.getState().currentSongId, 1);
});

// =============== 会话级失败分类 / resume 看门狗（task-8） ===============

/** 轮询等待异步链推进到条件成立；超时类用例避免依赖固定 sleep。 */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("waitFor 超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("会话级后端错误（Ncm/Json/Internal）先同歌重试一次，仍失败不自动跳歌", async () => {
  for (const kind of ["Ncm", "Json", "Internal"]) {
    const { engine, resolver } = createEngine({ wait: async () => {} });
    resolver.set(async () => {
      throw failureError(kind, `${kind} 失败`);
    });

    await engine.playList([song(1), song(2)], 0);
    await flush();

    // 首次取址 + 同歌重试各一次；绝不请求下一首。
    assert.deepEqual(resolver.calls, [1, 1], kind);
    assert.equal(engine.getState().index, 0, kind);
    assert.equal(engine.getState().currentSongId, 1, kind);
    assert.equal(engine.getState().playing, false, kind);
    const failure = engine.getState().lastPlaybackFailure;
    assert.ok(failure, kind);
    assert.equal(failure.songId, 1, kind);
    assert.equal(failure.kind, kind);
    assert.equal(failure.advancedToNext, false, kind);
    // 停在当前歌曲但仍是「可重试」通报：用户可手动重试，不是停止自动切换汇总。
    assert.equal(failure.stopped, false, kind);
    assert.equal(failure.failCount, 0, kind);
    assert.equal(failure.retryCount, 1, kind);
  }
});

test("kind=NoSource（resolver 返回 null）仍按歌曲自身不可播放自动跳歌", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  resolver.set(async (id) => (id === 1 ? null : `url://${id}`));

  await engine.playList([song(1), song(2)], 0);
  await flush();

  // NoSource 不在 RETRYABLE_KINDS：第一次取址失败后直接请求下一首（[1,2]），
  // 之后的 id=1 是跳到 S2 成功后的列表循环预取，不属于当前曲重试。
  assert.deepEqual(resolver.calls.slice(0, 2), [1, 2]);
  assert.equal(engine.getState().index, 1);
  assert.equal(engine.getState().currentSongId, 2);
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.songId, 1);
  assert.equal(failure.kind, "NoSource");
  assert.equal(failure.advancedToNext, true);
});

test("暂停后继续播放卡住：看门狗超时按流中断处理并重试同歌", async () => {
  const { engine, fake, resolver } = createEngine({
    wait: async () => {},
    loadTimeoutMs: 10,
  });
  await engine.playList([song(1), song(2)], 0);
  await flush();
  fake.last().emit("playing");
  engine.pause();
  await flush();

  const pausedHandle = fake.last();
  const handlesBefore = fake.handles.length;
  // 模拟 CDN 卡死：继续播放的 play() 永不 resolve。
  pausedHandle.play = () => new Promise(() => {});
  engine.togglePlay();

  await waitFor(() => fake.handles.length > handlesBefore);
  await flush();

  // 超时后应重新取址装载同一首，而不是永远停在 loading。
  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  assert.equal(engine.getState().loading, false);
  assert.notEqual(fake.last(), pausedHandle);
  assert.equal(fake.last().src, "url://1");
  assert.equal(fake.last().playCalls, 1);
  assert.equal(engine.getState().lastPlaybackFailure, null);
  assert.equal(resolver.callsFor(1), 2); // 初始装载 + 看门狗超时后的同歌重试
});

test("loadTimeoutMs=0 关闭 resume 起播看门狗：挂起的 play() 不被超时打断", async () => {
  const { engine, fake } = createEngine({
    wait: async () => {},
    loadTimeoutMs: 0,
  });
  await engine.playList([song(1), song(2)], 0);
  await flush();
  fake.last().emit("playing");
  engine.pause();
  await flush();

  const pausedHandle = fake.last();
  let playCalls = 0;
  pausedHandle.play = () => {
    playCalls += 1;
    return new Promise(() => {});
  };
  engine.togglePlay();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await flush();

  // 0 = 关闭：不会判超时、不销毁/重载媒体，仅保持播放意图等待底层 promise。
  assert.equal(playCalls, 1);
  assert.equal(pausedHandle.destroyed, false);
  assert.equal(fake.last(), pausedHandle);
  assert.equal(engine.getState().lastPlaybackFailure, null);
});

// =============== 审查修复回归：失败通报清理 / URL 缓存回写 / 预取与销毁 ===============

test("显式播放经同歌重试成功后清除上一首遗留的失败通报", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  // S1 自身不可用：重试后自动跳到 S2，S1 的失败通报按设计保留。
  resolver.set(async (id) => {
    if (id === 1) throw failureError("Media", "播放源不可用");
    return `url://${id}`;
  });
  await engine.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(engine.getState().lastPlaybackFailure?.songId, 1);

  // 用户显式点播 S2，首次取址临时失败、同歌重试成功：这也是一次成功的
  // 用户点播，必须清除 S1 遗留的通报，不能一边正常播放一边留着旧错误。
  let s2Attempts = 0;
  resolver.set(async (id) => {
    if (id === 2) {
      s2Attempts += 1;
      if (s2Attempts === 1) throw failureError("Network", "网络请求失败");
    }
    return `url://${id}`;
  });
  engine.invalidateSongUrlCache();
  await engine.playSong(song(2));
  await flush();

  assert.equal(s2Attempts, 2);
  assert.equal(engine.getState().currentSongId, 2);
  assert.equal(engine.getState().lastPlaybackFailure, null);
});

test("取址超时后旧请求晚到：不得回写缓存覆盖重试拿到的地址", async () => {
  const { engine, fake, resolver } = createEngine({
    wait: async () => {},
    resolveTimeoutMs: 10,
  });
  let releaseOld = () => {};
  const oldGate = new Promise((resolve) => {
    releaseOld = () => resolve("url-old://1");
  });
  let attempt = 0;
  resolver.set((id) => {
    attempt += 1;
    return attempt === 1 ? oldGate : Promise.resolve(`url-new://${id}`);
  });

  const loading = engine.playList([song(1)], 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await loading;
  await flush();
  assert.equal(fake.last().src, "url-new://1");
  assert.equal(resolver.callsFor(1), 2); // 首次取址超时 + 同歌重试

  // 已超时的旧请求此刻才返回：它的结果被 invalidateSongUrl 取消过，
  // 不得把缓存里重试拿到的地址覆盖回那个超时地址。
  releaseOld();
  await flush();

  await engine.next(); // 单曲队列 loop-list：按当前索引重载
  await flush();

  // 命中缓存、不再请求上游，且装载的仍是重试后的新地址。
  assert.equal(resolver.callsFor(1), 2);
  assert.equal(fake.last().src, "url-new://1");
});

test("切歌后晚到的旧预取不得预热已跳过的歌曲", async () => {
  const { engine, fake, resolver } = createEngine({ wait: async () => {} });
  let releaseS2 = () => {};
  const gatedS2 = new Promise((resolve) => {
    releaseS2 = () => resolve("url://2");
  });
  resolver.set((id) => (id === 2 ? gatedS2 : Promise.resolve(`url://${id}`)));

  void engine.playList([song(1), song(2), song(3)], 0);
  await flush();
  assert.equal(engine.getState().currentSongId, 1);
  assert.deepEqual(fake.preloaded, []); // S2 的预取请求还悬着，尚未预热

  // S2 的预取请求还挂着时，用户连续切到 S3。
  void engine.next();
  await flush();
  assert.equal(engine.getState().index, 1);
  void engine.next();
  await flush();
  assert.equal(engine.getState().index, 2);
  assert.equal(engine.getState().currentSongId, 3);

  // 旧预取此刻才返回：目标已不再是“下一首”，不得为 S2 建流/下载。
  releaseS2();
  await flush();
  await flush();

  assert.equal(fake.preloaded.includes("url://2"), false);
});

test("destroy 释放媒体预热，避免销毁后仍在后台下载", async () => {
  const { engine, fake } = createEngine();
  await engine.playList([song(1), song(2)], 0);
  await flush();
  const before = fake.cancelledPreloads();

  engine.destroy();

  assert.equal(fake.cancelledPreloads(), before + 1);
});

test("登录过期（Unauthorized）是会话级失败：不自动重试也不自动跳歌", async () => {
  const { engine, resolver } = createEngine({ wait: async () => {} });
  resolver.set(async () => {
    throw failureError("Unauthorized", "登录已过期");
  });

  await engine.playList([song(1), song(2)], 0);
  await flush();

  // Unauthorized 不在 RETRYABLE_KINDS：不浪费一次同歌重试；也不跳下一首。
  assert.deepEqual(resolver.calls, [1]);
  assert.equal(engine.getState().index, 0);
  assert.equal(engine.getState().currentSongId, 1);
  const failure = engine.getState().lastPlaybackFailure;
  assert.ok(failure);
  assert.equal(failure.kind, "Unauthorized");
  assert.equal(failure.retryCount, 0);
  assert.equal(failure.advancedToNext, false);
  assert.equal(failure.failCount, 0);
});
