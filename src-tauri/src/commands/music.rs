// 音乐相关命令：搜索、每日推荐、歌曲 URL。
// 使用 ncm_api::ApiClient，复用其加密 + 设备伪装 + cookie 注入能力。

use ncm_api::Query;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{DailyRecommend, SearchResult, SearchSuggestion, Song, SongUrl};
use crate::state::AppState;

/// 搜索歌曲。
#[tauri::command]
pub async fn search_songs(
    state: State<'_, AppState>,
    keyword: String,
    limit: Option<u32>,
) -> AppResult<SearchResult> {
    state.auth.lock().await.require_login()?;

    if keyword.trim().is_empty() {
        return Err(AppError::InvalidParam("搜索关键词不能为空".to_string()));
    }
    let limit = limit.unwrap_or(30).min(100);

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();
    let resp = api
        .search(
            &Query::new()
                .cookie(&cookie)
                .param("keywords", &keyword)
                .param("type", "1") // 1 = 单曲
                .param("limit", &limit.to_string())
                .param("offset", "0"),
        )
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

    // 解析 songs.*[]
    let raw_songs = resp
        .body
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let songs: Vec<crate::models::Song> = raw_songs
        .into_iter()
        .filter_map(|s| {
            let id = s.get("id")?.as_u64()?;
            let name = s.get("name")?.as_str()?.to_string();
            let artists = s
                .pointer("/ar")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            let album = s
                .pointer("/al/name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // NetEase 搜索/推荐接口的歌曲 duration 字段名是 `duration`（毫秒），
            // 旧代码用 `dt` 读不到，会 fallback 0，导致列表里全显示 00:00。
            let duration = s
                .get("duration")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let pic_url = s
                .pointer("/al/picUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(crate::models::Song { id, name, artists, album, duration, pic_url })
        })
        .collect();

    Ok(SearchResult { songs, total: limit })
}

/// 获取每日推荐歌曲。
#[tauri::command]
pub async fn get_daily_recommend(state: State<'_, AppState>) -> AppResult<DailyRecommend> {
    state.auth.lock().await.require_login()?;

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();

    // 真实接口 /recommend/songs
    let resp = api
        .recommend_songs(&Query::new().cookie(&cookie))
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

    let raw = resp
        .body
        .pointer("/data/dailySongs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let songs: Vec<crate::models::Song> = raw
        .into_iter()
        .filter_map(|s| {
            let id = s.get("id")?.as_u64()?;
            let name = s.get("name")?.as_str()?.to_string();
            let artists = s
                .pointer("/ar")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            let album = s
                .pointer("/al/name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // NetEase 每日推荐接口的时长字段是 `dt`（毫秒），
            // 注意：和搜索接口的 `duration` 字段名不同。
            let duration = s.get("dt").and_then(|v| v.as_u64()).unwrap_or(0);
            let pic_url = s
                .pointer("/al/picUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(crate::models::Song { id, name, artists, album, duration, pic_url })
        })
        .collect();

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
    state.auth.lock().await.require_login()?;

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();

    let resp = api
        .song_url_v1(
            &Query::new()
                .cookie(&cookie)
                .param("id", &song_id.to_string())
                .param("level", "exhigh"), // 320kbps
        )
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

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
/// NCM 接口 `/search/suggest/web` 返回结构：
///   result.order: ["xxx", "yyy"]（关键词）
///   result.songs: [{...}, ...]（命中歌曲，按 order 同序对齐）
#[tauri::command]
pub async fn search_suggest(
    state: State<'_, AppState>,
    keyword: String,
) -> AppResult<Vec<SearchSuggestion>> {
    state.auth.lock().await.require_login()?;

    if keyword.trim().is_empty() {
        return Ok(Vec::new());
    }

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();

    let resp = api
        .search_suggest(
            &Query::new()
                .cookie(&cookie)
                .param("keywords", &keyword)
                .param("type", "web"),
        )
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

    // 抽取 result.order + result.songs
    let orders: Vec<String> = resp
        .body
        .pointer("/result/order")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(|t| t.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let raw_songs = resp
        .body
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 解析候选歌曲（按 NCM 文档：songs 与 order 顺序对应；缺失部分降级为空 song）
    let songs: Vec<Song> = raw_songs
        .into_iter()
        .filter_map(|s| {
            let id = s.get("id")?.as_u64()?;
            let name = s.get("name")?.as_str()?.to_string();
            let artists = s
                .pointer("/ar")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            let album = s
                .pointer("/al/name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let duration = s
                .get("duration")
                .or_else(|| s.get("dt"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let pic_url = s
                .pointer("/al/picUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(Song { id, name, artists, album, duration, pic_url })
        })
        .collect();

    // 合并：先按 order 顺序输出（用 songs 中位置匹配的 song），末尾追加多余 songs
    let mut out: Vec<SearchSuggestion> = Vec::with_capacity(orders.len().max(songs.len()));
    for (idx, kw) in orders.iter().enumerate() {
        let song = songs.get(idx).cloned();
        out.push(SearchSuggestion {
            keyword: kw.clone(),
            song,
        });
    }
    // 防御：若 songs 比 order 长，把多出的歌曲作为 keyword="" 追加
    if songs.len() > orders.len() {
        for s in songs.into_iter().skip(orders.len()) {
            out.push(SearchSuggestion {
                keyword: String::new(),
                song: Some(s),
            });
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
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}