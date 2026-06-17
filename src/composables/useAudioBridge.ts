import { reactive } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  playLocal,
  pauseAudio,
  resumeAudio,
  toggleAudio,
  seekAudio,
  setAudioVolume,
  getAudioState,
} from "@/composables/useNcmApi";
import type { AudioStateSnapshot } from "@/types/music";

interface BridgeRefs {
  state: AudioStateSnapshot;
  setup: () => Promise<void>;
  teardown: () => void;
  play: (path: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  toggle: () => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

let singleton: BridgeRefs | null = null;

function createBridge(): BridgeRefs {
  const state = reactive<AudioStateSnapshot>({
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    path: null,
  });

  let unlistenTick: UnlistenFn | undefined;
  let unlistenEnded: UnlistenFn | undefined;
  let pollTimer: number | undefined;
  let tickCount = 0;

  async function setup() {
    console.log("[bridge] setup: registering audio:tick listener...");
    unlistenTick = await listen<AudioStateSnapshot>("audio:tick", (e) => {
      tickCount++;
      state.playing = e.payload.playing;
      state.currentTime = e.payload.currentTime;
      state.duration = e.payload.duration;
      state.volume = e.payload.volume;
      state.path = e.payload.path;
      if (tickCount % 5 === 1) {
        console.log(
          `[bridge] tick #${tickCount} playing=${e.payload.playing} t=${e.payload.currentTime.toFixed(2)}s dur=${e.payload.duration.toFixed(2)}s`,
        );
      }
    });

    unlistenEnded = await listen<void>("audio:ended", () => {
      console.log("[bridge] audio:ended received");
      state.playing = false;
      window.dispatchEvent(new CustomEvent("nnplayer:ended"));
    });

    // 每 200ms 主动拉一次 Rust 端 state 作为兜底，确保即使 audio:tick 事件
    // 丢失、Vue watch 不触发，UI 也能更新。
    // 关键：仅在本地引擎有活跃播放（state.path 非空）时才发 IPC，
    // 避免空闲/NCM 模式下空轮询每 200ms 白跑一次跨进程 invoke。
    let pollCount = 0;
    pollTimer = window.setInterval(async () => {
      if (!state.path) return;
      try {
        const snap = await getAudioState();
        if (snap.path) {
          // 直接赋值（不 readonly）确保触发响应式
          if (state.currentTime !== snap.currentTime) {
            state.currentTime = snap.currentTime;
          }
          if (state.playing !== snap.playing) {
            state.playing = snap.playing;
          }
          if (state.duration !== snap.duration) {
            state.duration = snap.duration;
          }
          if (state.path !== snap.path) {
            state.path = snap.path;
          }
          if (state.volume !== snap.volume) {
            state.volume = snap.volume;
          }
        }
      } catch {
        // 静默忽略
      }
      pollCount++;
      if (pollCount % 25 === 1) {
        console.log(
          `[bridge] poll #${pollCount} t=${state.currentTime.toFixed(2)}s playing=${state.playing}`,
        );
      }
    }, 200);
  }

  function teardown() {
    unlistenTick?.();
    unlistenEnded?.();
    if (pollTimer) window.clearInterval(pollTimer);
  }

  async function play(path: string) {
    await playLocal(path);
    state.path = path;
    state.playing = true;
  }

  async function pause() {
    await pauseAudio();
  }

  async function resume() {
    await resumeAudio();
  }

  async function toggle() {
    await toggleAudio();
  }

  async function seek(seconds: number) {
    await seekAudio(seconds);
  }

  async function setVolume(volume: number) {
    await setAudioVolume(volume);
    state.volume = volume;
  }

  return { state, setup, teardown, play, pause, resume, toggle, seek, setVolume };
}

export function useAudioBridge() {
  if (!singleton) {
    singleton = createBridge();
  }
  return singleton;
}
