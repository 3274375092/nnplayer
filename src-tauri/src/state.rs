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

use std::sync::Arc;

use ncm_api::{ApiClient, ApiResponse};
use reqwest::Client;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};

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
}

impl AppState {
    pub fn new(cookie: Option<String>) -> anyhow::Result<Self> {
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
            auth: Arc::new(Mutex::new(AuthState::default())),
        })
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

/// 从 ApiResponse 的 Set-Cookie 中合并出新 cookie 字符串。
pub fn merge_cookie(prev: Option<&str>, resp: &ApiResponse) -> Option<String> {
    if resp.cookie.is_empty() {
        return prev.map(|s| s.to_string());
    }

    let mut map: std::collections::HashMap<String, String> =
        prev.unwrap_or("").split(';').filter_map(|kv| {
            let kv = kv.trim();
            kv.split_once('=').map(|(k, v)| {
                (k.trim().to_string(), v.trim().to_string())
            })
        }).collect();

    for raw in &resp.cookie {
        // raw 类似 "MUSIC_U=xxx; Path=/; HttpOnly"
        if let Some((k, v)) = raw.split(';').next().and_then(|s| s.split_once('=')) {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    if map.is_empty() {
        None
    } else {
        Some(
            map.iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}