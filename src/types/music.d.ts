/**
 * 全局音乐类型定义。
 * 与 Rust 端 models.rs 字段严格对齐（camelCase）。
 */

// 单首歌曲
export interface Song {
  id: number;
  name: string;
  artists: string;
  album: string;
  /** 毫秒 */
  duration: number;
  picUrl?: string;
}

// 歌曲播放 URL
export interface SongUrl {
  id: number;
  url: string | null;
  /** bps */
  bitrate: number;
}

// 歌单（列表项）
export interface Playlist {
  id: number;
  name: string;
  coverUrl: string;
  trackCount: number;
  creator?: string;
}

// 歌单详情
export interface PlaylistDetail {
  playlist: Playlist;
  songs: Song[];
}

// 搜索结果
export interface SearchResult {
  songs: Song[];
  total: number;
}

// 每日推荐
export interface DailyRecommend {
  songs: Song[];
  date: string;
}

// 登录态
export interface AuthState {
  loggedIn: boolean;
  nickname?: string;
  userId?: number;
  loginMethod?: "qr" | "account" | "phone" | "cookie" | "unknown";
}

// 后端错误结构
export interface AppErrorPayload {
  kind:
    | "Unauthorized"
    | "Ncm"
    | "Network"
    | "Json"
    | "Io"
    | "Store"
    | "InvalidParam"
    | "Internal";
  message: string;
}

// 播放模式
export type PlayMode = "loop-one" | "loop-list" | "shuffle";

// 通用 Result 包装，便于前端统一处理错误
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorPayload };