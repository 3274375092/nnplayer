// QQ 音乐业务命令：搜索 / 播放 / 歌词 / 推荐 / 我的歌单 / 歌单详情。
//
// 设计原则：
//   1. 与 commands/music.rs 平行对称：每个命令一个 `#[tauri::command]`
//   2. 业务参数 → qq_music::QqMusicClient 方法 → QqXxx DTO → commands/shared
//      转换为前端 Song/Playlist DTO
//   3. 需要鉴权的命令（get_user_playlists）从 AppState.qq_token 拿 token
//   4. 平台无关逻辑（DTO 转换）放 commands/shared/song_mapper，不耦合具体平台
//   5. 未登录时 get_user_playlists 返空 Vec + console.warn，不弹错误（前端只显示）

use qq_music::{QqPlaylistDetail, QqRecommend, QqSearchSongs, QqSongUrl, QqUserPlaylist};
use tauri::State;

use crate::commands::shared::song_mapper::{qq_playlist_to_dto, qq_song_to_dto};
use crate::error::{map_qq_err, AppResult};
use crate::models::{LyricResult, Playlist, PlaylistDetail, Song, SongUrl};
use crate::state::AppState;

// ============================================================
// 搜索
// ============================================================

/// QQ 搜索歌曲。返回最多 `limit` 首匹配，按 `offset` 分页。
#[tauri::command]
pub async fn qq_search_songs(
    state: State<'_, AppState>,
    keyword: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> AppResult<Vec<Song>> {
    let limit = limit.unwrap_or(30) as u64;
    let offset = offset.unwrap_or(0) as u64;
    let token = state.qq_token_snapshot().await;
    let result: QqSearchSongs = state
        .qq
        .search_songs(&keyword, limit, offset, token.as_ref())
        .await
        .map_err(map_qq_err)?;
    Ok(result.songs.into_iter().map(qq_song_to_dto).collect())
}

// ============================================================
// 播放
// ============================================================

/// QQ 获取播放 URL。未登录时仍可调用（QQ 允许匿名听部分歌曲）。
#[tauri::command]
pub async fn qq_get_song_url(
    state: State<'_, AppState>,
    song_id: String,
) -> AppResult<SongUrl> {
    let token = state.qq_token_snapshot().await;
    let url: QqSongUrl = state
        .qq
        .get_song_url(&song_id, token.as_ref())
        .await
        .map_err(map_qq_err)?;
    let id = crate::commands::shared::song_mapper::qq_mid_to_u64(&url.id);
    let level = url.level;
    let raw_url = url.url;
    Ok(SongUrl {
        id,
        url: Some(raw_url),
        bitrate: qq_quality_to_bitrate(level),
    })
}

fn qq_quality_to_bitrate(level: qq_music::QqQuality) -> u32 {
    // 与 ncm-api-rs 习惯一致：返回大致 bps（仅作前端展示）
    use qq_music::QqQuality;
    match level {
        QqQuality::Master => 9_000_000,
        QqQuality::Surround => 4_500_000,
        QqQuality::Stereo => 2_300_000,
        QqQuality::Hires => 2_300_000,
        QqQuality::Lossless => 1_411_000,
        QqQuality::Exhigh => 1_026_000,
        QqQuality::Standard => 320_000,
        QqQuality::Unknown => 128_000,
    }
}

// ============================================================
// 歌词
// ============================================================

/// QQ 获取歌词。返回 `{ lrc, tLrc, yLrc }`（与 NCM LyricResult 对齐）。
#[tauri::command]
pub async fn qq_get_lyric(
    state: State<'_, AppState>,
    song_id: String,
) -> AppResult<LyricResult> {
    let token = state.qq_token_snapshot().await;
    let lyric = state
        .qq
        .get_lyric(&song_id, token.as_ref())
        .await
        .map_err(map_qq_err)?;
    Ok(LyricResult {
        lrc: Some(lyric.lrc),
        t_lrc: lyric.t_lrc,
        y_lrc: None, // QQ 协议暂无 YRC（卡拉OK 逐字）
    })
}

// ============================================================
// 推荐
// ============================================================

/// QQ 每日推荐（首页卡片推荐流，取前 6 个）。
#[tauri::command]
pub async fn qq_get_daily_recommend(
    state: State<'_, AppState>,
) -> AppResult<Vec<Playlist>> {
    let token = state.qq_token_snapshot().await;
    let rec: QqRecommend = state
        .qq
        .recommend_playlists(token.as_ref())
        .await
        .map_err(map_qq_err)?;
    Ok(rec.playlists.into_iter().map(qq_playlist_to_dto).collect())
}

// ============================================================
// 我的歌单
// ============================================================

/// QQ 获取当前登录用户的歌单列表。
///
/// **未登录** 时返回空 `Vec`（前端判断决定是否引导登录）。
#[tauri::command]
pub async fn qq_get_user_playlists(
    state: State<'_, AppState>,
) -> AppResult<Vec<Playlist>> {
    let Some(token) = state.qq_token_snapshot().await else {
        log::warn!("[qq_get_user_playlists] 未登录 QQ，返回空列表");
        return Ok(Vec::new());
    };
    let lists: Vec<QqUserPlaylist> = state
        .qq
        .my_playlists(&token)
        .await
        .map_err(map_qq_err)?;
    Ok(lists
        .into_iter()
        .map(|p| Playlist {
            id: p.id.parse::<u64>().unwrap_or(0),
            name: p.name,
            cover_url: p.pic_url,
            track_count: p.song_count,
            creator: None,
        })
        .collect())
}

/// QQ 获取歌单详情（含歌曲列表）。
/// `playlist_id` 是前端传过来的 u64（QQ 歌单原 ID 是数字，无需哈希）。
#[tauri::command]
pub async fn qq_get_playlist_detail(
    state: State<'_, AppState>,
    playlist_id: u64,
) -> AppResult<PlaylistDetail> {
    let token = state.qq_token_snapshot().await;
    let detail: QqPlaylistDetail = state
        .qq
        .playlist_detail(playlist_id, token.as_ref())
        .await
        .map_err(map_qq_err)?;
    Ok(PlaylistDetail {
        playlist: Playlist {
            id: playlist_id, // 前端传的 u64 就是歌单原 ID
            name: detail.name,
            cover_url: detail.pic_url,
            track_count: detail.songs.len() as u32,
            creator: None,
        },
        songs: detail.songs.into_iter().map(qq_song_to_dto).collect(),
    })
}
