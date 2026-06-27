// 桌面歌词窗口订阅 composable。
//
// 解决问题：主窗只在歌词状态变化时 emit 'desktop-lyrics:update'，
// 用户在中段打开浮窗时浮窗是空的。
//
// 工作流：
//   1. onMounted 立刻 listen 'desktop-lyrics:update'（主窗的常规推送）
//   2. listen 注册成功后立刻 emit 'desktop-lyrics:request-snapshot'
//   3. 主窗收到后调用 triggerDesktopLyricsPush() 推一份当前最新状态
//   4. 桌面歌词窗口的 state 被填充，开始正常渲染
//
// 注意 onMounted 里的两步顺序：必须先 listen 再 emit，否则请求会丢失。

import { onBeforeUnmount, onMounted, ref } from "vue";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DesktopLyricsBridgeState {
  /** 当前行文本 */
  current: string;
  /** 下一行文本 */
  next: string;
  /** 当前行进度的 0-1 百分比 */
  progress: number;
  /** 歌曲名 */
  songName: string;
  /** 艺术家 */
  artists: string;
  /** 完整歌词行（多行渲染用） */
  lines: { time: number; text: string; translation?: string }[];
  /** 当前行索引 */
  activeLineIndex: number;
  /** 行内毫秒进度（卡拉OK 用） */
  progressMs: number;
  /** 当前行卡拉OK 字符级时间窗 */
  karaokeTokens: { char: string; startMs: number; endMs: number }[];
  /** 封面提取的强调色（hex），供卡拉OK 逐字染色 */
  accentColor: string;
  /** 是否正在播放（子窗本地时钟据此决定是否前进） */
  playing: boolean;
}

const EMPTY: DesktopLyricsBridgeState = {
  current: "",
  next: "",
  progress: 0,
  songName: "",
  artists: "",
  lines: [],
  activeLineIndex: -1,
  progressMs: 0,
  karaokeTokens: [],
  accentColor: "#E85D3A",
  playing: false,
};

export function useDesktopLyricsBridge() {
  const state = ref<DesktopLyricsBridgeState>({ ...EMPTY });
  let unlisten: UnlistenFn | null = null;

  onMounted(async () => {
    // 1. 先订阅主窗推送
    unlisten = await listen<DesktopLyricsBridgeState>(
      "desktop-lyrics:update",
      (e) => {
        state.value = e.payload;
      },
    );
    // 2. 再请求一份当前快照
    await emit("desktop-lyrics:request-snapshot").catch(() => {});
  });

  onBeforeUnmount(() => {
    unlisten?.();
    unlisten = null;
  });

  return { state };
}