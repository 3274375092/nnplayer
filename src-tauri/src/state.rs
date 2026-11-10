//! 全局应用状态。
//!
//! 与 CNMPlayer 保持一致的设计：
//! - 持有 ncm_api::ApiClient（自带 Cookie 存储 + 设备指纹 + 加密层）
//! - 同时维护一个轻量的 AuthState（用户 id、昵称），方便前端展示
//! - ApiClient 用 RwLock：普通业务请求可以并发，登录/退出时才需要写锁
//! - AuthState 用 Mutex，保证登录态更新原子化
//!
//! ApiClient 是 ncm-api-rs 提供的"开箱即用"客户端：
//! - 自动注入 NCM 风控所需的 cookie 字段（os、deviceId、NMTID 等）
//! - 自动捕获响应 Set-Cookie 到 response.cookie
//! - 自动按 CryptoType 进行 weapi/eapi 加密
//!
//! 调用方只需 login_status / login / login_cellphone 等接口即可。

use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use ncm_api::{ApiClient, ApiResponse};
use reqwest::Client;
use tokio::sync::{Mutex, Notify, RwLock};

use crate::error::{AppError, AppResult};

const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ",
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
);

/// 相邻两次歌曲 URL 上游请求的最小间隔。
///
/// 「装载当前歌曲 + 预取下一首」会并发调用 `get_song_url`，瞬时并发容易
/// 触发网易云风控（-460），因此把上游请求排成至少间隔 350ms 的队列。
const SONG_URL_MIN_INTERVAL: Duration = Duration::from_millis(350);

/// 命中风控后的熔断窗口：窗口内不再请求上游，直接返回可重试错误。
///
/// 取值 4s 是两端的平衡：既能挡住「当前曲 + 预取」瞬时重试造成的连击，
/// 又短于前端播放引擎对风控失败的同歌重试等待（4.5s），让那次重试真能
/// 到达上游一次；风控持续时前端会停在当前歌曲并提示稍后重试，不再跳歌。
const SONG_URL_RISK_CONTROL_WINDOW: Duration = Duration::from_secs(4);

/// 风控熔断期间 `get_song_url` 立即返回的用户可读提示。
const SONG_URL_RISK_CONTROL_HINT: &str = "网易云暂时限制了请求，请稍候再试";

/// 构建共享的 reqwest Client：标准 UA、cookie 存储与连接/总超时。
pub(crate) fn build_http_client() -> anyhow::Result<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .cookie_store(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(Into::into)
}

// ============================================================
// 歌曲 URL 节流 / 风控熔断的纯逻辑（无 I/O，便于单测）
// ============================================================

/// 计算下一个可发请求的时间槽。
///
/// 返回 `(槽位时刻, 需要等待的时长)`。写入状态的是“槽位时刻”而不是“现在”，
/// 于是并发调用者各自拿到互不相同、间隔 `min_interval` 的槽位；若返回的是
/// 同一个“现在”，多个任务会同时放行，节流形同虚设。
fn next_slot(
    now: Instant,
    last_slot: Option<Instant>,
    min_interval: Duration,
) -> (Instant, Duration) {
    let slot = match last_slot {
        Some(last) => (last + min_interval).max(now),
        None => now,
    };
    (slot, slot.saturating_duration_since(now))
}

/// 判断当前时刻是否处于风控熔断窗口内。
fn should_block(now: Instant, blocked_until: Option<Instant>) -> bool {
    blocked_until.is_some_and(|until| now < until)
}

/// 计算命中风控后的熔断截止时刻。
fn risk_control_blocked_until(now: Instant) -> Instant {
    now + SONG_URL_RISK_CONTROL_WINDOW
}

/// 用户基本信息（持久化的部分）。
#[derive(Default, Clone, Debug)]
pub struct AuthState {
    pub user_id: Option<u64>,
    pub nickname: Option<String>,
    /// 当前 cookie 字符串（"MUSIC_U=xxx; __csrf=xxx; ..."）
    /// 仅用于持久化到磁盘和恢复会话，业务请求均由 ApiClient 内部 cookie 处理
    pub cookie: Option<String>,
    /// 登录方式（用于 UI 展示最近登录路径）
    pub login_method: Option<String>,
    /// 头像 URL（启动恢复 + 登录时写入,前端 <img> 直接使用）
    pub avatar_url: Option<String>,
}

impl AuthState {
    /// 同时具备非零 user_id 与非空 cookie 才视为已登录。
    pub fn is_logged_in(&self) -> bool {
        self.user_id.is_some_and(|id| id > 0)
            && self
                .cookie
                .as_deref()
                .is_some_and(|cookie| !cookie.trim().is_empty())
    }

    /// 未登录时返回 [`AppError::Unauthorized`]。
    pub fn require_login(&self) -> Result<(), AppError> {
        if self.is_logged_in() {
            Ok(())
        } else {
            Err(AppError::Unauthorized)
        }
    }
}

/// 全局状态容器。
#[derive(Clone)]
pub struct AppState {
    /// ncm-api 客户端。已配置好 cookie 存储 + UA + 加密。
    pub api: Arc<RwLock<ApiClient>>,
    /// 轻量用户信息（user_id、nickname）。
    pub auth: Arc<Mutex<AuthState>>,
    /// 启动会话校验完成通知。前端读取登录态前必须等待它。
    restore_ready: Arc<Notify>,
    restore_complete: Arc<AtomicBool>,
    /// 歌曲 URL 请求节流：上一笔请求排定的上游开始时刻。
    ///
    /// 独立于 `api` / `auth` 的锁，临界区只有常数级计算，不会跨网络 await。
    song_url_last_slot: Arc<Mutex<Option<Instant>>>,
    /// 歌曲 URL 风控熔断截止时刻；`Some(t)` 且 `now < t` 时拒绝新请求。
    song_url_blocked_until: Arc<Mutex<Option<Instant>>>,
}

impl AppState {
    pub fn new(cookie: Option<String>, auth: AuthState) -> anyhow::Result<Self> {
        let http = build_http_client()?;
        let api = ApiClient::new(cookie, http);

        Ok(Self {
            api: Arc::new(RwLock::new(api)),
            auth: Arc::new(Mutex::new(auth)),
            restore_ready: Arc::new(Notify::new()),
            restore_complete: Arc::new(AtomicBool::new(false)),
            song_url_last_slot: Arc::new(Mutex::new(None)),
            song_url_blocked_until: Arc::new(Mutex::new(None)),
        })
    }

    /// 标记启动会话校验结束，并唤醒等待中的前端命令。
    pub fn mark_restore_complete(&self) {
        self.restore_complete.store(true, Ordering::Release);
        self.restore_ready.notify_waiters();
    }

    /// 等待启动会话校验。双重检查避免 notify 发生在 await 之前造成丢失唤醒。
    pub async fn wait_restore_complete(&self) {
        if self.restore_complete.load(Ordering::Acquire) {
            return;
        }
        let notified = self.restore_ready.notified();
        tokio::pin!(notified);
        // Register the waiter before re-checking the flag so a concurrent
        // `mark_restore_complete` cannot be lost between the check and the await.
        notified.as_mut().enable();
        if !self.restore_complete.load(Ordering::Acquire) {
            notified.await;
        }
    }

    /// 校验登录态。仅锁 auth，不锁 api，避免嵌套锁死锁。
    pub async fn check_login(&self) -> Result<(), AppError> {
        self.wait_restore_complete().await;
        self.auth.lock().await.require_login()
    }

    /// 获取当前 cookie 字符串。仅锁 auth，不锁 api。
    /// 命令中应先调此方法拿到 cookie，再锁 api 发请求，避免 ABBA 死锁。
    /// 未登录时返回空串借用，不产生堆分配。
    pub async fn cookie(&self) -> Cow<'static, str> {
        self.auth
            .lock()
            .await
            .cookie
            .clone()
            .map(Cow::Owned)
            .unwrap_or(Cow::Borrowed(""))
    }

    /// 取一份 ApiClient 快照用于发请求。
    ///
    /// 直接 `state.api.read().await` 会让读锁横跨整个网络往返；tokio 的 RwLock 是
    /// 公平的，因此挂起的写者（logout / save_cookie）会把后续读者一起堵住，
    /// 最坏要等到请求超时（15s）。快照共享同一个 reqwest Client（内部 Arc），
    /// 所以 cookie jar 仍然一致。
    pub async fn api_snapshot(&self) -> ApiClient {
        self.api.read().await.clone()
    }

    /// `get_song_url` 上游请求前的准入：先查风控熔断，再按 350ms 间隔排队。
    ///
    /// 返回 `Err(AppError::RiskControl)` 表示当前处于熔断窗口，调用方不应再
    /// 请求上游。等待用 `tokio::time::sleep` 在持锁之外进行，锁内只做常数级
    /// 时间计算，因此不会与 `api` / `auth` 的锁嵌套。
    pub async fn acquire_song_url_slot(&self) -> AppResult<()> {
        let now = Instant::now();
        let blocked_until = *self.song_url_blocked_until.lock().await;
        if should_block(now, blocked_until) {
            return Err(AppError::RiskControl(
                SONG_URL_RISK_CONTROL_HINT.to_string(),
            ));
        }

        let wait = {
            let mut last_slot = self.song_url_last_slot.lock().await;
            let (slot, wait) = next_slot(now, *last_slot, SONG_URL_MIN_INTERVAL);
            *last_slot = Some(slot);
            wait
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }

        // 排队期间其它请求可能已经命中风控：放弃这次上游请求，避免级联打爆上游。
        let blocked_after_wait =
            should_block(Instant::now(), *self.song_url_blocked_until.lock().await);
        if blocked_after_wait {
            return Err(AppError::RiskControl(
                SONG_URL_RISK_CONTROL_HINT.to_string(),
            ));
        }
        Ok(())
    }

    /// 上游命中风控后开启熔断窗口；窗口内 `acquire_song_url_slot` 直接失败。
    pub async fn trip_song_url_breaker(&self) {
        *self.song_url_blocked_until.lock().await =
            Some(risk_control_blocked_until(Instant::now()));
    }

    /// 提取 NCM 业务码。
    pub fn response_code(resp: &ApiResponse) -> i64 {
        resp.body
            .get("code")
            .and_then(|c| {
                c.as_i64()
                    .or_else(|| c.as_str().and_then(|s| s.parse().ok()))
            })
            .unwrap_or(resp.status)
    }

    /// 提取响应消息。返回借用，不产生堆分配。
    pub fn response_message(resp: &ApiResponse) -> Cow<'_, str> {
        resp.body
            .get("msg")
            .or_else(|| resp.body.get("message"))
            .and_then(|v| v.as_str())
            .map(Cow::Borrowed)
            .unwrap_or(Cow::Borrowed("Unknown error"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // The main binary installs the ring provider at startup; replicate that for tests.
    fn init_rustls() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    fn api_response(code: serde_json::Value) -> ApiResponse {
        ApiResponse {
            status: 200,
            body: code,
            cookie: vec![],
        }
    }

    #[test]
    fn response_code_returns_integer_code() {
        let resp = api_response(json!({ "code": 200 }));
        assert_eq!(AppState::response_code(&resp), 200);
    }

    #[test]
    fn response_code_parses_string_code() {
        let resp = api_response(json!({ "code": "200" }));
        assert_eq!(AppState::response_code(&resp), 200);
    }

    #[test]
    fn response_code_falls_back_to_status_on_missing_code() {
        let resp = api_response(json!({ "msg": "ok" }));
        assert_eq!(AppState::response_code(&resp), 200);
    }

    #[test]
    fn response_code_falls_back_to_status_on_null_code() {
        let resp = api_response(json!({ "code": null }));
        assert_eq!(AppState::response_code(&resp), 200);
    }

    #[test]
    fn response_message_returns_msg_field() {
        let resp = api_response(json!({ "code": 400, "msg": "密码错误" }));
        assert_eq!(AppState::response_message(&resp), "密码错误");
    }

    #[test]
    fn response_message_returns_message_field_as_fallback() {
        let resp = api_response(json!({ "code": 400, "message": "bad request" }));
        assert_eq!(AppState::response_message(&resp), "bad request");
    }

    #[test]
    fn response_message_returns_default_when_both_missing() {
        let resp = api_response(json!({ "code": 500 }));
        assert_eq!(AppState::response_message(&resp), "Unknown error");
    }

    #[test]
    fn auth_state_is_logged_in_requires_positive_user_id_and_non_empty_cookie() {
        let auth = AuthState {
            user_id: Some(123),
            cookie: Some("MUSIC_U=abc".to_string()),
            ..Default::default()
        };
        assert!(auth.is_logged_in());

        let no_id = AuthState {
            user_id: None,
            cookie: Some("MUSIC_U=abc".to_string()),
            ..Default::default()
        };
        assert!(!no_id.is_logged_in());

        let empty_cookie = AuthState {
            user_id: Some(123),
            cookie: Some("   ".to_string()),
            ..Default::default()
        };
        assert!(!empty_cookie.is_logged_in());
    }

    #[test]
    fn auth_state_require_login_returns_error_when_not_logged_in() {
        let auth = AuthState::default();
        assert!(auth.require_login().is_err());
        assert!(matches!(
            auth.require_login().unwrap_err(),
            AppError::Unauthorized
        ));
    }

    #[test]
    fn build_http_client_succeeds() {
        init_rustls();
        let result = build_http_client();
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn wait_restore_complete_returns_immediately_when_already_set() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        state.mark_restore_complete();
        state.wait_restore_complete().await;
    }

    #[tokio::test]
    async fn check_login_blocks_until_restore_complete() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        let state_clone = state.clone();
        let handle = tokio::spawn(async move { state_clone.check_login().await });
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        state.mark_restore_complete();
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), handle)
            .await
            .expect("timed out")
            .expect("join failed");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn double_mark_restore_complete_is_idempotent() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        state.mark_restore_complete();
        state.mark_restore_complete();
        state.wait_restore_complete().await;
    }

    // ── 歌曲 URL 节流：纯排期逻辑 ──

    #[test]
    fn next_slot_is_immediate_without_previous_request() {
        let now = Instant::now();
        let (slot, wait) = next_slot(now, None, SONG_URL_MIN_INTERVAL);
        assert_eq!(slot, now);
        assert!(wait.is_zero());
    }

    #[test]
    fn next_slot_waits_for_the_remaining_interval() {
        let now = Instant::now();
        let last_slot = now - Duration::from_millis(100);
        let (slot, wait) = next_slot(now, Some(last_slot), SONG_URL_MIN_INTERVAL);
        assert_eq!(slot, last_slot + SONG_URL_MIN_INTERVAL);
        assert_eq!(wait, Duration::from_millis(250));
    }

    #[test]
    fn next_slot_passes_once_interval_has_elapsed() {
        let now = Instant::now();
        let last_slot = now - SONG_URL_MIN_INTERVAL;
        let (slot, wait) = next_slot(now, Some(last_slot), SONG_URL_MIN_INTERVAL);
        assert_eq!(slot, now);
        assert!(wait.is_zero());
    }

    /// 并发调用者拿到的是互不相同的未来槽位，而不是同一个“现在”。
    #[test]
    fn next_slot_chains_reserved_slots() {
        let now = Instant::now();
        let (first, first_wait) = next_slot(now, None, SONG_URL_MIN_INTERVAL);
        let (second, second_wait) = next_slot(now, Some(first), SONG_URL_MIN_INTERVAL);
        assert!(first_wait.is_zero());
        assert_eq!(second, first + SONG_URL_MIN_INTERVAL);
        assert_eq!(second_wait, SONG_URL_MIN_INTERVAL);
    }

    // ── 风控熔断：纯判定逻辑 ──

    #[test]
    fn should_block_only_inside_window() {
        let now = Instant::now();
        assert!(!should_block(now, None), "没有熔断记录时不能拦截");
        assert!(!should_block(now, Some(now)), "截止时刻等于 now 视为已过期");
        assert!(!should_block(now, Some(now - Duration::from_millis(1))));
        assert!(should_block(now, Some(now + Duration::from_millis(1))));
    }

    #[test]
    fn risk_control_blocked_until_adds_window() {
        let now = Instant::now();
        assert_eq!(
            risk_control_blocked_until(now),
            now + SONG_URL_RISK_CONTROL_WINDOW
        );
    }

    // ── AppState 行为：节流排队 + 熔断准入 ──

    #[tokio::test]
    async fn acquire_song_url_slot_spaces_back_to_back_requests() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        let started = Instant::now();
        state
            .acquire_song_url_slot()
            .await
            .expect("首笔请求应立即放行");
        state
            .acquire_song_url_slot()
            .await
            .expect("第二笔请求应排队放行");
        assert!(
            started.elapsed() >= SONG_URL_MIN_INTERVAL,
            "两笔请求的间隔必须不小于节流窗口"
        );
    }

    #[tokio::test]
    async fn acquire_song_url_slot_rejects_inside_risk_control_window() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        state.trip_song_url_breaker().await;

        let error = state
            .acquire_song_url_slot()
            .await
            .expect_err("熔断窗口内必须拒绝");
        match error {
            AppError::RiskControl(message) => {
                assert!(message.contains("请稍候再试"), "message={message}");
            }
            other => panic!("熔断准入应返回 RiskControl，实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn acquire_song_url_slot_resumes_after_window_expires() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        state.trip_song_url_breaker().await;
        // 直接把截止时刻推到过去，避免测试真的等熔断窗口。
        *state.song_url_blocked_until.lock().await =
            Some(Instant::now() - Duration::from_millis(1));

        assert!(state.acquire_song_url_slot().await.is_ok());
    }

    #[tokio::test]
    async fn queued_slot_aborts_when_breaker_trips_while_waiting() {
        init_rustls();
        let state = AppState::new(None, Default::default()).expect("create state");
        // 首笔请求占用当前槽位，第二笔进入排队等待。
        state
            .acquire_song_url_slot()
            .await
            .expect("首笔请求应立即放行");

        let waiter = state.clone();
        let handle = tokio::spawn(async move { waiter.acquire_song_url_slot().await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        state.trip_song_url_breaker().await;

        let result = handle.await.expect("排队任务不应 panic");
        assert!(
            matches!(result, Err(AppError::RiskControl(_))),
            "排队期间进入熔断后应放弃请求，实际 {result:?}"
        );
    }
}
