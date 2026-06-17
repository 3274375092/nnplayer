// 全局应用状态。
//
// 与 CNMPlayer 保持一致的设计：
//   - 持有 ncm_api::ApiClient（自带 Cookie 存储 + 设备指纹 + 加密层）
//   - 同时维护一个轻量的 AuthState（用户 id、昵称），方便前端展示
//   - 二者均用 Arc<Mutex> 包裹，保证多线程安全
//
// ApiClient 是 ncm-api-rs 提供的"开箱即用"客户端：
//   - 自动注入 NCM 风控所需的 cookie 字段（os、deviceId、NMTID 等）
//   - 自动捕获响应 Set-Cookie 到 response.cookie
//   - 自动按 CryptoType 进行 weapi/eapi 加密
// 调用方只需 login_status / login / login_cellphone 等接口即可。
//
// QQ 音乐使用独立的客户端 + 独立的 AuthState（与 NCM 解耦）：
//   - qq_music::QqMusicClient 是无状态 HTTP 客户端，可在 AppState 间 clone
//   - QQ 登录态（QqToken）独立持久化到 session_qq.toml / auth.json.qq_cookie
//   - 两种平台的 AuthState 不互相影响
//
// QQ 扫码登录 session 管理：
//   - 每个 QR session 是独立的 MqttLoginSession 长连接
//   - session_id → MqttLoginSession 存放在 AppState.qq_login_sessions
//   - login success / 主动 cancel / session 过期 → 从 Map 中移除

use std::collections::HashMap;
use std::sync::Arc;

use ncm_api::{ApiClient, ApiResponse};
use qq_music::{MqttLoginSession, QqMusicClient, QqToken};
use reqwest::Client;
use tokio::sync::Mutex;

use crate::error::AppError;

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
        self.user_id.is_some() && self.cookie.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
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
    pub api: Arc<Mutex<ApiClient>>,
    /// 轻量用户信息（user_id、nickname）。
    pub auth: Arc<Mutex<AuthState>>,
    /// qq-music HTTP 客户端。无状态，可跨线程共享。
    pub qq: Arc<QqMusicClient>,
    /// QQ 登录态。`None` 表示未登录。
    pub qq_token: Arc<Mutex<Option<QqToken>>>,
    /// QQ 扫码登录活跃 session。key = session_id (= qrcode_id)。
    /// 用户扫码成功 / 主动 cancel / session 过期时移除。
    pub qq_login_sessions: Arc<Mutex<HashMap<String, MqttLoginSession>>>,
}

impl AppState {
    pub fn new(cookie: Option<String>, auth: AuthState) -> anyhow::Result<Self> {
        let http = Client::builder()
            .user_agent(concat!(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ",
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/53736"
            ))
            .cookie_store(true)
            .build()?;

        let api = ApiClient::new(cookie, http);

        Ok(Self {
            api: Arc::new(Mutex::new(api)),
            auth: Arc::new(Mutex::new(auth)),
            qq: Arc::new(QqMusicClient::new()),
            qq_token: Arc::new(Mutex::new(None)),
            qq_login_sessions: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// 校验 NCM 登录态。仅锁 auth，不锁 api，避免嵌套锁死锁。
    pub async fn check_login(&self) -> Result<(), AppError> {
        self.auth.lock().await.require_login()
    }

    /// 获取当前 NCM cookie 字符串。仅锁 auth，不锁 api。
    /// 命令中应先调此方法拿到 cookie，再锁 api 发请求，避免 ABBA 死锁。
    pub async fn cookie(&self) -> String {
        self.auth
            .lock()
            .await
            .cookie
            .clone()
            .unwrap_or_default()
    }

    /// 读取当前 QQ token 的克隆。调用方在闭包内使用，避免长持锁。
    pub async fn qq_token_snapshot(&self) -> Option<QqToken> {
        self.qq_token.lock().await.clone()
    }

    /// 写入 QQ token。`None` 表示清空登录态。
    pub async fn set_qq_token(&self, token: Option<QqToken>) {
        *self.qq_token.lock().await = token;
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

    /// 提取响应消息。
    pub fn response_message(resp: &ApiResponse) -> String {
        resp.body
            .get("msg")
            .or_else(|| resp.body.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string()
    }
}