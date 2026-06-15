// 用户相关命令：我的歌单、歌单详情。

use ncm_api::Query;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{Playlist, PlaylistDetail, Song};
use crate::state::AppState;

/// 获取当前用户的歌单列表。
#[tauri::command]
pub async fn get_user_playlists(state: State<'_, AppState>) -> AppResult<Vec<Playlist>> {
    state.auth.lock().await.require_login()?;

    let user_id = state
        .auth
        .lock()
        .await
        .user_id
        .ok_or(AppError::Unauthorized)?;

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();

    let resp = api
        .user_playlist(
            &Query::new()
                .cookie(&cookie)
                .param("uid", &user_id.to_string())
                .param("limit", "50")
                .param("offset", "0"),
        )
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

    let arr = resp.body.get("playlist").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let playlists: Vec<Playlist> = arr
        .into_iter()
        .filter_map(|p| {
            let id = p.get("id")?.as_u64()?;
            let name = p.get("name")?.as_str()?.to_string();
            let cover_url = p.get("coverImgUrl")?.as_str()?.to_string();
            let track_count = p.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let creator = p
                .pointer("/creator/nickname")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(Playlist { id, name, cover_url, track_count, creator })
        })
        .collect();

    Ok(playlists)
}

/// 获取歌单详情。
#[tauri::command]
pub async fn get_playlist_detail(
    state: State<'_, AppState>,
    playlist_id: u64,
) -> AppResult<PlaylistDetail> {
    state.auth.lock().await.require_login()?;

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();

    let resp = api
        .playlist_detail(
            &Query::new()
                .cookie(&cookie)
                .param("id", &playlist_id.to_string()),
        )
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

    // playlist
    let playlist = Playlist {
        id: resp
            .body
            .pointer("/playlist/id")
            .and_then(|v| v.as_u64())
            .unwrap_or(playlist_id),
        name: resp
            .body
            .pointer("/playlist/name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        cover_url: resp
            .body
            .pointer("/playlist/coverImgUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        track_count: resp
            .body
            .pointer("/playlist/trackCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        creator: resp
            .body
            .pointer("/playlist/creator/nickname")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    // tracks
    let raw_tracks = resp
        .body
        .pointer("/playlist/tracks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let songs: Vec<Song> = raw_tracks
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
            let duration = s.get("dt").and_then(|v| v.as_u64()).unwrap_or(0);
            let pic_url = s
                .pointer("/al/picUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(Song { id, name, artists, album, duration, pic_url })
        })
        .collect();

    Ok(PlaylistDetail { playlist, songs })
}