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
  picUrl?: string | null;
}

// 歌曲播放 URL
export interface SongUrl {
  id: number;
  url: string | null;
  /** bps；0 = 未知（上游未下发） */
  bitrate: number;
  /** 服务端实际下发档位；null = 未知（上游未返回或无法识别），
   *  不得回填成请求档位。 */
  actualLevel: AudioQuality | null;
}

// 歌单（列表项）
export interface Playlist {
  id: number;
  name: string;
  coverUrl: string;
  trackCount: number;
  creator?: string | null;
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

// 搜索建议（阶段1）
export interface SearchSuggestion {
  keyword: string;
  song?: Song | null;
}

// 歌词（阶段3）
export interface LyricResult {
  lrc: string | null;
  tLrc: string | null;
  /** YRC 逐字歌词 */
  yLrc: string | null;
}

// 登录态
export interface AuthState {
  loggedIn: boolean;
  nickname?: string | null;
  userId?: number | null;
  loginMethod?: "qr" | "account" | "phone" | "cookie" | "unknown" | null;
  avatarUrl?: string | null;
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

// 播放音质档位（网易云 song/url/v1 的 level 参数，六档常规阶梯，
// 不含环绕声/杜比等声场特效档）。用户选择的是“请求档位”；服务端会按
// 账号 VIP/SVIP 权益下发，实际档位以 SongUrl.actualLevel 为准。
export type AudioQuality =
  | "standard"
  | "higher"
  | "exhigh"
  | "lossless"
  | "hires"
  | "jymaster";
