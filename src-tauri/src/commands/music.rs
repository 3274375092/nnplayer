//! 音乐相关命令：搜索、每日推荐、歌曲 URL。
//!
//! 使用 `ncm_api::ApiClient`，复用其加密 + 设备伪装 + cookie 注入能力。

use ncm_api::{ApiResponse, NcmError, Query};
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

    // 上游对 song/url/v1 有风控（超清母带等档位常返回 HTTP200 + code=-460）：
    // 先过风控熔断 + 350ms 串行节流，避免「装载 + 预取」并发打爆上游。
    state.acquire_song_url_slot().await?;

    let cookie = state.cookie().await;
    let api = state.api_snapshot().await;
    let result = api
        .song_url_v1(
            &Query::new()
                .cookie(&cookie)
                .param("id", &song_id.to_string())
                .param("level", level.as_str()),
        )
        .await;
    resolve_song_url(state.inner(), song_id, result).await
}

/// 收敛 `song_url_v1` 的请求结果：解析成功响应；上游限流同时打开熔断窗口。
///
/// 单独抽成函数，便于用构造的「限流错误」做单测，不依赖真实网络。
async fn resolve_song_url(
    state: &AppState,
    song_id: u64,
    result: Result<ApiResponse, NcmError>,
) -> AppResult<SongUrl> {
    let resp = match result {
        Ok(resp) => resp,
        Err(error) => return Err(map_song_url_error(state, error).await),
    };

    ensure_business_success(&resp, &[200], "获取播放地址")?;

    // 服务端按账号权益可能降级下发；actualLevel 与 br 缺失时分别置
    // None/0，由前端显示为未知，不能谎报成请求档位。
    Ok(parse_song_url(song_id, &resp.body))
}

/// 收敛 `song_url_v1` 的上游错误，并把上游限流类错误升级为可重试的会话级错误。
///
/// `NcmError::RiskControl`（业务码 -460）与 `NcmError::RateLimited`（503 / IP 高频）
/// 都表示 `song/url/v1` 被上游拦截：换歌同样会失败，必须按 `AppError::RiskControl`
/// 交给前端暂停自动切歌，并打开熔断窗口避免继续打上游。
///
/// 只作用于取址链路；`map_ncm_err` 的全局映射不变（登录等命令的 503 仍是 Ncm）。
async fn map_song_url_error(state: &AppState, error: NcmError) -> AppError {
    let app_error = match error {
        NcmError::RateLimited(message) => AppError::RiskControl(rate_limited_message(&message)),
        other => crate::error::map_ncm_err(other),
    };
    if let AppError::RiskControl(_) = &app_error {
        state.trip_song_url_breaker().await;
    }
    app_error
}

/// `ncm-api` 在响应体完全没有 `msg`/`message` 时使用的占位文案
/// （见 `ncm-api-rs/src/request.rs` 的 `UNKNOWN_ERROR_MESSAGE`）。
///
/// 取址链路不能把它当上游文案：熔断/限流错误的技术详情只剩 `Unknown error`
/// 时，用户拿不到任何可重试信息。
const UPSTREAM_MISSING_MESSAGE: &str = "Unknown error";

/// 503 限流错误的前端可读 message：上游文案优先，缺失时给出可重试提示。
fn rate_limited_message(message: &str) -> String {
    if message.trim().is_empty() || message == UPSTREAM_MISSING_MESSAGE {
        "请求过于频繁，请稍后再试".to_string()
    } else {
        message.to_string()
    }
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

    // ── 上游限流（-460 风控 / 503）：结构化 RiskControl + 熔断打开 ──

    #[tokio::test]
    async fn risk_control_error_maps_to_risk_control_and_trips_breaker() {
        // 与 state.rs 测试一致：正式进程启动时安装 rustls provider，测试内补一次。
        let _ = rustls::crypto::ring::default_provider().install_default();
        let state = AppState::new(None, Default::default()).expect("create state");
        let upstream = Err(NcmError::RiskControl {
            code: -460,
            msg: "检测到您的网络环境存在风险，请稍后再试".to_string(),
        });

        let error = resolve_song_url(&state, 186016, upstream)
            .await
            .expect_err("风控错误必须向上传播");
        match error {
            AppError::RiskControl(message) => assert!(
                message.contains("检测到您的网络环境存在风险"),
                "上游文案必须保真: {message}"
            ),
            other => panic!("-460 必须映射为 RiskControl，实际 {other:?}"),
        }

        // 熔断已打开：下一次请求在入口即被拒绝，不会再打上游。
        assert!(
            matches!(
                state.acquire_song_url_slot().await,
                Err(AppError::RiskControl(_))
            ),
            "风控错误必须打开熔断窗口"
        );
    }

    /// 503 限流与 -460 同类：取址链路必须返回 RiskControl 并打开熔断，
    /// 否则前端按 Ncm 处理会继续自动跳歌（换歌同样会被限流）。
    #[tokio::test]
    async fn rate_limited_error_maps_to_risk_control_and_trips_breaker() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let state = AppState::new(None, Default::default()).expect("create state");
        let upstream = Err(NcmError::RateLimited(
            "操作过于频繁，请稍后再试".to_string(),
        ));

        let error = resolve_song_url(&state, 186016, upstream)
            .await
            .expect_err("限流错误必须向上传播");
        match error {
            AppError::RiskControl(message) => assert_eq!(
                message, "操作过于频繁，请稍后再试",
                "上游限流文案必须优先保留"
            ),
            other => panic!("503 限流必须映射为 RiskControl，实际 {other:?}"),
        }

        // 熔断已打开：下一次请求在入口即被拒绝，不会再打上游。
        assert!(
            matches!(
                state.acquire_song_url_slot().await,
                Err(AppError::RiskControl(_))
            ),
            "限流错误必须打开熔断窗口"
        );
    }

    /// 上游没给限流文案（空/空白/占位符）时给出可重试提示，不能返回空 message。
    #[tokio::test]
    async fn rate_limited_error_without_message_uses_retry_hint() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let state = AppState::new(None, Default::default()).expect("create state");
        // 真实请求链路里 `request()` 会把“完全没有文案”收敛成占位符
        // `Unknown error`（见 ncm-api-rs/src/request.rs），必须一并兜底。
        for raw in ["", "   ", "Unknown error"] {
            let upstream = Err(NcmError::RateLimited(raw.to_string()));
            let error = resolve_song_url(&state, 186016, upstream)
                .await
                .expect_err("限流错误必须向上传播");
            match error {
                AppError::RiskControl(message) => assert_eq!(
                    message, "请求过于频繁，请稍后再试",
                    "上游文案为 {raw:?} 时必须用可重试提示兜底"
                ),
                other => panic!("503 限流必须映射为 RiskControl，实际 {other:?}"),
            }
        }

        assert!(
            matches!(
                state.acquire_song_url_slot().await,
                Err(AppError::RiskControl(_))
            ),
            "限流错误必须打开熔断窗口"
        );
    }

    /// 只有上游限流错误（-460 风控 / 503）才能打开熔断：网络/超时等普通失败
    /// 若也熔断，一次抖动就会把后续所有取址请求拦住 4s。
    #[tokio::test]
    async fn non_risk_control_error_does_not_trip_breaker() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let state = AppState::new(None, Default::default()).expect("create state");
        let upstream = Err(NcmError::Timeout("请求超时".to_string()));

        let error = resolve_song_url(&state, 186016, upstream)
            .await
            .expect_err("超时错误必须向上传播");
        assert!(
            matches!(error, AppError::Network(_)),
            "超时应映射为 Network，实际 {error:?}"
        );

        assert!(
            state.acquire_song_url_slot().await.is_ok(),
            "非风控错误不得打开熔断窗口"
        );
    }
}
