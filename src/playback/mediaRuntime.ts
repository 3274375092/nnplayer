// Media Runtime：Playback Engine 操作媒体的 seam。
// 一个 MediaHandle 对应一个媒体实例，即一个 Media Generation 的载体；
// 代际判定、迟到事件丢弃、状态推导都在 playbackEngine 内完成，
// adapter 只做最笨的转发。生产 adapter 见 htmlAudioRuntime.ts，
// 测试用 fake adapter 住在 tests/playbackEngine.test.mjs。

export type MediaEventType =
  | "play"
  | "playing"
  | "pause"
  | "timeupdate"
  | "loadedmetadata"
  | "durationchange"
  | "waiting"
  | "stalled"
  | "canplay"
  | "seeking"
  | "seeked"
  | "ratechange"
  | "ended"
  | "error";

export interface MediaEvent {
  type: MediaEventType;
  /** 仅 error 事件携带底层错误详情 */
  error?: unknown;
}

export interface MediaHandleOptions {
  /** 创建时应用的初始音量 0~1 */
  volume: number;
  /** 创建时应用的静音状态 */
  muted: boolean;
  /** 媒体事件回调；create 期间不得同步触发 */
  onEvent: (event: MediaEvent) => void;
}

export interface MediaHandle {
  /** 当前媒体时钟（秒）；rAF 消费者经引擎的 getMediaClockSample 直读 */
  readonly currentTime: number;
  /** 总时长（秒），未知时为 NaN */
  readonly duration: number;
  readonly playbackRate: number;
  readonly paused: boolean;
  readonly ended: boolean;
  /** 是否已缓冲到可继续播放（HAVE_FUTURE_DATA 及以上） */
  readonly hasFutureData: boolean;
  hasSource(): boolean;
  play(): Promise<void>;
  pause(): void;
  /** 直接设置媒体时钟位置（秒），调用方负责 clamp */
  seekTo(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** 销毁媒体实例；销毁后 adapter 不得再回调 onEvent（引擎另有代际防线） */
  destroy(): void;
}

export interface MediaRuntime {
  create(src: string, options: MediaHandleOptions): MediaHandle;
}
