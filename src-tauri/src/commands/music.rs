// 音乐相关命令：搜索、每日推荐、歌曲 URL。
// 使用 ncm_api::ApiClient，复用其加密 + 设备伪装 + cookie 注入能力。

use ncm_api::Query;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{parse_ncm_song, DailyRecommend, SearchResult, SearchSuggestion, Song, SongUrl};
use crate::state::AppState;

/// 搜索歌曲。
#[tauri::command]
pub async fn search_songs(
    state: State<'_, AppState>,
    keyword: String,
    limit: Option<u32>,
) -> AppResult<SearchResult> {
    state.check_login().await?;

    if keyword.trim().is_empty() {
        return Err(AppError::InvalidParam("搜索关键词不能为空".to_string()));
    }
    let limit = limit.unwrap_or(30).min(100);
    let cookie = state.cookie().await;

    let api = state.api.lock().await;
    let resp = api
        .cloudsearch(
            &Query::new()
                .cookie(&cookie)
                .param("keywords", &keyword)
                .param("type", "1")
                .param("limit", &limit.to_string())
                .param("offset", "0"),
        )
        .await
        .map_err(crate::error::map_ncm_err)?;
    drop(api);

    let songs: Vec<Song> = resp
        .body
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| parse_ncm_song(s, "duration")).collect())
        .unwrap_or_default();

    let total = resp
        .body
        .pointer("/result/songCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(songs.len() as u64) as u32;

    Ok(SearchResult { songs, total })
}

/// 获取每日推荐歌曲。
#[tauri::command]
pub async fn get_daily_recommend(state: State<'_, AppState>) -> AppResult<DailyRecommend> {
    state.check_login().await?;

    let cookie = state.cookie().await;
    let api = state.api.lock().await;
    let resp = api
        .recommend_songs(&Query::new().cookie(&cookie))
        .await
        .map_err(crate::error::map_ncm_err)?;
    drop(api);

    let songs: Vec<Song> = resp
        .body
        .pointer("/data/dailySongs")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| parse_ncm_song(s, "dt")).collect())
        .unwrap_or_default();

    Ok(DailyRecommend {
        songs,
        date: chrono_like_today(),
    })
}

/// 获取歌曲播放 URL（优先 320kbps）。
#[tauri::command]
pub async fn get_song_url(
    state: State<'_, AppState>,
    song_id: u64,
) -> AppResult<SongUrl> {
    state.check_login().await?;

    let cookie = state.cookie().await;
    let api = state.api.lock().await;
    let resp = api
        .song_url_v1(
            &Query::new()
                .cookie(&cookie)
                .param("id", &song_id.to_string())
                .param("level", "exhigh"),
        )
        .await
        .map_err(crate::error::map_ncm_err)?;
    drop(api);

    let url = resp
        .body
        .pointer("/data/0/url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let br = resp
        .body
        .pointer("/data/0/br")
        .and_then(|v| v.as_u64())
        .unwrap_or(320_000) as u32;

    Ok(SongUrl { id: song_id, url, bitrate: br })
}

/// 搜索建议（自动补全下拉浮层用）。
#[tauri::command]
pub async fn search_suggest(
    state: State<'_, AppState>,
    keyword: String,
) -> AppResult<Vec<SearchSuggestion>> {
    state.check_login().await?;

    if keyword.trim().is_empty() {
        return Ok(Vec::new());
    }

    let cookie = state.cookie().await;
    let api = state.api.lock().await;
    let resp = api
        .search_suggest(
            &Query::new()
                .cookie(&cookie)
                .param("keywords", &keyword)
                .param("type", "web"),
        )
        .await
        .map_err(crate::error::map_ncm_err)?;
    drop(api);

    let mut out: Vec<SearchSuggestion> = Vec::new();

    if let Some(raw_songs) = resp.body.pointer("/result/songs").and_then(|v| v.as_array()) {
        for s in raw_songs {
            if let Some(song) = parse_ncm_song(s, "duration") {
                out.push(SearchSuggestion {
                    keyword: song.name.clone(),
                    song: Some(song),
                });
            }
        }
    }

    Ok(out)
}

// ============================================================
// 日期工具（避免引入 chrono）
// ============================================================

fn chrono_like_today() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = secs / 86_400;
    let mut year = 1970u64;
    let mut remaining_days = days;
    loop {
        let leap = is_leap(year);
        let year_days = if leap { 366 } else { 365 };
        if remaining_days < year_days {
            break;
        }
        remaining_days -= year_days;
        year += 1;
    }
    let leap = is_leap(year);
    let months: [u64; 12] = if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u64;
    for &m in &months {
        if remaining_days < m {
            break;
        }
        remaining_days -= m;
        month += 1;
    }
    let day = remaining_days + 1;
    format!("{year:04}-{month:02}-{day:02}")
}

fn is_leap(y: u64) -> bool {
    y.is_multiple_of(4) && !y.is_multiple_of(100) || y.is_multiple_of(400)
}