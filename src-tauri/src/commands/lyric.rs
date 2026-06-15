// 歌词命令。
// 接口来源：ncm-api-rs 的 lyric / lyric_new。
//
// 关键：只向前端返回精简的 { lrc, t_lrc, y_lrc }，绝不返回 NCM 原生的大 JSON。

use ncm_api::Query;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::LyricResult;
use crate::state::AppState;

/// 获取歌词。
///  - `lrc`：原文 LRC
///  - `t_lrc`：翻译 LRC（若存在）
///  - `y_lrc`：YRC 逐字歌词（若存在，`yv=-1` 请求）
#[tauri::command]
pub async fn get_lyric(
    state: State<'_, AppState>,
    song_id: u64,
) -> AppResult<LyricResult> {
    state.auth.lock().await.require_login()?;

    if song_id == 0 {
        return Err(AppError::InvalidParam("songId 无效".to_string()));
    }

    let api = state.api.lock().await;
    let cookie = state.auth.lock().await.cookie.clone().unwrap_or_default();

    let resp = api
        .lyric_new(&Query::new()
            .cookie(&cookie)
            .param("id", &song_id.to_string()))
        .await
        .map_err(crate::commands::auth::map_ncm_err)?;

    // /lyric/v1 返回结构（lv=0, yv=0）：
    //   lrc.lyric:     原文 LRC 字符串
    //   tlyric.lyric:  翻译 LRC 字符串
    //   yrc.lyric:     YRC 逐字歌词字符串
    let lrc = resp
        .body
        .pointer("/lrc/lyric")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let t_lrc = resp
        .body
        .pointer("/tlyric/lyric")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let y_lrc = resp
        .body
        .pointer("/yrc/lyric")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(LyricResult { lrc, t_lrc, y_lrc })
}
