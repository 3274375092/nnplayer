// useAudioPlayer：播放控制的统一入口。
// 双后端：
//   1. NCM 在线歌曲 → HTML5 <audio> 元素
//   2. 本地文件    → Rust symphonia+rodio 引擎（useAudioBridge）
// 外部调用方（playerStore / PlayerBarFloating / NowPlaying）无需感知后端差异。
//
// 设计要点：
//   1. 内部维护 currentBackend 状态，决定命令路由目标
//   2. 本地模式时，state.currentTime / duration / playing 由 useAudioBridge 桥接
//   3. NCM 模式时由 <audio> 事件驱动（保留旧行为）
//   4. 切歌时自动切换后端

import { onBeforeUnmount, reactive, readonly, watch, ref, computed } from "vue";
import type { Song } from "@/types/music";
import {
  getSongUrl,
  playLocal,
  pauseAudio,
  resumeAudio,
  toggleAudio,
  seekAudio,
  setAudioVolume,
  getAudioState,
} from "./useNcmApi";
import { useAudioBridge } from "./useAudioBridge";
import { getLocalCoverUrl } from "./useLocalCover";
import { useThemeStore } from "@/stores/theme";

/** 持久化当前本地歌曲的 key（WebView 刷新/应用重启后用于恢复 UI） */
const PERSIST_KEY = "nnplayer.currentLocalSong";

export interface AudioState {
  /** 当前播放的歌曲 id，没有则为 null */
  currentSongId: number | null;
  /** 是否正在播放 */
  playing: boolean;
  /** 是否正在缓冲 */
  loading: boolean;
  /** 当前时间（秒） */
  currentTime: number;
  /** 总时长（秒） */
  duration: number;
  /** 当前音量 0~1 */
  volume: number;
  /** 静音 */
  muted: boolean;
  /** 当前封面 URL（NCM 用 http URL，本地歌曲用 object URL），有歌时存在 */
  currentCover: string | undefined;
}

let singleton: ReturnType<typeof createPlayer> | null = null;

/**
 * 暴露给外部的 useAudioPlayer（单例）。
 * 多个组件 useAudioPlayer() 拿到同一个 controller。
 */
export function useAudioPlayer() {
  if (!singleton) singleton = createPlayer();
  return singleton;
}

function createPlayer() {
  const audio = new Audio();
  audio.preload = "auto";
  document.body.appendChild(audio);

  const bridge = useAudioBridge();

  // 当前后端模式
  const isLocal = ref(false);
  const currentPath = ref<string | undefined>(undefined); // 本地模式下的文件路径
  // 拉封面请求的 seq，避免过期回调覆盖
  let coverSeq = 0;

  const state = reactive<AudioState>({
    currentSongId: null,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: Number(localStorage.getItem("nnplayer.volume") ?? "0.8"),
    muted: false,
    currentCover: undefined,
  });

  audio.volume = state.volume;

  // 桥接 Rust 引擎的 state 到本地 AudioState
  // 仅在本地模式时同步；NCM 模式时由 <audio> 事件驱动
  let stateSyncCount = 0;
  console.log("[player] useAudioPlayer created, setting up bridge watchers");
  console.log("[player] bridge.state at setup time:", JSON.stringify({
    playing: bridge.state.playing,
    currentTime: bridge.state.currentTime,
    duration: bridge.state.duration,
    path: bridge.state.path,
  }));

  // 关键：直接轮询桥接器，绕过 Vue 3 watch 的潜在问题
  // 每 200ms 强制同步 local.state 与 bridge.state
  let localPollCount = 0;
  let seekingInProgress = false;
  let seekingTimeoutId: number | undefined;
  const localBridgePoll = window.setInterval(() => {
    localPollCount++;
    if (isLocal.value) {
      if (seekingInProgress) {
        // seek 期间 Rust 端还在重建 source，bridge.state 是过时的旧值
        // 等 bridge 追上乐观值（差 < 0.5s）就解除冻结
        if (Math.abs(bridge.state.currentTime - state.currentTime) < 0.5) {
          seekingInProgress = false;
          if (seekingTimeoutId !== undefined) {
            window.clearTimeout(seekingTimeoutId);
            seekingTimeoutId = undefined;
          }
          if (state.currentTime !== bridge.state.currentTime) {
            state.currentTime = bridge.state.currentTime;
          }
          if (state.playing !== bridge.state.playing) {
            state.playing = bridge.state.playing;
          }
          if (state.duration !== bridge.state.duration) {
            state.duration = bridge.state.duration;
          }
          if (localPollCount <= 3 || localPollCount % 10 === 0) {
            console.log(
              `[player] localPoll #${localPollCount} seek-caught-up bridge.t=${bridge.state.currentTime.toFixed(2)}s`,
            );
          }
        }
        // else: 仍 seeking，跳过所有 state 覆盖
      } else {
        if (state.currentTime !== bridge.state.currentTime) {
          state.currentTime = bridge.state.currentTime;
        }
        if (state.playing !== bridge.state.playing) {
          state.playing = bridge.state.playing;
        }
        if (state.duration !== bridge.state.duration) {
          state.duration = bridge.state.duration;
        }
        if (localPollCount <= 3 || localPollCount % 10 === 0) {
          console.log(
            `[player] localPoll #${localPollCount} bridge.t=${bridge.state.currentTime.toFixed(2)}s state.t=${state.currentTime.toFixed(2)}s playing=${state.playing}`,
          );
        }
      }
    }
  }, 200);
  console.log("[player] local bridge poll started (200ms)");

  watch(
    () => bridge.state.playing,
    (p) => {
      if (isLocal.value) {
        state.playing = p;
        stateSyncCount++;
        if (stateSyncCount % 5 === 1) {
          console.log(`[player] bridge→state playing=${p}`);
        }
      }
    },
  );
  watch(
    () => bridge.state.currentTime,
    (t) => {
      if (isLocal.value) state.currentTime = t;
    },
  );
  watch(
    () => bridge.state.duration,
    (d) => {
      if (isLocal.value) {
        state.duration = d;
        console.log(`[player] bridge→state duration=${d.toFixed(2)}s`);
      }
    },
  );

  // 最近一次 playSong 请求的序号，用于取消过时的异步结果
  let playSeq = 0;

  /** 加载本地歌曲封面，生成 object URL 并写入 state.currentCover。
   *  走 useLocalCover 缓存 + 触发主题色提取。 */
  async function loadLocalCover(path: string, seq: number) {
    const themeStore = useThemeStore();
    try {
      const url = await getLocalCoverUrl(path);
      if (seq !== coverSeq) return;
      state.currentCover = url ?? undefined;
      if (url) {
        // 触发封面驱动的动态主题色（colorExtractor 用 new Image() 读 blob URL）
        themeStore.applyFromCover(url);
      } else {
        themeStore.resetToDefault();
      }
    } catch (e) {
      if (seq !== coverSeq) return;
      state.currentCover = undefined;
      themeStore.resetToDefault();
      console.warn("[useAudioPlayer] 加载本地封面失败", e);
    }
  }

  /** 切换歌曲时清空封面引用（避免旧封面残留）。
   *  注意：不 revoke blob URL——本地封面由 useLocalCover 全局缓存统一管理
   *  生命周期（LRU 淘汰时统一 revoke），这里 revoke 会破坏列表/详情视图对同一 URL 的引用。 */
  function resetCover() {
    state.currentCover = undefined;
  }

  // =============== MediaSession 集成 ===============

  function syncMediaSession(song: Song | null) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (song) {
      const artwork = song.picUrl
        ? [{ src: song.picUrl, sizes: "512x512" as const }]
        : [];
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.name,
          artist: song.artists,
          album: song.album,
          artwork,
        });
      } catch {
        // 某些 WebView 不支持 MediaMetadata，忽略
      }
    } else {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        /* ignore */
      }
    }
  }

  function installMediaSessionHandlers() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:play"));
    });
    ms.setActionHandler("pause", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:pause"));
    });
    ms.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        window.dispatchEvent(
          new CustomEvent("nnplayer:media:seek", { detail: details.seekTime }),
        );
      }
    });
    ms.setActionHandler("previoustrack", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:prev"));
    });
    ms.setActionHandler("nexttrack", () => {
      window.dispatchEvent(new CustomEvent("nnplayer:media:next"));
    });
  }
  installMediaSessionHandlers();

  watch(
    () => state.playing,
    (p) => {
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        try {
          navigator.mediaSession.playbackState = p ? "playing" : "paused";
        } catch {
          /* ignore */
        }
      }
    },
  );

  // =============== <audio> 事件（NCM 模式） ===============

  const onPlay = () => {
    if (isLocal.value) return;
    state.playing = true;
  };
  const onPause = () => {
    if (isLocal.value) return;
    state.playing = false;
  };
  const onTimeUpdate = () => {
    if (isLocal.value) return;
    state.currentTime = audio.currentTime;
    if (
      typeof navigator !== "undefined" &&
      "mediaSession" in navigator &&
      "setPositionState" in navigator.mediaSession
    ) {
      try {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: Math.min(audio.currentTime, audio.duration),
          });
        }
      } catch {
        /* ignore */
      }
    }
  };
  const onLoadedMetadata = () => {
    if (isLocal.value) return;
    state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  };
  const onWaiting = () => {
    if (isLocal.value) return;
    state.loading = true;
  };
  const onCanPlay = () => {
    if (isLocal.value) return;
    state.loading = false;
  };
  const onEnded = () => {
    if (isLocal.value) return;
    state.playing = false;
    audio.dispatchEvent(new CustomEvent("nnplayer:ended"));
  };
  const onError = () => {
    if (isLocal.value) return;
    state.loading = false;
    state.playing = false;
    console.error("[audio] 播放失败", audio.error);
  };

  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("timeupdate", onTimeUpdate);
  audio.addEventListener("loadedmetadata", onLoadedMetadata);
  audio.addEventListener("waiting", onWaiting);
  audio.addEventListener("canplay", onCanPlay);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);

  // =============== 命令式方法 ===============

  /**
   * 加载并播放指定歌曲。
   * 根据 song.localPath 路由到 NCM（<audio>）或 Rust 引擎。
   */
  async function playSong(songId: number, song?: Song) {
    const seq = ++playSeq;
    const isLocalSong = !!song?.localPath;
    console.log(`[player] playSong id=${songId} localPath=${song?.localPath ?? "<none>"}`);

    if (isLocalSong && song && song.localPath) {
      // ─── 本地模式 ───
      isLocal.value = true;
      currentPath.value = song.localPath;
      state.loading = true;
      state.currentSongId = songId;
      state.currentTime = 0;
      state.duration = 0;
      // 新歌：解除上一次的 seek 冻结（如果残留的话）
      seekingInProgress = false;
      if (seekingTimeoutId !== undefined) {
        window.clearTimeout(seekingTimeoutId);
        seekingTimeoutId = undefined;
      }
      // 持久化当前歌（WebView 刷新/应用重启时用于恢复 UI 状态）
      persistCurrentLocalSong(song);
      // 异步拉封面
      const cseq = ++coverSeq;
      resetCover();
      void loadLocalCover(song.localPath, cseq);

      // 暂停 NCM <audio>
      audio.pause();
      audio.removeAttribute("src");
      try {
        await playLocal(song.localPath);
        console.log("[player] playLocal resolved, waiting for ticks...");
        if (seq !== playSeq) return;
        // 同步音量到 Rust 引擎
        try { await setAudioVolume(state.volume); } catch { /* ignore */ }
        syncMediaSession(song);
        // playing 状态由 bridge.state 桥接上来
        state.loading = false;
      } catch (e) {
        console.error("[player] playLocal failed:", e);
        if (seq !== playSeq) return;
        state.loading = false;
        isLocal.value = false;
        currentPath.value = undefined;
        throw e;
      }
      return;
    }

    // ─── NCM 模式：清除本地歌持久化 ───
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {
      /* localStorage 不可用静默 */
    }

    // ─── NCM 模式 ───
    isLocal.value = false;
    currentPath.value = undefined;
    const cseq = ++coverSeq;
    const themeStore = useThemeStore();
    // NCM 歌曲用 picUrl；本地歌曲已 async 加载覆盖
    if (song?.picUrl) {
      state.currentCover = song.picUrl;
      themeStore.applyFromCover(song.picUrl);
    } else {
      resetCover();
      themeStore.resetToDefault();
    }
    try {
      state.loading = true;
      state.currentSongId = songId;
      state.currentTime = 0;
      state.duration = 0;

      // 先暂停 Rust 引擎
      await pauseAudio();

      const res = await getSongUrl(songId);
      if (seq !== playSeq) return;
      if (!res.url) {
        throw new Error("该歌曲暂无可用播放源");
      }

      audio.pause();
      audio.src = res.url;
      if (song) {
        syncMediaSession(song);
      }
      await audio.play();
    } catch (e) {
      if (seq !== playSeq) return;
      state.loading = false;
      throw e;
    }
  }

  // =============== 持久化 + 启动恢复 ===============

  /**
   * 写当前本地歌到 localStorage（用于 WebView 刷新/应用重启后恢复 UI 状态）。
   * 注意：仅存 metadata，不存 position — position 从 Rust 端 snapshot 读，更准。
   */
  function persistCurrentLocalSong(song: Song) {
    try {
      localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({
          id: song.id,
          name: song.name,
          artists: song.artists,
          album: song.album,
          duration: song.duration,
          localPath: song.localPath,
          picUrl: song.picUrl,
          savedAt: Date.now(),
        }),
      );
    } catch {
      /* localStorage 不可用静默 */
    }
  }

  /**
   * 启动时调用：检查 Rust 引擎是否在播本地歌，如果是，把前端 state 对齐到 Rust。
   * 不调用 playLocal（Rust 已经在播了，调用会重置位置）。
   * @returns 对应的 Song（供 Pinia 塞进队列），未在播则返回 null
   */
  async function restoreIfPlaying(): Promise<Song | null> {
    try {
      const snap = await getAudioState();
      if (!snap.path) {
        console.log("[player] restore: Rust 端无活跃播放,跳过");
        return null;
      }

      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) {
        console.log("[player] restore: localStorage 无持久化歌曲,跳过");
        return null;
      }
      const saved = JSON.parse(raw) as Song & { savedAt: number };
      if (saved.localPath !== snap.path) {
        console.log(
          `[player] restore: 路径不匹配 (saved=${saved.localPath}, rust=${snap.path}),跳过`,
        );
        return null;
      }

      console.log(
        `[player] restore: 对齐到 Rust 状态, path=${snap.path} t=${snap.currentTime.toFixed(2)}s playing=${snap.playing}`,
      );

      // 对齐 state（不调 playLocal,Rust 端不动）
      isLocal.value = true;
      currentPath.value = saved.localPath;
      state.currentSongId = saved.id;
      state.currentTime = snap.currentTime;
      state.duration = snap.duration || saved.duration / 1000;
      state.playing = snap.playing;
      state.loading = false;
      state.volume = snap.volume;

      // 异步拉封面
      const cseq = ++coverSeq;
      void loadLocalCover(saved.localPath, cseq);

      return saved;
    } catch (e) {
      console.warn("[player] restore 失败", e);
      return null;
    }
  }

  /** 暂停：按后端路由 */
  function pause() {
    if (isLocal.value) {
      // 乐观更新：立即翻转 UI，不等 Rust 下一个 tick（≤200ms）回传
      state.playing = false;
      void pauseAudio();
    } else {
      audio.pause();
    }
  }

  /** 继续播放：按后端路由 */
  async function resume() {
    if (isLocal.value) {
      state.playing = true;
      try {
        await resumeAudio();
      } catch {
        /* 静默 */
      }
    } else {
      try {
        await audio.play();
      } catch {
        /* 用户手势被拒绝时静默处理 */
      }
    }
  }

  /** 切换播放/暂停：按后端路由 */
  function toggle() {
    if (isLocal.value) {
      // 复用 pause/resume 的乐观更新逻辑，而非裸调 toggleAudio
      if (state.playing) {
        pause();
      } else {
        void resume();
      }
    } else if (state.playing) {
      pause();
    } else {
      void resume();
    }
  }

  /** 跳转到指定秒数：按后端路由 */
  function seek(seconds: number) {
    console.log(`[player] seek(${seconds}) isLocal=${isLocal.value} max=${state.duration}`);
    if (isLocal.value) {
      // 乐观更新：立即写 state，让滑块即时跳到目标位置
      // 同时冻结 local poll 的 state 覆盖，避免 Rust 端重建 source 期间
      // bridge.state 暂存旧值时把 UI 拉回 → 闪烁
      state.currentTime = Math.max(0, Math.min(seconds, state.duration || seconds));
      seekingInProgress = true;
      if (seekingTimeoutId !== undefined) window.clearTimeout(seekingTimeoutId);
      // 5s 兜底：若 Rust seek 失败/卡死，强制解除冻结让 UI 跟随 bridge.state
      seekingTimeoutId = window.setTimeout(() => {
        if (seekingInProgress) {
          console.warn(`[player] seek 超时 5s 未追上，强制解除冻结 (bridge.t=${bridge.state.currentTime.toFixed(2)}, state.t=${state.currentTime.toFixed(2)})`);
          seekingInProgress = false;
        }
      }, 5000);
      void seekAudio(seconds);
    } else {
      if (!Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
    }
  }

  /** 设置音量 0~1：双后端都设置 */
  function setVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    state.volume = clamped;
    audio.volume = clamped;
    state.muted = clamped === 0;
    if (isLocal.value) {
      // 同步给 Rust 引擎
      setAudioVolume(clamped).catch(() => { /* 静默 */ });
    }
    localStorage.setItem("nnplayer.volume", String(clamped));
  }

  /** 切换静音 */
  function toggleMute() {
    state.muted = !state.muted;
    audio.muted = state.muted;
  }

  // 暴露当前后端信息（供外部使用，比如 useAudioPlayer 知道是否处于本地模式）
  const backendIsLocal = computed(() => isLocal.value);

  onBeforeUnmount(() => {
    window.clearInterval(localBridgePoll);
    if (seekingTimeoutId !== undefined) window.clearTimeout(seekingTimeoutId);
    audio.removeEventListener("play", onPlay);
    audio.removeEventListener("pause", onPause);
    audio.removeEventListener("timeupdate", onTimeUpdate);
    audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    audio.removeEventListener("waiting", onWaiting);
    audio.removeEventListener("canplay", onCanPlay);
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    audio.pause();
    audio.src = "";
    audio.remove();
  });

  return {
    state: readonly(state) as Readonly<AudioState>,
    playSong,
    pause,
    resume,
    toggle,
    seek,
    setVolume,
    toggleMute,
    backendIsLocal,
    audioEl: audio,
    restoreIfPlaying,
  };
}
