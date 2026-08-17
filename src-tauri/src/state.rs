// 全局应用状态。
//
// 与 CNMPlayer 保持一致的设计：
//   - 持有 ncm_api::ApiClient（自带 Cookie 存储 + 设备指纹 + 加密层）
//   - 同时维护一个轻量的 AuthState（用户 id、昵称），方便前端展示
//   - ApiClient 用 RwLock：普通业务请求可以并发，登录/退出时才需要写锁
//   - AuthState 用 Mutex，保证登录态更新原子化
//
// ApiClient 是 ncm-api-rs 提供的"开箱即用"客户端：
//   - 自动注入 NCM 风控所需的 cookie 字段（os、deviceId、NMTID 等）
//   - 自动捕获响应 Set-Cookie 到 response.cookie
//   - 自动按 CryptoType 进行 weapi/eapi 加密
// 调用方只需 login_status / login / login_cellphone 等接口即可。

use std::borrow::Cow;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use ncm_api::{ApiClient, ApiResponse};
use reqwest::Client;
use tokio::sync::{Mutex, Notify, RwLock};

use crate::error::AppError;

const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ",
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/53736"
);

/// Build a shared reqwest Client with the standard UA, cookie store, and timeouts.
pub(crate) fn build_http_client() -> anyhow::Result<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .cookie_store(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(Into::into)
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
    pub fn is_logged_in(&self) -> bool {
        self.user_id.is_some_and(|id| id > 0)
            && self
                .cookie
                .as_deref()
                .is_some_and(|cookie| !cookie.trim().is_empty())
    }

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
    use ncm_api::ApiResponse;
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
}
