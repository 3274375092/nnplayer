// 封装所有对 Rust 后端的 invoke 调用。
// 目的：
//   1. 统一错误处理
//   2. 集中维护命令名称，避免字符串散落各处
//   3. 提供清晰的 TypeScript 类型签名

import { invoke } from "@tauri-apps/api/core";
import type {
  AuthState,
  AudioStateSnapshot,
  DailyRecommend,
  LocalSongMetadata,
  LyricResult,
  Playlist,
  PlaylistDetail,
  SearchResult,
  SearchSuggestion,
  Song,
  SongUrl,
} from "@/types/music";

/**
 * 后端命令名称常量。
 * 与 src-tauri/src/lib.rs 中 invoke_handler 注册的函数一一对应。
 */
export const Commands = {
  // 认证 & 三种登录方式
  LoginQrKey: "login_qr_key",
  LoginQrCheck: "login_qr_check",
  LoginWithAccount: "login_with_account",
  LoginSendCaptcha: "login_send_captcha",
  LoginWithCaptcha: "login_with_captcha",
  SaveCookie: "save_cookie",
  GetAuthState: "get_auth_state",
  Logout: "logout",
  // 业务
  SearchSongs: "search_songs",
  SearchSuggest: "search_suggest",
  GetDailyRecommend: "get_daily_recommend",
  GetSongUrl: "get_song_url",
  GetUserPlaylists: "get_user_playlists",
  GetPlaylistDetail: "get_playlist_detail",
  // 歌词
  GetLyric: "get_lyric",
  // 桌面歌词
  IsPositionOnScreen: "is_position_on_screen",
  // 本地播放音频引擎
  PlayLocal: "play_local",
  PauseAudio: "pause_audio",
  ResumeAudio: "resume_audio",
  ToggleAudio: "toggle_audio",
  SeekAudio: "seek_audio",
  SetAudioVolume: "set_audio_volume",
  GetAudioState: "get_audio_state",
  // 本地音乐扫描
  ScanLocalFolder: "scan_local_folder",
  GetLocalCover: "get_local_cover",
  GetLocalLyric: "get_local_lyric",
  FetchOnlineLyric: "fetch_online_lyric",
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

/** 获取二维码（unikey + qr_url + base64 PNG）。*/
export function loginQrKey() {
  return call<{ unikey: string; qrUrl: string; qrImage: string | null }>(
    Commands.LoginQrKey
  );
}

/**
 * 轮询扫码状态。
 * 返回的 code: 800 过期 / 801 等待扫码 / 802 已扫码 / 803 成功
 * 803 时 avatarUrl 一定有值（直接登录）或为空字符串（cookie 注入恢复）
 */
export function loginQrCheck(unikey: string) {
  return call<{
    code: number;
    message: string;
    nickname?: string;
    userId?: number;
    avatarUrl?: string;
  }>(Commands.LoginQrCheck, { unikey });
}

/**
 * 账号密码登录（邮箱 / 用户名）。
 * md5Password 必须为 32 位小写 hex（前端 MD5 一次）。
 */
export function loginWithAccount(account: string, md5Password: string) {
  return call<{ userId: number; nickname: string; avatarUrl?: string }>(
    Commands.LoginWithAccount,
    { payload: { account, md5Password } },
  );
}

/** 发送手机验证码。*/
export function loginSendCaptcha(phone: string) {
  return call<void>(Commands.LoginSendCaptcha, { payload: { phone } });
}

/** 手机验证码登录。*/
export function loginWithCaptcha(phone: string, captcha: string) {
  return call<{ userId: number; nickname: string; avatarUrl?: string }>(
    Commands.LoginWithCaptcha,
    { payload: { phone, captcha } },
  );
}

/** 直接粘贴 Cookie 登录（旧接口保留）。*/
export function saveCookie(cookie: string) {
  return call<{ userId: number; nickname: string; avatarUrl?: string }>(
    Commands.SaveCookie,
    { payload: { cookie } },
  );
}

/** 获取当前登录状态。*/
export function getAuthState() {
  return call<AuthState & { loginMethod?: string }>(Commands.GetAuthState);
}

/** 退出登录。*/
export function logout() {
  return call<void>(Commands.Logout);
}

// =============== 业务 ===============

export function searchSongs(keyword: string, limit = 30) {
  return call<SearchResult>(Commands.SearchSongs, { keyword, limit });
}

/**
 * 搜索建议（下拉浮层用，NCM 接口 /search/suggest/web）。
 * 返回精简后的 [{ keyword, song? }, ...]
 */
export function searchSuggest(keyword: string) {
  return call<SearchSuggestion[]>(Commands.SearchSuggest, { keyword });
}

export function getDailyRecommend() {
  return call<DailyRecommend>(Commands.GetDailyRecommend);
}

export function getSongUrl(songId: number) {
  return call<SongUrl>(Commands.GetSongUrl, { songId });
}

export function getUserPlaylists() {
  return call<Playlist[]>(Commands.GetUserPlaylists);
}

export function getPlaylistDetail(playlistId: number) {
  return call<PlaylistDetail>(Commands.GetPlaylistDetail, { playlistId });
}

// =============== 歌词（阶段3） ===============

/**
 * 获取歌词。返回 { lrc, tLrc }。
 */
export function getLyric(songId: number) {
  return call<LyricResult>(Commands.GetLyric, { songId });
}

// =============== 桌面歌词 ===============

/** 校验坐标是否在任意显示器范围内。*/
export function isPositionOnScreen(x: number, y: number) {
  return call<boolean>(Commands.IsPositionOnScreen, { x, y });
}

// =============== 本地播放（Rust 音频引擎） ===============

export function playLocal(path: string) {
  return call<void>(Commands.PlayLocal, { path });
}

export function pauseAudio() {
  return call<void>(Commands.PauseAudio);
}

export function resumeAudio() {
  return call<void>(Commands.ResumeAudio);
}

export function toggleAudio() {
  return call<void>(Commands.ToggleAudio);
}

export function seekAudio(seconds: number) {
  return call<void>(Commands.SeekAudio, { seconds });
}

export function setAudioVolume(volume: number) {
  return call<void>(Commands.SetAudioVolume, { volume });
}

export function getAudioState() {
  return call<AudioStateSnapshot>(Commands.GetAudioState);
}

// =============== 本地音乐扫描 ===============

export function scanLocalFolder(folder: string) {
  return call<LocalSongMetadata[]>(Commands.ScanLocalFolder, { folder });
}

export function getLocalCover(path: string) {
  return call<number[]>(Commands.GetLocalCover, { path });
}

/** 获取本地音频内嵌歌词（USLT/©lyr/LYRICS 等）或同目录 .lrc 文件。
 *  返回空串表示无歌词，UI 显示"暂无歌词"。 */
export function getLocalLyric(path: string) {
  return call<string>(Commands.GetLocalLyric, { path });
}

/** 在线兜底：用 title + artist 走 NCM cloudsearch 找最佳匹配，再调 lyric_new 拉歌词。
 *  返回 null = 未登录 / 搜不到 / NCM 没歌词；返回 string（含 LRC 文本或空串）= 命中。 */
export function fetchOnlineLyric(title: string, artist?: string) {
  return call<string | null>(Commands.FetchOnlineLyric, { title, artist });
}