// HTMLAudio adapter：MediaRuntime seam 的生产实现。
// 一个 MediaHandle 包一个 <audio> 元素，只做最笨的属性/事件转发；
// 代际判定与状态推导都在 playbackEngine 内。
//
// 性能要点（2026-11 实测）：WebKitGTK 每次首次 play() 的媒体管线初始化会占
// 主线程 20–30ms，切歌时表现为 rAF 长帧。因此这里维护一个最多两个元素的池：
// 一个活跃播放，另一个由引擎在空闲时用 `preload()` 预热下一首，切歌直接
// 复用已预热的元素/管线，避免重复初始化与元素创建/销毁成本。

import type {
  MediaEventType,
  MediaHandle,
  MediaHandleOptions,
  MediaRuntime,
} from "./mediaRuntime";

const FORWARDED_EVENTS: MediaEventType[] = [
  "play",
  "playing",
  "pause",
  "timeupdate",
  "loadedmetadata",
  "durationchange",
  "waiting",
  "stalled",
  "canplay",
  "seeking",
  "seeked",
  "ratechange",
  "ended",
];

interface AudioPool {
  elements: [HTMLAudioElement, HTMLAudioElement];
  /** 当前活跃（正在被某个 MediaHandle 使用）的元素。 */
  active: HTMLAudioElement | null;
  /** 上一首 destroy 后释放、可供下次 create 复用的元素。 */
  released: HTMLAudioElement | null;
  /** 已预热到某个元素上的 src（用于切歌时命中缓冲）。 */
  preloadedSrc: Map<HTMLAudioElement, string>;
  /** 当前活跃句柄的事件解绑函数。 */
  cleanupBinding: (() => void) | null;
}

let pool: AudioPool | null = null;

function ensurePool(): AudioPool {
  if (pool) return pool;
  const elements: [HTMLAudioElement, HTMLAudioElement] = [
    new Audio(),
    new Audio(),
  ];
  for (const element of elements) {
    element.preload = "auto";
    // 不显示节点，但保留在 DOM 中以兼容部分 WebView。
    document.body.appendChild(element);
  }
  pool = {
    elements,
    active: null,
    released: null,
    preloadedSrc: new Map(),
    cleanupBinding: null,
  };
  return pool;
}

/** 切歌时选择承载新媒体的元素：优先命中预热的同 src 元素。 */
function pickCreateElement(state: AudioPool, src: string): HTMLAudioElement {
  const preloaded = state.elements.find(
    (element) =>
      element !== state.active && state.preloadedSrc.get(element) === src,
  );
  if (preloaded) return preloaded;
  if (state.released && state.released !== state.active) {
    return state.released;
  }
  return (
    state.elements.find((element) => element !== state.active) ??
    state.elements[0]
  );
}

export function createHtmlAudioRuntime(): MediaRuntime {
  return {
    create(src, options: MediaHandleOptions) {
      const state = ensurePool();
      // 引擎保证先 destroy 再 create；这里清理上一句柄监听只作为兜底。
      state.cleanupBinding?.();
      const element = pickCreateElement(state, src);
      const reusePreloaded = state.preloadedSrc.get(element) === src;
      state.preloadedSrc.delete(element);
      if (state.released === element) state.released = null;
      state.active = element;
      element.preload = "auto";
      element.muted = options.muted;
      element.volume = options.volume;

      let destroyed = false;
      const bound: Array<[string, EventListener]> = FORWARDED_EVENTS.map(
        (type) => [
          type,
          () => {
            if (!destroyed) options.onEvent({ type });
          },
        ],
      );
      bound.push([
        "error",
        () => {
          if (!destroyed) options.onEvent({ type: "error", error: element.error });
        },
      ]);
      for (const [type, listener] of bound) {
        element.addEventListener(type, listener);
      }
      const cleanupBinding = () => {
        for (const [type, listener] of bound) {
          element.removeEventListener(type, listener);
        }
        if (state.cleanupBinding === cleanupBinding) state.cleanupBinding = null;
      };
      state.cleanupBinding = cleanupBinding;
      // 已预热同一 src 时不要重设 src，避免把已建立的管线/缓冲又重置一次。
      if (!reusePreloaded) element.src = src;

      const handle: MediaHandle = {
        get currentTime() {
          return element.currentTime;
        },
        get duration() {
          return element.duration;
        },
        get playbackRate() {
          return element.playbackRate;
        },
        get paused() {
          return element.paused;
        },
        get ended() {
          return element.ended;
        },
        get hasFutureData() {
          return element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
        },
        hasSource: () => Boolean(element.getAttribute("src")),
        play: () => element.play(),
        pause: () => element.pause(),
        seekTo: (seconds) => {
          element.currentTime = seconds;
        },
        setVolume: (volume) => {
          element.volume = volume;
        },
        setMuted: (muted) => {
          element.muted = muted;
        },
        destroy: () => {
          if (destroyed) return;
          // 先解绑事件再 pause/load，销毁过程中的同步事件不再回调引擎。
          destroyed = true;
          cleanupBinding();
          element.pause();
          element.removeAttribute("src");
          element.load();
          state.preloadedSrc.delete(element);
          if (state.active === element) state.active = null;
          state.released = element;
        },
      };
      return handle;
    },

    preload(src: string) {
      const state = ensurePool();
      // 当前没有在播媒体时不额外建流（避免空闲时下载/初始化）。
      if (!state.active) return;
      // 省流/弱网用户不预取下一首音频，避免为了切歌速度消耗移动数据。
      const connection = (
        globalThis.navigator as
          | (Navigator & {
              connection?: { saveData?: boolean; effectiveType?: string };
            })
          | undefined
      )?.connection;
      if (
        connection?.saveData ||
        connection?.effectiveType === "slow-2g" ||
        connection?.effectiveType === "2g"
      ) {
        return;
      }
      const element =
        state.elements.find((candidate) => candidate !== state.active) ?? null;
      if (!element) return;
      if (
        state.preloadedSrc.get(element) === src &&
        element.readyState >= 1 /* HAVE_METADATA */
      ) {
        return;
      }
      state.preloadedSrc.set(element, src);
      // 预热元素绝不发声；真正 create 时会按引擎传入的 volume/muted 覆盖。
      element.muted = true;
      element.preload = "auto";
      element.src = src;
      element.load();
    },

    cancelPreload() {
      if (!pool) return;
      const state = pool;
      // 必须清掉所有非活跃元素：引擎在 notifyAuthEpochChanged / stopPlayback
      // 里先 destroyActiveMedia()（active 变成 null）再调用本方法，这时若只清
      // “第一个非活跃元素”，真正带着预热 src 的那个元素会被漏掉，旧账号/旧
      // 音质的缓冲会继续在后台下载。
      for (const element of state.elements) {
        if (element === state.active) continue;
        state.preloadedSrc.delete(element);
        element.pause();
        element.removeAttribute("src");
        element.load();
        element.muted = true;
      }
    },
  };
}
