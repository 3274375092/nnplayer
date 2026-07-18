// 用户相关命令：我的歌单、歌单详情。

use ncm_api::Query;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{parse_ncm_song, Playlist, PlaylistDetail, Song};
use crate::state::AppState;

/// 获取当前用户的歌单列表。
#[tauri::command]
pub async fn get_user_playlists(state: State<'_, AppState>) -> AppResult<Vec<Playlist>> {
    state.check_login().await?;

    let user_id = state
        .auth
        .lock()
        .await
        .user_id
        .ok_or(AppError::Unauthorized)?;
    let cookie = state.cookie().await;

    let api = state.api.read().await;
    const PAGE_SIZE: usize = 100;
    const MAX_PAGES: usize = 100;
    let mut playlists = Vec::new();

    for page in 0..MAX_PAGES {
        let offset = page * PAGE_SIZE;
        let resp = api
            .user_playlist(
                &Query::new()
                    .cookie(&cookie)
                    .param("uid", &user_id.to_string())
                    .param("limit", &PAGE_SIZE.to_string())
                    .param("offset", &offset.to_string()),
            )
            .await
            .map_err(crate::error::map_ncm_err)?;

        let code = AppState::response_code(&resp);
        if code != 200 {
            return Err(AppError::Ncm(format!(
                "读取歌单失败 (code={code}): {}",
                AppState::response_message(&resp)
            )));
        }

        let raw = resp
            .body
            .get("playlist")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let raw_len = raw.len();
        playlists.extend(raw.iter().filter_map(parse_playlist));

        let more = resp
            .body
            .get("more")
            .and_then(|v| v.as_bool())
            .unwrap_or(raw_len == PAGE_SIZE);
        if !more || raw_len == 0 {
            break;
        }
    }

    Ok(playlists)
}

fn parse_playlist(p: &serde_json::Value) -> Option<Playlist> {
    let id = p.get("id")?.as_u64()?;
    let name = p.get("name")?.as_str()?.to_string();
    let cover_url = p.get("coverImgUrl")?.as_str()?.to_string();
    let track_count = p.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let creator = p
        .pointer("/creator/nickname")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(Playlist {
        id,
        name,
        cover_url,
        track_count,
        creator,
    })
}

/// 获取歌单详情。
#[tauri::command]
pub async fn get_playlist_detail(
    state: State<'_, AppState>,
    playlist_id: u64,
) -> AppResult<PlaylistDetail> {
    state.check_login().await?;

    let cookie = state.cookie().await;
    let api = state.api.read().await;
    let resp = api
        .playlist_detail(
            &Query::new()
                .cookie(&cookie)
                .param("id", &playlist_id.to_string()),
        )
        .await
        .map_err(crate::error::map_ncm_err)?;
    drop(api);

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

    let songs: Vec<Song> = resp
        .body
        .pointer("/playlist/tracks")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| parse_ncm_song(s, "dt")).collect())
        .unwrap_or_default();

    Ok(PlaylistDetail { playlist, songs })
}
