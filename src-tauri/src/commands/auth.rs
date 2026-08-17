// 三种登录方式 + 会话管理。
// 设计完全对齐 CNMPlayer 的 src/app/api.rs + src/app/mod.rs::mark_login_success 模式：
//   1. 所有登录请求走 ncm_api::ApiClient（自动加密 + 自动捕获 Set-Cookie）
//   2. 业务码 200 视为成功（QR 的 803 同样）
//   3. 成功后调 user_account 拉取用户信息，合并 cookie，持久化到 session.toml
//   4. 启动时从 session.toml 读取 cookie，调 login_status 校验有效性
//   5. cookie 由 AppState.auth.cookie 显式持有，每次请求通过 Query::cookie() 传入

use std::borrow::Cow;
use std::path::PathBuf;

use ncm_api::{ApiResponse, Query};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::error::{map_ncm_err, AppError, AppResult};
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
    let api = build_anonymous_client()?;
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
            log::error!("[login_qr_key] 响应里没拿到 unikey, body = {}", resp.body);
            AppError::Internal("未拿到 unikey".to_string())
        })?
        .to_string();

    let qr_url = format!("https://music.163.com/login?codekey={unikey}");
    let qr_image = match render_qr_png(&qr_url) {
        Ok(img) => Some(img),
        Err(e) => {
            log::warn!("[login_qr_key] QR 渲染失败: {e}");
            None
        }
    };

    Ok(QrKeyResult {
        unikey,
        qr_url,
        qr_image,
    })
}

/// QR 登录 - 第二步：轮询扫码状态。
#[tauri::command]
pub async fn login_qr_check(
    app: AppHandle,
    state: State<'_, AppState>,
    unikey: String,
) -> AppResult<QrCheckResponse> {
    let resp = {
        let api = state.api.read().await;
        api.login_qr_check(&Query::new().param("key", &unikey))
            .await
            .map_err(map_ncm_err)?
    };

    let code = AppState::response_code(&resp) as i32;

    if code == 200 || code == 803 {
        let LoginResult {
            user_id,
            nickname,
            avatar_url,
        } = finalize_login(&app, &state, "qr", &resp).await?;
        return Ok(QrCheckResponse {
            code: 803,
            message: "登录成功".to_string(),
            nickname: Some(nickname),
            user_id: Some(user_id),
            avatar_url,
        });
    }

    let message = match code {
        800 => Cow::Borrowed("二维码已过期"),
        801 => Cow::Borrowed("等待扫码"),
        802 => Cow::Borrowed("已扫码，等待确认"),
        _ => AppState::response_message(&resp),
    };

    Ok(QrCheckResponse {
        code,
        message: message.into_owned(),
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
    if payload.account.trim().is_empty()
        || payload.md5_password.len() != 32
        || !payload.md5_password.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(AppError::InvalidParam("账号或密码格式错误".to_string()));
    }

    let resp = {
        let api = state.api.read().await;
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
        return Err(AppError::InvalidParam(
            "请输入有效的 11 位手机号".to_string(),
        ));
    }
    let api = state.api.read().await;
    let resp = api
        .captcha_sent(&Query::new().param("phone", phone))
        .await
        .map_err(map_ncm_err)?;
    ensure_business_success(&resp, &[200], "发送验证码")?;
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
        let api = state.api.read().await;
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
    // 400/502 等业务码在 ncm-api 中可能以 Ok(ApiResponse) 返回，必须先校验。
    ensure_business_success(resp, &[200, 803], "登录")?;

    // 新登录不能混入旧账号 Cookie；只接受本次登录响应下发的会话字段。
    let merged_cookie = merge_cookie(None, resp)
        .filter(|cookie| !cookie.trim().is_empty())
        .ok_or_else(|| AppError::Internal("未拿到登录 Cookie".to_string()))?;

    // 强制使用新 Cookie 拉取账户，并要求返回有效的非零用户 ID。
    let account_resp = {
        let api = state.api.read().await;
        api.user_account(&Query::new().cookie(&merged_cookie))
            .await
            .map_err(map_ncm_err)?
    };
    ensure_business_success(&account_resp, &[200], "读取用户资料")?;
    let (user_id, nickname, avatar_url) = extract_profile(&account_resp)
        .or_else(|| extract_profile(resp))
        .ok_or(AppError::Unauthorized)?;

    // 先完成持久化，再发布内存登录态，避免命令报错但 UI 已显示登录。
    persist_session_meta(
        user_id,
        &nickname,
        avatar_url.as_deref(),
        method,
        &merged_cookie,
    )?;
    if let Err(e) = persist_cookie(app, &merged_cookie) {
        // session.toml 是恢复会话的权威来源；旧 plugin-store 仅做兼容备份。
        log::warn!("[login] 写入兼容 Cookie store 失败: {e}");
    }

    state.api.write().await.set_cookie(merged_cookie.clone());
    {
        let mut auth = state.auth.lock().await;
        auth.user_id = Some(user_id);
        auth.nickname = Some(nickname.clone());
        auth.cookie = Some(merged_cookie);
        auth.login_method = Some(method.to_string());
        auth.avatar_url = avatar_url.clone().map(|c| c.into_owned());
    }

    Ok(LoginResult {
        user_id,
        nickname,
        avatar_url: avatar_url.map(|c| c.into_owned()),
    })
}

pub(crate) fn ensure_business_success(resp: &ApiResponse, accepted: &[i64], action: &str) -> AppResult<()> {
    let code = AppState::response_code(resp);
    if accepted.contains(&code) {
        return Ok(());
    }
    Err(AppError::Ncm(format!(
        "{action}失败 (code={code}): {}",
        AppState::response_message(resp)
    )))
}

fn extract_profile(resp: &ApiResponse) -> Option<(u64, String, Option<Cow<'_, str>>)> {
    let user_id = resp
        .body
        .pointer("/account/id")
        .or_else(|| resp.body.pointer("/data/account/id"))
        .and_then(|v| v.as_u64())
        .filter(|id| *id > 0)?;
    let nickname = resp
        .body
        .pointer("/profile/nickname")
        .or_else(|| resp.body.pointer("/data/profile/nickname"))
        .and_then(|v| v.as_str())
        .unwrap_or("网易云用户")
        .to_string();
    let avatar_url = resp
        .body
        .pointer("/profile/avatarUrl")
        .or_else(|| resp.body.pointer("/data/profile/avatarUrl"))
        .and_then(|v| v.as_str())
        .and_then(normalize_avatar_url);
    Some((user_id, nickname, avatar_url))
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
        .filter_map(|kv| {
            kv.trim()
                .split_once('=')
                .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        })
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
    state.wait_restore_complete().await;
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
        let api = state.api.read().await;
        if let Err(e) = api.logout(&Query::new().cookie(&c)).await {
            log::warn!("[logout] 调用 NCM 登出接口失败: {e}");
        }
    }

    // 清空 plugin-store
    if let Ok(store) = app.store("auth.json") {
        store.delete("cookie");
        let _ = store.save();
    }

    // 清空 TOML 持久化
    let _ = clear_session_meta();

    // 清空内存
    state.api.write().await.set_cookie(String::new());
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
    if payload.cookie.trim().is_empty()
        || !(payload.cookie.contains("MUSIC_U=") || payload.cookie.contains("MUSIC_A="))
    {
        return Err(AppError::InvalidParam(
            "Cookie 中缺少有效的登录凭据".to_string(),
        ));
    }
    let resp = {
        let api = state.api.read().await;
        api.user_account(&Query::new().cookie(&payload.cookie))
            .await
            .map_err(map_ncm_err)?
    };
    ensure_business_success(&resp, &[200], "Cookie 登录")?;
    let (user_id, nickname, avatar_url) = extract_profile(&resp).ok_or(AppError::Unauthorized)?;

    persist_session_meta(
        user_id,
        &nickname,
        avatar_url.as_deref(),
        "cookie",
        &payload.cookie,
    )?;
    if let Err(e) = persist_cookie(&app, &payload.cookie) {
        log::warn!("[login] 写入兼容 Cookie store 失败: {e}");
    }

    state.api.write().await.set_cookie(payload.cookie.clone());
    {
        let mut auth = state.auth.lock().await;
        auth.user_id = Some(user_id);
        auth.nickname = Some(nickname.clone());
        auth.cookie = Some(payload.cookie);
        auth.login_method = Some("cookie".to_string());
        auth.avatar_url = avatar_url.clone().map(|c| c.into_owned());
    }

    Ok(LoginResult {
        user_id,
        nickname,
        avatar_url: avatar_url.map(|c| c.into_owned()),
    })
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
    user_id: u64,
    nickname: &str,
    avatar_url: Option<&str>,
    method: &str,
    cookie: &str,
) -> AppResult<()> {
    let path =
        dirs_auth_session().ok_or_else(|| AppError::Internal("无法定位配置目录".to_string()))?;
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
    Ok(())
}

pub fn clear_session_meta() -> AppResult<()> {
    let Some(path) = dirs_auth_session() else {
        return Ok(());
    };
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

fn build_anonymous_client() -> AppResult<ncm_api::ApiClient> {
    let http = crate::state::build_http_client()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(ncm_api::ApiClient::new(None, http))
}

// ============================================================
// 工具：把 NCM avatarUrl 规整成可直接 <img src> 使用的 URL
// ============================================================

/// 把 NCM avatarUrl 规整成可直接 <img src> 使用的 URL。
/// NCM 偶尔返回 protocol-relative URL（"//p1.music.126.net/..."）或缺 scheme 的相对路径。
/// 已经是完整 URL 时零拷贝借用，否则构造新串。
pub fn normalize_avatar_url(raw: &str) -> Option<Cow<'_, str>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // protocol-relative: //p1.music.126.net/...
    if let Some(rest) = s.strip_prefix("//") {
        return Some(Cow::Owned(format!("https://{rest}")));
    }
    // 完整 URL
    if s.starts_with("http://") || s.starts_with("https://") {
        return Some(Cow::Borrowed(s));
    }
    // 缺 scheme 但以 / 开头（p1.music.126.net 是 NCM 头像域名）
    if let Some(rest) = s.strip_prefix('/') {
        return Some(Cow::Owned(format!("https://p1.music.126.net/{rest}")));
    }
    // 兜底：当作相对路径
    Some(Cow::Owned(format!("https://p1.music.126.net/{s}")))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    /// 两个文件夹具测试共用真实配置目录里的 session.toml，
    /// 必须串行执行，否则互相覆盖导致偶发失败。
    static SESSION_FILE_LOCK: Mutex<()> = Mutex::new(());

    fn response(body: serde_json::Value, cookie: Vec<&str>) -> ApiResponse {
        ApiResponse {
            status: 200,
            body,
            cookie: cookie.into_iter().map(str::to_string).collect(),
        }
    }

    #[test]
    fn failed_business_code_is_rejected_even_when_transport_succeeded() {
        let resp = response(json!({ "code": 502, "message": "bad password" }), vec![]);
        assert!(ensure_business_success(&resp, &[200], "登录").is_err());
    }

    #[test]
    fn profile_requires_a_nonzero_user_id() {
        let missing = response(json!({ "code": 200, "account": null }), vec![]);
        let zero = response(json!({ "code": 200, "account": { "id": 0 } }), vec![]);
        assert!(extract_profile(&missing).is_none());
        assert!(extract_profile(&zero).is_none());
    }

    #[test]
    fn login_cookie_merge_keeps_only_cookie_pairs() {
        let resp = response(
            json!({ "code": 200 }),
            vec!["MUSIC_U=new; Path=/; HttpOnly", "__csrf=token; Path=/"],
        );
        let merged = merge_cookie(None, &resp).expect("cookie should be produced");
        assert!(merged.contains("MUSIC_U=new"));
        assert!(merged.contains("__csrf=token"));
        assert!(!merged.contains("Path"));
    }

    // ============================================================
    // TOML corruption / graceful-degradation tests
    // ============================================================

    /// Empty file: `toml::from_str("")` should fail (no tables) → `.ok()` → None.
    #[test]
    fn toml_empty_string_returns_none() {
        let result: Option<SessionRecord> = toml::from_str("").ok();
        assert!(result.is_none(), "empty TOML should parse to None");
    }

    /// Missing required field `cookie`: deserialization fails → `.ok()` → None.
    #[test]
    fn toml_missing_cookie_returns_none() {
        let partial = r#"
user_id = 123456
nickname = "testuser"
login_method = "email"
updated_at = 1710000000
"#;
        let result: Option<SessionRecord> = toml::from_str(partial).ok();
        assert!(result.is_none(), "TOML missing 'cookie' should parse to None");
    }

    /// Missing required field `nickname`: deserialization fails → `.ok()` → None.
    #[test]
    fn toml_missing_nickname_returns_none() {
        let partial = r#"
user_id = 123456
login_method = "email"
cookie = "MUSIC_U=abc123"
updated_at = 1710000000
"#;
        let result: Option<SessionRecord> = toml::from_str(partial).ok();
        assert!(result.is_none(), "TOML missing 'nickname' should parse to None");
    }

    /// Missing required field `login_method`: deserialization fails → `.ok()` → None.
    #[test]
    fn toml_missing_login_method_returns_none() {
        let partial = r#"
user_id = 123456
nickname = "testuser"
cookie = "MUSIC_U=abc123"
updated_at = 1710000000
"#;
        let result: Option<SessionRecord> = toml::from_str(partial).ok();
        assert!(result.is_none(), "TOML missing 'login_method' should parse to None");
    }

    /// Malformed syntax (random junk text, not TOML): parse fails → `.ok()` → None.
    #[test]
    fn toml_malformed_syntax_returns_none() {
        let junk = "this is not TOML at all!!\n{key}=value???\n[invalid section";
        let result: Option<SessionRecord> = toml::from_str(junk).ok();
        assert!(result.is_none(), "malformed TOML should parse to None");
    }

    /// `cookie` field with wrong type (integer instead of string): fails → None.
    #[test]
    fn toml_wrong_type_cookie_returns_none() {
        let wrong_type = r#"
user_id = 123456
nickname = "testuser"
login_method = "email"
cookie = 12345
updated_at = 1710000000
"#;
        let result: Option<SessionRecord> = toml::from_str(wrong_type).ok();
        assert!(result.is_none(), "TOML with wrong-type cookie should parse to None");
    }

    /// `user_id` with wrong type (string instead of integer): fails → None.
    #[test]
    fn toml_wrong_type_user_id_returns_none() {
        let wrong_type = r#"
user_id = "not-a-number"
nickname = "testuser"
login_method = "email"
cookie = "MUSIC_U=abc123"
updated_at = 1710000000
"#;
        let result: Option<SessionRecord> = toml::from_str(wrong_type).ok();
        assert!(result.is_none(), "TOML with wrong-type user_id should parse to None");
    }

    /// Valid TOML with all required fields correctly typed parses successfully.
    #[test]
    fn toml_valid_record_parses_successfully() {
        let valid = r#"
user_id = 123456
nickname = "testuser"
login_method = "email"
cookie = "MUSIC_U=abc123; __csrf=token"
updated_at = 1710000000
avatar_url = "https://example.com/avatar.jpg"
"#;
        let result: Option<SessionRecord> = toml::from_str(valid).ok();
        assert!(result.is_some(), "valid TOML should parse successfully");
        let record = result.unwrap();
        assert_eq!(record.user_id, 123456);
        assert_eq!(record.nickname, "testuser");
        assert_eq!(record.login_method, "email");
        assert_eq!(record.cookie, "MUSIC_U=abc123; __csrf=token");
        assert_eq!(record.avatar_url, Some("https://example.com/avatar.jpg".to_string()));
    }

    /// Valid TOML without optional `avatar_url` parses correctly (Option field absent).
    #[test]
    fn toml_valid_record_without_optional_fields_parses() {
        let valid = r#"
user_id = 999
nickname = "noavatar"
login_method = "qr"
cookie = "MUSIC_U=xyz"
updated_at = 1710000000
"#;
        let result: Option<SessionRecord> = toml::from_str(valid).ok();
        assert!(result.is_some(), "valid TOML without optional fields should parse");
        let record = result.unwrap();
        assert_eq!(record.user_id, 999);
        assert_eq!(record.avatar_url, None);
    }

    /// Test the full `load_session_meta()` end-to-end with corrupt file fixtures.
    /// Creates actual files at the expected config path, testing every corrupt scenario.
    #[test]
    fn load_session_meta_with_corrupt_files_returns_none() {
        let _guard = SESSION_FILE_LOCK.lock().unwrap();
        let path = dirs_auth_session().expect("should resolve config dir");
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).ok();

        // Save existing file if any
        let saved = std::fs::read_to_string(&path).ok();

        let corrupt_cases: &[(&str, &[u8])] = &[
            ("empty file", b""),
            ("partial missing cookie",
             br#"user_id = 1
nickname = "x"
login_method = "qr"
updated_at = 1
"#),
            ("malformed syntax", b"this is garbage {{{ not toml"),
            ("binary garbage (non-UTF8)", b"\x00\x01\x02\xFF\xFE\xFD"),
        ];

        for (label, content) in corrupt_cases {
            std::fs::write(&path, content).expect("write corrupt fixture");
            let result = load_session_meta();
            assert!(
                result.is_none(),
                "load_session_meta() should return None for corrupt case: {label}"
            );
        }

        // Restore original file or clean up
        match saved {
            Some(original) => std::fs::write(&path, original).ok(),
            None => std::fs::remove_file(&path).ok(),
        };
    }

    /// `persist_session_meta()` overwrites a corrupt file with valid TOML,
    /// then `load_session_meta()` can read it back successfully.
    #[test]
    fn persist_overwrites_corrupt_file_and_load_recovers() {
        let _guard = SESSION_FILE_LOCK.lock().unwrap();
        let path = dirs_auth_session().expect("should resolve config dir");
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).ok();
        let saved = std::fs::read_to_string(&path).ok();

        // Step 1: Write corrupt file
        std::fs::write(&path, b"corrupt garbage {{{ not toml").unwrap();

        // Step 2: load_session_meta() returns None
        assert!(load_session_meta().is_none(), "corrupt file should yield None");

        // Step 3: persist_session_meta() overwrites corrupt file
        persist_session_meta(42, "recovery", None, "qr", "MUSIC_U=recovered")
            .expect("persist should overwrite corrupt file");

        // Step 4: load_session_meta() now returns valid record
        let recovered = load_session_meta().expect("should recover after persist overwrites");
        assert_eq!(recovered.user_id, 42);
        assert_eq!(recovered.nickname, "recovery");
        assert_eq!(recovered.cookie, "MUSIC_U=recovered");

        // Restore
        match saved {
            Some(original) => std::fs::write(&path, original).ok(),
            None => std::fs::remove_file(&path).ok(),
        };
    }
}
