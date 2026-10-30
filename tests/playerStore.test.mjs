// player store 装配层测试：音质链路（resolver 副作用 × 引擎预取/缓存）。
// 通过 transpile + data URL 加载真实 player.ts / playbackEngine.ts /
// audioQuality.ts，替换 Vue/Pinia 为真实包、IPC 与媒体运行时为桩，
// 覆盖引擎单测覆盖不了的『实际码率展示』交互。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as tick } from "node:timers/promises";
import test, { afterEach } from "node:test";
import ts from "typescript";
import { createPinia, setActivePinia } from "pinia";

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

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
    compiled = compiled.replaceAll(
      JSON.stringify(specifier),
      JSON.stringify(replacement),
    );
  }
  return dataModule(compiled);
}

// 桩：可控的 NCM getSongUrl（记录调用、可切换实现）。
const ncmStubModule = dataModule(`
export const ncmCalls = [];
export const ncmStub = { resolve: async () => ({ url: null, bitrate: 0, actualLevel: null }) };
export function getSongUrl(songId, level) {
  ncmCalls.push({ songId, level });
  return Promise.resolve(ncmStub.resolve(songId, level));
}
`);

// 桩：无副作用 MediaSession 适配。
const mediaSessionStubModule = dataModule(`
export function attachMediaSession() { return () => {}; }
`);
// 桩：可捕获订阅、可手动旋转的 auth epoch（模拟登出/换号）。
const authEpochStubModule = dataModule(`
export const authState = { epoch: 0, listeners: new Set() };
export function getAuthEpoch() { return authState.epoch; }
export function subscribeAuthEpoch(listener) {
  authState.listeners.add(listener);
  return () => authState.listeners.delete(listener);
}
export function setAuthEpoch(epoch) {
  authState.epoch = epoch;
  for (const listener of [...authState.listeners]) listener(epoch);
  return epoch;
}
`);

// 桩：fake HTMLAudio runtime（node 下无 DOM），行为对齐引擎测试的 fake。
const htmlAudioStubModule = dataModule(`
export const handles = [];
export function createHtmlAudioRuntime() {
  return {
    create(src, options) {
      const handle = {
        src,
        currentTime: 0,
        duration: NaN,
        paused: true,
        ended: false,
        hasFutureData: true,
        destroyed: false,
        volume: options.volume,
        muted: options.muted,
        playCalls: 0,
        hasSource: () => !handle.destroyed,
        play: async () => { handle.playCalls += 1; handle.paused = false; },
        pause: () => { handle.paused = true; },
        seekTo: (seconds) => { handle.currentTime = seconds; },
        setVolume: (v) => { handle.volume = v; },
        setMuted: (m) => { handle.muted = m; },
        destroy: () => { handle.destroyed = true; },
        emit: (type, extra = {}) => options.onEvent({ type, ...extra }),
      };
      handles.push(handle);
      return handle;
    },
  };
}
`);

// data URL 模块无法解析裸包名，vue/pinia 需重写为真实 file URL。
const syncUrl = await compileTypeScriptModule("../src/lyrics/desktopLyricsSync.ts");
const engineUrl = await compileTypeScriptModule("../src/playback/playbackEngine.ts", new Map([
  ["@/lyrics/desktopLyricsSync", syncUrl],
]));
const audioQualityUrl = await compileTypeScriptModule("../src/utils/audioQuality.ts");
const playerUrl = await compileTypeScriptModule("../src/stores/player.ts", new Map([
  ["pinia", import.meta.resolve("pinia")],
  ["vue", import.meta.resolve("vue")],
  ["@/playback/playbackEngine", engineUrl],
  ["@/playback/htmlAudioRuntime", htmlAudioStubModule],
  ["@/playback/mediaSessionAdapter", mediaSessionStubModule],
  ["@/services/authEpoch", authEpochStubModule],
  ["@/composables/useNcmApi", ncmStubModule],
  ["@/utils/audioQuality", audioQualityUrl],
]));
const { usePlayerStore } = await import(playerUrl);
const { ncmCalls, ncmStub } = await import(ncmStubModule);
const { handles } = await import(htmlAudioStubModule);
const { setAuthEpoch } = await import(authEpochStubModule);

/** 等待微任务与已排队的宏任务全部跑完（装载 → 预取 → 码率写入链）。 */
async function flush() {
  await tick();
  await tick();
  await tick();
  await tick();
}

function song(id) {
  return { id, name: `S${id}`, artists: "a", album: "al", duration: 1000 };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 每个用例创建的 store 都登记下来，用例结束统一 $dispose，避免跨用例的
 *  订阅/引擎实例相互污染（L12）。 */
const liveStores = [];

function setupStore() {
  setActivePinia(createPinia());
  ncmCalls.length = 0;
  handles.length = 0;
  const store = usePlayerStore();
  liveStores.push(store);
  return store;
}

afterEach(() => {
  for (const store of liveStores.splice(0)) store.$dispose();
  ncmStub.resolve = async () => ({ url: null, bitrate: 0, actualLevel: null });
  setAuthEpoch(0);
});

test("预取下一首不覆盖当前曲的实际码率与档位展示", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: songId === 1 ? 128_000 : 320_000,
    actualLevel: songId === 1 ? "standard" : "exhigh",
  });
  const player = setupStore();
  await player.playList([song(1), song(2)], 0);
  await flush();

  assert.equal(player.currentSong?.id, 1);
  // 预取 song(2) 已完成（其信息已按曲记录），但当前曲仍显示 song(1) 的实际值。
  assert.equal(ncmCalls.length, 2);
  assert.equal(player.activeBitrate, 128_000);
  assert.equal(player.activeQuality, "standard");
  assert.equal(player.activeAudioResolved, true);
});

test("下一首命中预取 URL 缓存时仍能显示其实际码率与档位", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: songId === 1 ? 128_000 : 320_000,
    actualLevel: songId === 1 ? "standard" : "exhigh",
  });
  const player = setupStore();
  await player.playList([song(1), song(2)], 0);
  await flush();
  assert.equal(ncmCalls.length, 2);

  await player.next();
  await flush();

  assert.equal(player.currentSong?.id, 2);
  // 缓存命中不再经过上游 resolver，信息只能来自预取时写入的按曲记录。
  assert.equal(ncmCalls.length, 2);
  assert.equal(player.activeBitrate, 320_000);
  assert.equal(player.activeQuality, "exhigh");
});

test("切换音质后在途旧档位请求晚到不得覆盖新档位实际档位", async () => {
  const firstRequest = deferred();
  const player = setupStore();
  const initialQuality = player.quality;
  // 不写死 "exhigh"：以 store 的实际初始档位区分旧请求，并切到另一个档位。
  const targetQuality = initialQuality === "lossless" ? "hires" : "lossless";
  ncmStub.resolve = (songId, level) =>
    level === initialQuality
      ? firstRequest.promise
      : Promise.resolve({
          url: `url://${songId}-${targetQuality}`,
          bitrate: 999_000,
          actualLevel: targetQuality,
        });

  const playing = player.playList([song(1)], 0);
  await flush(); // 装载链推进到等待旧档位请求
  assert.equal(ncmCalls.at(-1).level, initialQuality); // 首个请求确实使用切换前的档位
  player.setQuality(targetQuality);
  // 切档瞬间旧实际信息必须作废，UI 进入“解析中”，不能继续显示旧档位。
  assert.equal(player.activeQuality, null);
  assert.equal(player.activeAudioResolved, false);
  await flush(); // 当前曲已按新档位重载完成

  // 旧档位请求此刻才返回，属于已被替换的代际。
  firstRequest.resolve({
    url: "exhigh://1",
    bitrate: 128_000,
    actualLevel: initialQuality,
  });
  await playing;
  await flush();

  assert.equal(player.quality, targetQuality);
  assert.equal(player.audioState.currentSongId, 1);
  assert.equal(player.activeBitrate, 999_000);
  assert.equal(player.activeQuality, targetQuality);
});

test("服务端未返回档位与码率时实际信息显示为未知但已解析", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: 0,
    actualLevel: null,
  });
  const player = setupStore();
  await player.playList([song(1)], 0);
  await flush();

  assert.equal(player.currentSong?.id, 1);
  assert.equal(player.activeBitrate, null);
  assert.equal(player.activeQuality, null);
  // 解析已完成：UI 应显示“未知”而不是“解析中”。
  assert.equal(player.activeAudioResolved, true);
});

test("服务端只返回码率时实际档位为未知，码率照实展示", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: 320_000,
    actualLevel: null,
  });
  const player = setupStore();
  await player.playList([song(1)], 0);
  await flush();

  assert.equal(player.activeBitrate, 320_000);
  assert.equal(player.activeQuality, null);
  assert.equal(player.activeAudioResolved, true);
});

test("实际下发档位低于所选档位时 activeQuality 反映真实档位", async () => {
  const player = setupStore();
  // 非 VIP 账号选“无损”，服务端实际只给 exhigh/320k。
  player.setQuality("lossless");
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: 320_000,
    actualLevel: "exhigh",
  });
  await player.playList([song(1)], 0);
  await flush();

  assert.equal(player.quality, "lossless");
  assert.equal(player.activeQuality, "exhigh");
  assert.equal(player.activeBitrate, 320_000);
});

test("暂停时切换音质保持暂停（不自动播放）", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: 320_000,
    actualLevel: "exhigh",
  });
  const player = setupStore();
  await player.playList([song(1)], 0);
  await flush();
  handles.at(-1).emit("playing"); // fake runtime 不自动发 playing，先确认播放中
  assert.equal(player.audioState.playing, true);

  player.togglePlay(); // playing → pause
  await flush();
  assert.equal(player.audioState.playing, false);

  player.setQuality("lossless");
  await flush();

  // 新档位重新装载，但暂停意图必须保留：不调用 play()，状态仍是暂停。
  assert.equal(player.audioState.playing, false);
  assert.equal(player.audioState.currentSongId, 1);
  assert.equal(handles.at(-1).playCalls, 0);
  assert.equal(handles.at(-1).paused, true);
});

test("切音质时重载 IPC 失败不推进队列/索引，也不写播放历史", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: 320_000,
    actualLevel: "exhigh",
  });
  const player = setupStore();
  await player.playList([song(1), song(2), song(3)], 0);
  await flush();
  assert.equal(player.index, 0);
  assert.equal(player.history.length, 1);
  const callsBefore = ncmCalls.length; // 载入 song1 + 预取 song2
  assert.equal(callsBefore, 2);

  ncmStub.resolve = async () => {
    throw new Error("Network 断网");
  };
  player.setQuality("lossless");
  await flush();
  await flush();

  // 重载失败不得被当成播放失败而 next()，否则切音质会静默跳过歌曲。
  assert.equal(player.index, 0);
  assert.equal(player.currentSong?.id, 1);
  assert.equal(player.history.length, 1);
  // 只发生一次重载请求；若走自动切歌会连锁请求 song2/song3。
  assert.equal(ncmCalls.length, callsBefore + 1);
});

test("迟到的旧 auth epoch 响应不得覆盖新会话的实际档位与码率", async () => {
  const oldSession = deferred();
  const newSession = deferred();
  const pending = [oldSession, newSession];
  ncmStub.resolve = () => pending.shift().promise;
  const player = setupStore();

  const oldLoad = player.playList([song(1)], 0); // 旧 epoch 的请求在途
  await flush();
  assert.equal(ncmCalls.length, 1);

  setAuthEpoch(1); // 登出/换号：store 清空实际音质记录，引擎隔离旧账号结果
  await flush();
  const newLoad = player.playList([song(1)], 0); // 新会话下重新播放
  await flush();
  assert.equal(ncmCalls.length, 2);

  newSession.resolve({
    url: "url://1-new",
    bitrate: 999_000,
    actualLevel: "lossless",
  });
  await newLoad;
  await flush();
  assert.equal(player.activeBitrate, 999_000);
  assert.equal(player.activeQuality, "lossless");

  // 旧 epoch 请求此刻才返回：其实际档位属于旧账号，不得覆盖新会话记录。
  oldSession.resolve({
    url: "url://1-old",
    bitrate: 128_000,
    actualLevel: "standard",
  });
  await oldLoad;
  await flush();
  assert.equal(player.audioState.currentSongId, 1);
  assert.equal(player.activeBitrate, 999_000);
  assert.equal(player.activeQuality, "lossless");
});

test("setQuality 传入当前档位是同值 no-op：不重载、不请求上游", async () => {
  ncmStub.resolve = async (songId) => ({
    url: `url://${songId}`,
    bitrate: 128_000,
    actualLevel: "standard",
  });
  const player = setupStore();
  await player.playList([song(1)], 0);
  await flush();
  const callsBefore = ncmCalls.length;
  const handlesBefore = handles.length;
  const currentSongIdBefore = player.audioState.currentSongId;

  player.setQuality(player.quality); // 选中已生效的档位：必须早退
  await flush();

  // 若早退被移除，这里会清空实际音质记录、失效 URL 缓存并重载当前曲。
  assert.equal(ncmCalls.length, callsBefore);
  assert.equal(handles.length, handlesBefore);
  assert.equal(handles.at(-1).destroyed, false);
  assert.equal(player.audioState.currentSongId, currentSongIdBefore);
  assert.equal(player.activeAudioResolved, true);
  assert.equal(player.activeBitrate, 128_000);
  assert.equal(player.activeQuality, "standard");
});

test("A→B→A 快速切档：被取代的旧 A 请求不得覆盖最新 A 实际元数据", async () => {
  // 每次请求各自挂起，以便精确控制谁先返回。
  const requests = [];
  ncmStub.resolve = (songId, level) => {
    const request = deferred();
    requests.push({ songId, level, ...request });
    return request.promise;
  };
  const player = setupStore();
  const qualityA = player.quality;
  const qualityB = qualityA === "lossless" ? "hires" : "lossless";

  const firstLoad = player.playList([song(1)], 0);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].level, qualityA);

  player.setQuality(qualityB);
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].level, qualityB);

  // 切回 A：档位字符串回到旧值，旧 A 请求只能靠代际识别为已过期。
  player.setQuality(qualityA);
  await flush();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].level, qualityA);

  // 最新 A 请求先返回。
  requests[2].resolve({
    url: "url://1-new",
    bitrate: 999_000,
    actualLevel: "lossless",
  });
  await flush();
  assert.equal(player.activeBitrate, 999_000);
  assert.equal(player.activeQuality, "lossless");

  // 被取代的旧 A 请求此刻才返回：同为 A 档位，不得覆盖新一代结果。
  requests[0].resolve({
    url: "url://1-old",
    bitrate: 128_000,
    actualLevel: "standard",
  });
  await firstLoad;
  await flush();
  assert.equal(player.audioState.currentSongId, 1);
  assert.equal(player.activeBitrate, 999_000);
  assert.equal(player.activeQuality, "lossless");
});

test("store 创建时读取持久化的音质档位，切档后回写", async () => {
  const { writeStoredAudioQuality } = await import(audioQualityUrl);
  const previousLocalStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = {
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => void stored.set(key, String(value)),
    removeItem: (key) => void stored.delete(key),
  };
  try {
    writeStoredAudioQuality("lossless");
    const player = setupStore();
    assert.equal(player.quality, "lossless");

    player.setQuality("hires");
    assert.equal(player.quality, "hires");
    // key 从桩里取，不复制生产字面量。
    const [storedKey] = stored.keys();
    assert.ok(storedKey, "切档后应回写持久化存储");
    assert.equal(stored.get(storedKey), "hires");
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
});
