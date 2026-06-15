// useAudioPlayer：封装 HTML5 <audio> 的全部操作。
// 设计要点：
//   1. 单例 audio 元素，避免每首歌创建新的播放器
//   2. 暴露 reactive 状态（当前时间、总时长、播放中、缓冲中）
//   3. 提供 play/pause/seek/setVolume 等命令式方法
//   4. 与 Pinia player store 解耦：store 负责状态，composable 负责 DOM 操作

import { onBeforeUnmount, reactive, readonly } from "vue";
import { getSongUrl } from "./useNcmApi";

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
}

/**
 * 创建并管理全局唯一的 <audio> 元素。
 * 返回 reactive 状态 + 操作方法。
 */
export function useAudioPlayer() {
  // 1. 创建 audio 元素并挂载到 body（display:none）
  const audio = new Audio();
  audio.preload = "auto";
  // 不在 DOM 中显示节点，但保留以便某些浏览器要求 audio 在文档中
  document.body.appendChild(audio);

  const state = reactive<AudioState>({
    currentSongId: null,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: Number(localStorage.getItem("nnplayer.volume") ?? "0.8"),
    muted: false,
  });

  audio.volume = state.volume;

  // =============== 事件监听 ===============

  const onPlay = () => {
    state.playing = true;
  };
  const onPause = () => {
    state.playing = false;
  };
  const onTimeUpdate = () => {
    state.currentTime = audio.currentTime;
  };
  const onLoadedMetadata = () => {
    state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  };
  const onWaiting = () => {
    state.loading = true;
  };
  const onCanPlay = () => {
    state.loading = false;
  };
  const onEnded = () => {
    state.playing = false;
    // 通知 store 让其切下一首
    audio.dispatchEvent(new CustomEvent("nnplayer:ended"));
  };
  const onError = () => {
    state.loading = false;
    state.playing = false;
    // eslint-disable-next-line no-console
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
   * 1. 先调用 Rust get_song_url 拿到真实 url
   * 2. 设置 audio.src 并 play()
   */
  async function playSong(songId: number) {
    try {
      state.loading = true;
      state.currentSongId = songId;

      const res = await getSongUrl(songId);
      if (!res.url) {
        throw new Error("该歌曲暂无可用播放源");
      }

      // 切换歌曲前先暂停旧的，避免某些浏览器拒绝 autoplay
      audio.pause();
      audio.src = res.url;
      await audio.play();
    } catch (e) {
      state.loading = false;
      throw e;
    }
  }

  /** 暂停 */
  function pause() {
    audio.pause();
  }

  /** 继续播放 */
  async function resume() {
    try {
      await audio.play();
    } catch {
      /* 用户手势被拒绝时静默处理 */
    }
  }

  /** 切换播放/暂停 */
  function toggle() {
    if (state.playing) {
      pause();
    } else {
      void resume();
    }
  }

  /** 跳转到指定秒数 */
  function seek(seconds: number) {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
  }

  /** 设置音量 0~1 */
  function setVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    state.volume = clamped;
    audio.volume = clamped;
    state.muted = clamped === 0;
    localStorage.setItem("nnplayer.volume", String(clamped));
  }

  /** 切换静音 */
  function toggleMute() {
    state.muted = !state.muted;
    audio.muted = state.muted;
  }

  // =============== 清理 ===============

  onBeforeUnmount(() => {
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
    state: readonly(state),
    playSong,
    pause,
    resume,
    toggle,
    seek,
    setVolume,
    toggleMute,
    /** 暴露底层 audio 元素，便于特殊场景（如自定义波形） */
    audioEl: audio,
  };
}