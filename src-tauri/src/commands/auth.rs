// 三种登录方式 + 会话管理。
// 设计完全对齐 CNMPlayer 的 src/app/api.rs + src/app/mod.rs::mark_login_success 模式：
//   1. 所有登录请求走 ncm_api::ApiClient（自动加密 + 自动捕获 Set-Cookie）
//   2. 业务码 200 视为成功（QR 的 803 同样）
//   3. 成功后调 user_account 拉取用户信息，合并 cookie，持久化到 session.toml
//   4. 启动时从 session.toml 读取 cookie，调 login_status 校验有效性
//   5. cookie 由 AppState.auth.cookie 显式持有，每次请求通过 Query::cookie() 传入

use std::path::PathBuf;

use ncm_api::{ApiResponse, Query};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ============================================================
// 数据结构
// ============================================================

/// 登录结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub user_id: u64,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

/// 登录状态 DTO（前端展示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateDto {
    pub logged_in: bool,
    pub nickname: Option<String>,
    pub user_id: Option<u64>,
    pub login_method: Option<String>,
    pub avatar_url: Option<String>,
}

/// 持久化的会话记录（TOML 格式）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionRecord {
    pub user_id: u64,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub login_method: String,
    pub cookie: String,
    pub updated_at: i64,
}

// ============================================================
// QR 登录
// ============================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrKeyResult {
    pub unikey: String,
    /// 二维码内容的 URL（与 CNMPlayer 一致：https://music.163.com/login?codekey={key}）
    pub qr_url: String,
    /// base64 PNG data URI（前端可直接放进 <img>）
    pub qr_image: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrCheckResponse {
    /// NCM 业务码：800/801/802/803；200=登录成功
    pub code: i32,
    pub message: String,
    pub nickname: Option<String>,
    pub user_id: Option<u64>,
    /// 用户头像 URL（已规整为可直接 <img src> 使用的形式）
    pub avatar_url: Option<String>,
}

/// QR 登录 - 第一步：获取 unikey + 生成二维码。
#[tauri::command]
pub async fn login_qr_key() -> AppResult<QrKeyResult> {
    // 临时 ApiClient（不需要登录态）
    let api = build_anonymous_client(None)?;
    let resp = api.login_qr_key(&Query::new()).await.map_err(map_ncm_err)?;

    // 兼容两种返回结构：
    //   1. {"code":200,"unikey":"xxx"}                   — NetEase 当前格式
    //   2. {"code":200,"data":{"unikey":"xxx"}}          — ncm-api 仿 Node.js 旧格式
    let unikey = resp
        .body
        .pointer("/unikey")
        .or_else(|| resp.body.pointer("/data/unikey"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            log::error!(
                "[login_qr_key] 响应里没拿到 unikey, body = {}",
                resp.body
            );
            AppError::Internal("未拿到 unikey".to_string())
        })?
        .to_string();

    let qr_url = format!("https://music.163.com/login?codekey={unikey}");
    let qr_image = render_qr_png(&qr_url).ok();

    Ok(QrKeyResult { unikey, qr_url, qr_image })
}

/// QR 登录 - 第二步：轮询扫码状态。
#[tauri::command]
pub async fn login_qr_check(
    app: AppHandle,
    state: State<'_, AppState>,
    unikey: String,
) -> AppResult<QrCheckResponse> {
    let resp = {
        let api = state.api.lock().await;
        api.login_qr_check(&Query::new().param("key", &unikey))
            .await
            .map_err(map_ncm_err)?
    };

    let code = AppState::response_code(&resp) as i32;

    if code == 200 || code == 803 {
        let LoginResult { user_id, nickname, avatar_url } =
            finalize_login(&app, &state, "qr", &resp).await?;
        return Ok(QrCheckResponse {
            code: 803,
            message: "登录成功".to_string(),
            nickname: Some(nickname),
            user_id: Some(user_id),
            avatar_url,
        });
    }

    let message = match code {
        800 => "二维码已过期".to_string(),
        801 => "等待扫码".to_string(),
        802 => "已扫码，等待确认".to_string(),
        _ => AppState::response_message(&resp),
    };

    Ok(QrCheckResponse {
        code,
        message: message.to_string(),
        nickname: None,
        user_id: None,
        avatar_url: None,
    })
}

// ============================================================
// 账号密码登录（用户名 / 邮箱）
// ============================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLoginPayload {
    /// 邮箱 / 用户名
    pub account: String,
    /// 前端 MD5 后的 32 位小写 hex 字符串
    /// ncm-api 的 login() 内部若再 MD5 一次会得到错误的二次哈希
    /// 这里通过 username + md5_password 两个字段传入
    pub md5_password: String,
}

#[tauri::command]
pub async fn login_with_account(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: AccountLoginPayload,
) -> AppResult<LoginResult> {
    if payload.account.trim().is_empty() || payload.md5_password.len() != 32 {
        return Err(AppError::InvalidParam("账号或密码格式错误".to_string()));
    }

    let resp = {
        let api = state.api.lock().await;
        // 注意：ncm-api 的 login() 在 Query 中已传 md5_password 时不会再做 MD5
        api.login(
            &Query::new()
                .param("email", &payload.account)
                .param("md5_password", &payload.md5_password),
        )
        .await
        .map_err(map_ncm_err)?
    };

    finalize_login(&app, &state, "account", &resp).await
}

// ============================================================
// 手机验证码登录
// ============================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendCaptchaPayload {
    pub phone: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptchaLoginPayload {
    pub phone: String,
    pub captcha: String,
}

/// 发送验证码（与 CNMPlayer 一致调用 /api/sms/captcha/sent）。
#[tauri::command]
pub async fn login_send_captcha(
    state: State<'_, AppState>,
    payload: SendCaptchaPayload,
) -> AppResult<()> {
    let phone = payload.phone.trim();
    if phone.len() != 11 || !phone.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::InvalidParam("请输入有效的 11 位手机号".to_string()));
    }
    let api = state.api.lock().await;
    api.captcha_sent(&Query::new().param("phone", phone))
        .await
        .map_err(map_ncm_err)?;
    Ok(())
}

/// 验证码登录（与 CNMPlayer 一致：captcha 同时作为 password 字段）。
#[tauri::command]
pub async fn login_with_captcha(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CaptchaLoginPayload,
) -> AppResult<LoginResult> {
    if payload.phone.trim().len() != 11 || payload.captcha.trim().is_empty() {
        return Err(AppError::InvalidParam("手机号或验证码无效".to_string()));
    }

    let resp = {
        let api = state.api.lock().await;
        api.login_cellphone(
            &Query::new()
                .param("phone", payload.phone.trim())
                .param("captcha", payload.captcha.trim()),
        )
        .await
        .map_err(map_ncm_err)?
    };

    finalize_login(&app, &state, "phone", &resp).await
}

// ============================================================
// 通用：登录成功后的统一收尾
// ============================================================

async fn finalize_login(
    app: &AppHandle,
    state: &State<'_, AppState>,
    method: &str,
    resp: &ApiResponse,
) -> AppResult<LoginResult> {
    // 1. 合并 cookie：取上一次（state.auth.cookie）+ 本次响应的 Set-Cookie
    let merged_cookie = {
        let prev = state.auth.lock().await.cookie.clone();
        let merged = merge_cookie(prev.as_deref(), resp);
        if let Some(c) = merged.clone() {
            // 同步到 ApiClient，供后续请求使用
            state.api.lock().await.set_cookie(c.clone());
        }
        merged
    }
    .ok_or_else(|| AppError::Internal("未拿到登录 cookie".to_string()))?;

    // 2. 拉取用户信息（/user/account）。强制带上合并后的 cookie
    let (user_id, nickname, avatar_url) = {
        let api = state.api.lock().await;
        let fetch_profile = |r: &ApiResponse| -> (u64, String, Option<String>) {
            let uid = r
                .body
                .pointer("/account/id")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let nick = r
                .body
                .pointer("/profile/nickname")
                .and_then(|v| v.as_str())
                .unwrap_or("网易云用户")
                .to_string();
            let avatar = r
                .body
                .pointer("/profile/avatarUrl")
                .and_then(|v| v.as_str())
                .and_then(normalize_avatar_url);
            (uid, nick, avatar)
        };
        match api
            .user_account(&Query::new().cookie(&merged_cookie))
            .await
        {
            Ok(r) => fetch_profile(&r),
            Err(e) => {
                log::warn!("[login] user_account 拉取失败: {e}");
                // 兜底用登录响应 body（多数情况没有 avatarUrl）
                let (uid, nick, _) = fetch_profile(resp);
                (uid, nick, None)
            }
        }
    };

    // 3. 写内存
    {
        let mut auth = state.auth.lock().await;
        auth.user_id = Some(user_id);
        auth.nickname = Some(nickname.clone());
        auth.cookie = Some(merged_cookie.clone());
        auth.login_method = Some(method.to_string());
        auth.avatar_url = avatar_url.clone();
    }

    // 4. 持久化（plugin-store + TOML 双份）
    persist_cookie(app, &merged_cookie)?;
    persist_session_meta(app, user_id, &nickname, avatar_url.as_deref(), method, &merged_cookie)?;

    Ok(LoginResult { user_id, nickname, avatar_url })
}

/// 从 ApiResponse.cookie（Set-Cookie 数组）中合并出新的 cookie 字符串。
fn merge_cookie(prev: Option<&str>, resp: &ApiResponse) -> Option<String> {
    use std::collections::HashMap;

    let prev_empty = prev.map(str::is_empty).unwrap_or(true);
    if resp.cookie.is_empty() && prev_empty {
        return None;
    }

    let mut map: HashMap<String, String> = prev
        .unwrap_or("")
        .split(';')
        .filter_map(|kv| kv.trim().split_once('=').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect();

    for raw in &resp.cookie {
        // raw 类似 "MUSIC_U=xxx; Path=/; HttpOnly"
        if let Some(part) = raw.split(';').next() {
            if let Some((k, v)) = part.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
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

// ============================================================
// 通用：会话读写
// ============================================================

#[tauri::command]
pub async fn get_auth_state(state: State<'_, AppState>) -> AppResult<AuthStateDto> {
    let auth = state.auth.lock().await;
    Ok(AuthStateDto {
        logged_in: auth.is_logged_in(),
        nickname: auth.nickname.clone(),
        user_id: auth.user_id,
        login_method: auth.login_method.clone(),
        avatar_url: auth.avatar_url.clone(),
    })
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    // 调用 NCM 退出（最好携带 cookie 以确保服务端失效）
    let cookie = state.auth.lock().await.cookie.clone();
    if let Some(c) = cookie {
        let api = state.api.lock().await;
        let _ = api.logout(&Query::new().cookie(&c)).await;
    }

    // 清空 plugin-store
    if let Ok(store) = app.store("auth.json") {
        store.delete("cookie");
        let _ = store.save();
    }

    // 清空 TOML 持久化
    let _ = clear_session_meta();

    // 清空内存
    state.api.lock().await.set_cookie(String::new());
    *state.auth.lock().await = Default::default();

    Ok(())
}

/// 旧接口保留：直接粘贴 Cookie 登录。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookiePayload {
    pub cookie: String,
}

#[tauri::command]
pub async fn save_cookie(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CookiePayload,
) -> AppResult<LoginResult> {
    state.api.lock().await.set_cookie(payload.cookie.clone());

    let resp = {
        let api = state.api.lock().await;
        api.user_account(&Query::new().cookie(&payload.cookie))
            .await
            .map_err(map_ncm_err)?
    };

    let user_id = resp
        .body
        .pointer("/account/id")
        .and_then(|v| v.as_u64())
        .ok_or(AppError::Unauthorized)?;
    let nickname = resp
        .body
        .pointer("/profile/nickname")
        .and_then(|v| v.as_str())
        .unwrap_or("网易云用户")
        .to_string();
    let avatar_url = resp
        .body
        .pointer("/profile/avatarUrl")
        .and_then(|v| v.as_str())
        .and_then(normalize_avatar_url);

    {
        let mut auth = state.auth.lock().await;
        auth.user_id = Some(user_id);
        auth.nickname = Some(nickname.clone());
        auth.cookie = Some(payload.cookie.clone());
        auth.login_method = Some("cookie".to_string());
        auth.avatar_url = avatar_url.clone();
    }

    persist_cookie(&app, &payload.cookie)?;
    persist_session_meta(&app, user_id, &nickname, avatar_url.as_deref(), "cookie", &payload.cookie)?;

    Ok(LoginResult { user_id, nickname, avatar_url })
}

// ============================================================
// 持久化辅助
// ============================================================

fn persist_cookie(app: &AppHandle, cookie: &str) -> AppResult<()> {
    let store = app
        .store("auth.json")
        .map_err(|e| AppError::Store(e.to_string()))?;
    store.set("cookie", serde_json::Value::String(cookie.to_string()));
    store.save().map_err(|e| AppError::Store(e.to_string()))?;
    Ok(())
}

fn persist_session_meta(
    app: &AppHandle,
    user_id: u64,
    nickname: &str,
    avatar_url: Option<&str>,
    method: &str,
    cookie: &str,
) -> AppResult<()> {
    let path = session_path().ok_or_else(|| AppError::Internal("无法定位配置目录".to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let record = SessionRecord {
        user_id,
        nickname: nickname.to_string(),
        avatar_url: avatar_url.map(|s| s.to_string()),
        login_method: method.to_string(),
        cookie: cookie.to_string(),
        updated_at: now_unix(),
    };
    let raw = toml::to_string_pretty(&record)
        .map_err(|e| AppError::Internal(format!("toml 序列化失败: {e}")))?;
    std::fs::write(&path, raw).map_err(AppError::Io)?;

    // 防止未使用的 app 警告
    let _ = app;
    Ok(())
}

pub fn clear_session_meta() -> AppResult<()> {
    let Some(path) = dirs_auth_session() else { return Ok(()) };
    if path.is_file() {
        std::fs::remove_file(&path).map_err(AppError::Io)?;
    }
    Ok(())
}

/// 读取持久化的 session（启动时调用）。
pub fn load_session_meta() -> Option<SessionRecord> {
    let path = dirs_auth_session()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    toml::from_str(&raw).ok()
}

/// 从 session 记录中提取 AuthState 的初始值（同步，用于 AppState::new）。
pub fn session_to_auth(record: &SessionRecord) -> crate::state::AuthState {
    crate::state::AuthState {
        user_id: Some(record.user_id),
        nickname: Some(record.nickname.clone()),
        cookie: Some(record.cookie.clone()),
        login_method: Some(record.login_method.clone()),
        avatar_url: record.avatar_url.clone(),
    }
}

fn session_path() -> Option<PathBuf> {
    dirs_auth_session()
}

fn dirs_auth_session() -> Option<PathBuf> {
    use directories::BaseDirs;
    let root = BaseDirs::new()?.config_dir().join("nnplayer");
    Some(root.join("auth").join("session.toml"))
}

fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn build_anonymous_client(_cookie: Option<String>) -> AppResult<ncm_api::ApiClient> {
    use reqwest::Client;
    let http = Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ",
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ))
        .cookie_store(true)
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(ncm_api::ApiClient::new(_cookie, http))
}

pub(crate) fn map_ncm_err(e: ncm_api::NcmError) -> AppError {
    AppError::Ncm(e.to_string())
}

// ============================================================
// 工具：把 NCM avatarUrl 规整成可直接 <img src> 使用的 URL
// ============================================================

/// 把 NCM avatarUrl 规整成可直接 <img src> 使用的 URL。
/// NCM 偶尔返回 protocol-relative URL（"//p1.music.126.net/..."）或缺 scheme 的相对路径。
pub fn normalize_avatar_url(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // protocol-relative: //p1.music.126.net/...
    if let Some(rest) = s.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    // 完整 URL
    if s.starts_with("http://") || s.starts_with("https://") {
        return Some(s.to_string());
    }
    // 缺 scheme 但以 / 开头（p1.music.126.net 是 NCM 头像域名）
    if let Some(rest) = s.strip_prefix('/') {
        return Some(format!("https://p1.music.126.net/{rest}"));
    }
    // 兜底：当作相对路径
    Some(format!("https://p1.music.126.net/{s}"))
}

// ============================================================
// 工具：生成二维码 PNG data URI
// ============================================================

fn render_qr_png(content: &str) -> anyhow::Result<String> {
    use base64::Engine;
    use image::{ImageBuffer, Luma};
    use std::io::Cursor;

    // 1. 算二维码模块矩阵（QrCode 是方形的,只用一个 size）
    let code = qrcode::QrCode::new(content.as_bytes())?;
    let size: usize = code.width();

    // 2. 边距（quiet zone）4 个模块，避免扫描器裁掉边角
    const QUIET: u32 = 4;
    let img_w: u32 = (size as u32) + QUIET * 2;
    let img_h: u32 = img_w; // 方形

    // 3. 遍历每个像素：深色模块 -> 黑，浅色 -> 白
    //    code 的有效模块范围是 [0, size)，QUIET 边距在外圈。
    //    索引 QrCode 用 (x, y) -> Color，匹配 Dark 才是深色。
    let img: ImageBuffer<Luma<u8>, Vec<u8>> = ImageBuffer::from_fn(img_w, img_h, |x, y| {
        let mx = x as i32 - QUIET as i32;
        let my = y as i32 - QUIET as i32;
        let dark = (0..size as i32).contains(&mx)
            && (0..size as i32).contains(&my)
            && matches!(code[(mx as usize, my as usize)], qrcode::Color::Dark);
        if dark {
            Luma([0u8])
        } else {
            Luma([255u8])
        }
    });

    // 4. 编码成 PNG 字节
    let mut png_bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)?;

    // 5. base64 编码，返回 data URI
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}