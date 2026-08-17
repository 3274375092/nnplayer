// HTMLAudio adapter：MediaRuntime seam 的生产实现。
// 一个 MediaHandle 包一个 <audio> 元素，只做最笨的属性/事件转发；
// 代际判定与状态推导都在 playbackEngine 内。

import type {
  MediaEventType,
  MediaHandle,
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

export function createHtmlAudioRuntime(): MediaRuntime {
  return {
    create(src, options) {
      const element = new Audio();
      element.preload = "auto";
      element.volume = options.volume;
      element.muted = options.muted;

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

      // 不显示节点，但保留在 DOM 中以兼容部分 WebView。
      document.body.appendChild(element);
      element.src = src;

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
          for (const [type, listener] of bound) {
            element.removeEventListener(type, listener);
          }
          element.pause();
          element.removeAttribute("src");
          element.load();
          element.remove();
        },
      };
      return handle;
    },
  };
}
