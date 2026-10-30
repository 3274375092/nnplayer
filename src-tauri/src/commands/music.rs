//! 音乐相关命令：搜索、每日推荐、歌曲 URL。
//!
//! 使用 `ncm_api::ApiClient`，复用其加密 + 设备伪装 + cookie 注入能力。

use ncm_api::Query;
use tauri::State;

use crate::audio_quality::AudioQuality;
use crate::commands::auth::ensure_business_success;
use crate::error::{AppError, AppResult};
use crate::models::{
    parse_ncm_song, parse_song_url, DailyRecommend, SearchResult, SearchSuggestion, Song, SongUrl,
};
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

    let api = state.api_snapshot().await;
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

    ensure_business_success(&resp, &[200], "搜索")?;

    let songs: Vec<Song> = resp
        .body
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| parse_ncm_song(s, "duration"))
                .collect()
        })
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
    let api = state.api_snapshot().await;
    let resp = api
        .recommend_songs(&Query::new().cookie(&cookie))
        .await
        .map_err(crate::error::map_ncm_err)?;

    ensure_business_success(&resp, &[200], "每日推荐")?;

    let songs: Vec<Song> = resp
        .body
        .pointer("/data/dailySongs")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|s| parse_ncm_song(s, "dt")).collect())
        .unwrap_or_default();

    Ok(DailyRecommend {
        songs,
        date: today_local(),
    })
}

/// 校验并解析音质档位：None/空回退 exhigh（历史默认），未知值拒绝。
///
/// Tauri 参数反序列化发生在命令调用之前；若直接把参数声明为
/// `Option<AudioQuality>`，非法值只会得到 Tauri 的通用错误，破坏前端
/// `AppError.kind = InvalidParam` 契约。因此边界保持 String，进入业务层
/// 立即收敛为枚举，后续只处理 `AudioQuality`。
fn parse_requested_quality(level: Option<&str>) -> AppResult<AudioQuality> {
    let Some(raw) = level.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(AudioQuality::DEFAULT);
    };
    raw.parse::<AudioQuality>()
        .map_err(|_| AppError::InvalidParam(format!("不支持的音质档位: {raw}")))
}

/// 获取歌曲播放 URL（音质由调用方指定，默认 exhigh/320kbps）。
#[tauri::command]
pub async fn get_song_url(
    state: State<'_, AppState>,
    song_id: u64,
    level: Option<String>,
) -> AppResult<SongUrl> {
    let level = parse_requested_quality(level.as_deref())?;
    state.check_login().await?;

    let cookie = state.cookie().await;
    let api = state.api_snapshot().await;
    let resp = api
        .song_url_v1(
            &Query::new()
                .cookie(&cookie)
                .param("id", &song_id.to_string())
                .param("level", level.as_str()),
        )
        .await
        .map_err(crate::error::map_ncm_err)?;

    ensure_business_success(&resp, &[200], "获取播放地址")?;

    // 服务端按账号权益可能降级下发；actualLevel 与 br 缺失时分别置
    // None/0，由前端显示为未知，不能谎报成请求档位。
    Ok(parse_song_url(song_id, &resp.body))
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
    let api = state.api_snapshot().await;
    let resp = api
        .search_suggest(
            &Query::new()
                .cookie(&cookie)
                .param("keywords", &keyword)
                .param("type", "web"),
        )
        .await
        .map_err(crate::error::map_ncm_err)?;

    // 搜索建议接口有时用 code=200 返回结果，空关键词或无结果也应当继续。
    // 这里只拦截明确的业务错误码如 400/502。
    if let Err(e) = ensure_business_success(&resp, &[200], "搜索建议") {
        log::warn!("[search_suggest] 接口返回非预期状态，忽略: {e}");
    }

    let mut out: Vec<SearchSuggestion> = Vec::new();

    if let Some(raw_songs) = resp
        .body
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
    {
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

fn today_local() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_requested_quality_defaults_to_exhigh() {
        assert_eq!(
            parse_requested_quality(None).expect("缺省档位必须可用"),
            AudioQuality::ExHigh
        );
        assert_eq!(
            parse_requested_quality(Some("")).expect("空档位必须回落默认"),
            AudioQuality::ExHigh
        );
        assert_eq!(
            parse_requested_quality(Some("  ")).expect("空白档位必须回落默认"),
            AudioQuality::ExHigh
        );
    }

    #[test]
    fn parse_requested_quality_accepts_all_six_levels() {
        for quality in AudioQuality::ALL {
            assert_eq!(
                parse_requested_quality(Some(quality.as_str())).expect("六档都必须可用"),
                quality
            );
            // 前后空白不影响合法值。
            let padded = format!(" {} ", quality.as_str());
            assert_eq!(
                parse_requested_quality(Some(&padded)).expect("trim 后必须可用"),
                quality
            );
        }
    }

    // 六档契约必须与前端双向一致：这里直接读取前端源码做完整序列比较，
    // Rust 侧或 src/utils/audioQuality.ts / src/types/music.d.ts 任一侧
    // 增删、改名、重排档位都会让本测试失败。顺序即音质高低（前端用它
    // 判断服务端降级），因此按序比较。
    #[test]
    fn six_levels_match_frontend_audio_quality_contract() {
        // 路径相对本文件 src-tauri/src/commands/music.rs。
        const FRONTEND_OPTIONS: &str = include_str!("../../../src/utils/audioQuality.ts");
        const FRONTEND_TYPES: &str = include_str!("../../../src/types/music.d.ts");

        // 取出所有出现在 `needle` 之后同一行双引号内的第一个字符串。
        fn wire_strings_after<'a>(text: &'a str, needle: &str) -> Vec<&'a str> {
            text.lines()
                .filter_map(|line| line.split_once(needle))
                .filter_map(|(_, rest)| rest.split('"').next())
                .collect()
        }

        let rust_wires: Vec<&str> = AudioQuality::ALL.map(AudioQuality::as_str).to_vec();

        // AUDIO_QUALITY_OPTIONS 每项形如 `{ value: "standard", ... }`。
        let option_wires = wire_strings_after(FRONTEND_OPTIONS, "value: \"");
        assert_eq!(
            option_wires, rust_wires,
            "前端 AUDIO_QUALITY_OPTIONS 与 Rust AudioQuality 档位不一致"
        );

        // AudioQuality 联合类型：从声明处截到第一个 ';'，再收集引号内档位。
        let union_block = FRONTEND_TYPES
            .split_once("export type AudioQuality =")
            .and_then(|(_, rest)| rest.split(';').next())
            .expect("前端 types/music.d.ts 缺少 AudioQuality 联合类型声明");
        let union_wires: Vec<&str> = union_block.split('"').skip(1).step_by(2).collect();
        assert_eq!(
            union_wires, rust_wires,
            "前端 AudioQuality 联合类型与 Rust AudioQuality 档位不一致"
        );
    }

    #[test]
    fn parse_requested_quality_rejects_unknown() {
        // 拒绝必须保持结构化 InvalidParam（前端按 AppError.kind 区分错误）。
        assert!(matches!(
            parse_requested_quality(Some("sky")),
            Err(AppError::InvalidParam(_))
        ));
        assert!(parse_requested_quality(Some("jyeffect")).is_err());
        assert!(parse_requested_quality(Some("999000")).is_err());
        assert!(parse_requested_quality(Some("exhigh\"); drop")).is_err());
    }
}
