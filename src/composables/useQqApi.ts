// QQ 音乐 invoke 薄包装。
// 目的：
//   1. 统一错误处理
//   2. 集中维护命令名称，避免字符串散落各处
//   3. 与 useNcmApi.ts 完全平行，便于消费者按 platform 路由
//
// 与 useNcmApi.ts 的关键差异：
//   - 登录走「cookie 粘贴」而非 QR/账号/手机验证码
//   - 业务命令与 NCM 对称（搜索/播放/歌词/推荐/歌单）
//   - ID 透传为字符串（QQ song mid），后端在 DTO 边界折叠为 u64

import { invoke } from "@tauri-apps/api/core";
import type { LyricResult, Playlist, PlaylistDetail, Song, SongUrl } from "@/types/music";

/**
 * QQ 音乐后端命令名称常量。
 * 与 src-tauri/src/lib.rs 中 invoke_handler 注册的 QQ 命令一一对应。
 */
export const QqCommands = {
  // 认证
  QqLoginSetCookie: "qq_login_set_cookie",
  QqLoginQrKey: "qq_login_qr_key",
  QqLoginQrCheck: "qq_login_qr_check",
  QqGetAuthState: "qq_get_auth_state",
  QqLogout: "qq_logout",
  // 调试
  QqDebugRawQr: "qq_debug_raw_qr",
  // 业务
  QqSearchSongs: "qq_search_songs",
  QqGetSongUrl: "qq_get_song_url",
  QqGetLyric: "qq_get_lyric",
  QqGetDailyRecommend: "qq_get_daily_recommend",
  QqGetUserPlaylists: "qq_get_user_playlists",
  QqGetPlaylistDetail: "qq_get_playlist_detail",
} as const;

/**
 * 统一调用入口：成功返回 data，失败抛出 Error，message 为后端 message。
 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "未知错误";
    throw new Error(message);
  }
}

// =============== 认证 ===============

/** QQ 登录状态 DTO。 */
export interface QqAuthState {
  loggedIn: boolean;
  userId?: number;
  loginMethod?: string;
  cookie?: string;
}

/** QQ 登录二维码 DTO。 */
export interface QqLoginQr {
  sessionId: string;
  qrImage: string;
}

/** QQ 扫码登录轮询响应。 */
export interface QqLoginCheckDto {
  code: "WaitingScan" | "WaitingConfirm" | "Success" | "QrCodeExpired" | "Failed";
  token?: { userId: number; cookie: string; loginType: number };
}

/** QQ 二维码登录第一步：获取二维码 + 创建 MQTT session。 */
export function qqLoginQrKey() {
  return call<QqLoginQr>(QqCommands.QqLoginQrKey);
}

/** QQ 二维码登录第二步：轮询扫码状态（MQTT 长连接，1500ms 超时自动降级为非终止态）。 */
export function qqLoginQrCheck(sessionId: string) {
  return call<QqLoginCheckDto>(QqCommands.QqLoginQrCheck, { sessionId });
}

/** QQ cookie 粘贴登录。返回 cookie 字符串和 userId。 */
export function qqLoginSetCookie(cookie: string) {
  return call<{ userId: number; cookie: string; loginType: number }>(
    QqCommands.QqLoginSetCookie,
    { cookie },
  );
}

/** 获取当前 QQ 登录状态。 */
export function qqGetAuthState() {
  return call<QqAuthState>(QqCommands.QqGetAuthState);
}

/** QQ 退出登录。 */
export function qqLogout() {
  return call<void>(QqCommands.QqLogout);
}

// =============== 调试 ===============

/** 获取 QQ CreateQRCode API 原始响应（含响应 status + body）。 */
export function qqDebugRawQr() {
  return call<string>(QqCommands.QqDebugRawQr);
}

// =============== 业务 ===============

/** QQ 搜索歌曲。limit 默认 30，offset 默认 0。 */
export function qqSearchSongs(keyword: string, limit = 30, offset = 0) {
  return call<Song[]>(QqCommands.QqSearchSongs, { keyword, limit, offset });
}

/** QQ 获取播放 URL。songId 透传为字符串（QQ mid）。 */
export function qqGetSongUrl(songId: string) {
  return call<SongUrl>(QqCommands.QqGetSongUrl, { songId });
}

/** QQ 获取歌词。 */
export function qqGetLyric(songId: string) {
  return call<LyricResult>(QqCommands.QqGetLyric, { songId });
}

/** QQ 每日推荐。 */
export function qqGetDailyRecommend() {
  return call<Playlist[]>(QqCommands.QqGetDailyRecommend);
}

/** QQ 获取当前登录用户的歌单。未登录时返回空数组。 */
export function qqGetUserPlaylists() {
  return call<Playlist[]>(QqCommands.QqGetUserPlaylists);
}

/** QQ 获取歌单详情。playlistId 来自 Playlist.id（后端折叠为 u64）。 */
export function qqGetPlaylistDetail(playlistId: number) {
  return call<PlaylistDetail>(QqCommands.QqGetPlaylistDetail, { playlistId });
}
