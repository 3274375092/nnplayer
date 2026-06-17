// QQ 音乐登录与会话管理。
//
// 设计原则：
//   1. 支持两种登录方式：
//      a) 二维码登录（HTTP 拉二维码 + MQTT 长连接订阅扫码状态）
//      b) Cookie 粘贴（用户从浏览器 DevTools 复制 cookie 直接登录）
//   2. 与 NCM auth 保持完全解耦：独立的 SessionRecord、独立的 AuthStateDto
//   3. 持久化与 NCM 一致：双份（tauri-plugin-store 写 auth.json.qq_cookie +
//      TOML 写 session_qq.toml 用于启动恢复）
//   4. 启动恢复时只校验 cookie 是否有效（不直接喂 AuthState）；前端通过
//      user_store.refresh() 触发 get_auth_state 拉取
//   5. 账号密码 / 手机验证码登录**协议不存在**（QQ 音乐官方仅支持 QR + 第三方 cookie）
//
// QQ cookie 字符串格式（与 QqToken::to_cookie 一致）：
//   uin=<music_id>; qqmusic_key=<music_key>; qm_keyst=<music_key>;
//   tmeLoginType=<login_type>
//
// 浏览器导出的完整 cookie 需先归一化到上述格式。

use std::path::PathBuf;

use qq_music::{MqttLoginSession, QqLoginCode, QqLoginQr, QqToken};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use crate::error::{map_qq_err, AppError, AppResult};
use crate::state::AppState;

// ============================================================
// DTO
// ============================================================

/// QQ 登录结果（前端展示用，cookie 字段保留方便调试）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QqLoginResult {
    pub user_id: u64,
    /// Cookie 字符串（可粘回浏览器验证）。
    pub cookie: String,
    /// 登录类型（QQ 协议定义）。
    pub login_type: u64,
}

/// QQ 登录状态 DTO（与 NCM AuthStateDto 对称）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QqAuthStateDto {
    pub logged_in: bool,
    pub user_id: Option<u64>,
    pub login_method: Option<String>,
    /// Cookie 字符串（前端可选择展示给用户复制回浏览器）
    pub cookie: Option<String>,
}

/// QQ 扫码登录轮询响应 DTO。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QqLoginCheckDto {
    /// 状态码：`WaitingScan` / `WaitingConfirm` / `Success` / `QrCodeExpired` / `Failed`
    pub code: String,
    /// 登录成功时携带完整 token（包含 refresh_token）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<TokenDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenDto {
    pub user_id: u64,
    pub cookie: String,
    pub login_type: u64,
}

/// 持久化的 QQ 会话记录（TOML 格式，与 session.toml 平行）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QqSessionRecord {
    pub user_id: u64,
    pub music_key: String,
    pub refresh_token: String,
    pub refresh_key: String,
    pub login_type: u64,
    pub expires_at: Option<i64>,
    pub updated_at: i64,
}

impl QqSessionRecord {
    fn to_token(&self) -> QqToken {
        QqToken {
            music_id: self.user_id,
            music_key: self.music_key.clone(),
            refresh_token: self.refresh_token.clone(),
            refresh_key: self.refresh_key.clone(),
            login_type: self.login_type,
            expires_at: self.expires_at,
        }
    }

    fn from_token(token: &QqToken) -> Self {
        Self {
            user_id: token.music_id,
            music_key: token.music_key.clone(),
            refresh_token: token.refresh_token.clone(),
            refresh_key: token.refresh_key.clone(),
            login_type: token.login_type,
            expires_at: token.expires_at,
            updated_at: now_unix(),
        }
    }
}

// ============================================================
// 公开命令
// ============================================================

/// Cookie 粘贴登录。
///
/// 用户从浏览器 DevTools 复制 QQ 音乐 cookie，粘贴到应用内。
/// 字符串格式：与 `QqToken::to_cookie` 一致（即 `to_cookie` 输出的 4 字段）。
#[tauri::command]
pub async fn qq_login_set_cookie(
    app: AppHandle,
    state: State<'_, AppState>,
    cookie: String,
) -> AppResult<QqLoginResult> {
    let token = QqToken::from_cookie(&cookie).ok_or_else(|| {
        AppError::InvalidParam(
            "Cookie 格式无效，需要包含 uin / qqmusic_key / tmeLoginType".to_string(),
        )
    })?;
    let result = QqLoginResult {
        user_id: token.music_id,
        cookie: token.to_cookie(),
        login_type: token.login_type,
    };
    // 写入内存 + 持久化
    state.set_qq_token(Some(token.clone())).await;
    persist_qq_session(&app, QqSessionRecord::from_token(&token))?;
    Ok(result)
}

/// 获取当前 QQ 登录状态。
#[tauri::command]
pub async fn qq_get_auth_state(state: State<'_, AppState>) -> AppResult<QqAuthStateDto> {
    let token = state.qq_token_snapshot().await;
    Ok(QqAuthStateDto {
        logged_in: token.is_some(),
        user_id: token.as_ref().map(|t| t.music_id),
        login_method: token.as_ref().map(|_| "qq".to_string()),
        cookie: token.as_ref().map(QqToken::to_cookie),
    })
}

/// QQ 退出登录。
#[tauri::command]
pub async fn qq_logout(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.set_qq_token(None).await;
    // 清空所有活跃扫码 session（释放 MQTT 连接）
    state.qq_login_sessions.lock().await.clear();
    // 清空 auth.json 的 qq_cookie
    if let Ok(store) = app.store("auth.json") {
        store.delete("qq_cookie");
        let _ = store.save();
    }
    // 清空 TOML 持久化
    let _ = clear_qq_session_meta();
    Ok(())
}

// ============================================================
// 二维码登录（MQTT）
// ============================================================

/// QR 登录第一步：创建扫码会话。
///
/// 1. HTTP 拉 QQ 二维码 PNG（base64 data URI）
/// 2. spawn 一个 MQTT 长连接到 mu.y.qq.com，订阅 `management.qrcode_login/{qrcode_id}` 主题
/// 3. 把 MqttLoginSession 存到 AppState.qq_login_sessions，返回 session_id 给前端
#[tauri::command]
pub async fn qq_login_qr_key(state: State<'_, AppState>) -> AppResult<QqLoginQr> {
    let qr = state.qq.get_login_qrcode().await.map_err(map_qq_err)?;
    let session = MqttLoginSession::new(&qr.session_id);
    state
        .qq_login_sessions
        .lock()
        .await
        .insert(qr.session_id.clone(), session);
    Ok(qr)
}

/// QR 登录第二步：轮询扫码状态。
///
/// 复用 `qq_login_qr_key` 返回的 `session_id`，每次调用：
/// - 在 MQTT 长连接上 pull 一次事件
/// - 事件 = `Cookies` → 自动调 `login_with_mobile_ticket` 换完整 token
/// - 登录成功 → 写 AppState.qq_token + 持久化 + 从 sessions Map 移除
/// - session 过期 / 失败 → 从 sessions Map 移除
#[tauri::command]
pub async fn qq_login_qr_check(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<QqLoginCheckDto> {
    let mut session = {
        let mut map = state.qq_login_sessions.lock().await;
        map.remove(&session_id)
            .ok_or_else(|| AppError::InvalidParam(format!("QR session 已过期或不存在: {session_id}")))?
    };

    let status = state
        .qq
        .poll_qq_login(&session_id, &mut session)
        .await
        .map_err(map_qq_err)?;

    // 终止态从 sessions Map 移除（成功 / 过期 / 失败）；非终止态放回以便继续轮询
    let is_terminal = matches!(
        status.code,
        QqLoginCode::Success | QqLoginCode::QrCodeExpired | QqLoginCode::Failed
    );
    if !is_terminal {
        state.qq_login_sessions.lock().await.insert(session_id.clone(), session);
    }
    // success 状态：token 已由 poll_qq_login 通过 login_with_mobile_ticket 拿到
    let dto = match (status.code, status.token) {
        (QqLoginCode::Success, Some(token)) => {
            // 持久化 + 写入内存
            state.set_qq_token(Some(token.clone())).await;
            let record = QqSessionRecord::from_token(&token);
            persist_qq_session(&app, record)?;
            QqLoginCheckDto {
                code: "Success".to_string(),
                token: Some(TokenDto {
                    user_id: token.music_id,
                    cookie: token.to_cookie(),
                    login_type: token.login_type,
                }),
            }
        }
        (code, _) => QqLoginCheckDto {
            code: match code {
                QqLoginCode::WaitingScan => "WaitingScan".to_string(),
                QqLoginCode::WaitingConfirm => "WaitingConfirm".to_string(),
                QqLoginCode::Success => unreachable!("handled above"),
                QqLoginCode::QrCodeExpired => "QrCodeExpired".to_string(),
                QqLoginCode::Failed => "Failed".to_string(),
            },
            token: None,
        },
    };
    Ok(dto)
}

/// 调试：获取 QQ API CreateQRCode 原始响应（文本格式）。
/// 用于排查"二维码加载失败"，不走 JSON 解析，直接返回原盘响应文本。
#[tauri::command]
pub async fn qq_debug_raw_qr(state: State<'_, AppState>) -> AppResult<String> {
    let raw = state.qq.debug_raw_qr().await.map_err(map_qq_err)?;
    Ok(raw)
}

/// 读取持久化的 QQ 会话（启动时调用）。
pub fn load_qq_session_meta() -> Option<QqSessionRecord> {
    let path = qq_session_path()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    toml::from_str(&raw).ok()
}

/// 从 session 记录初始化 QqToken（用于 AppState 启动时填充）。
pub fn qq_session_to_token(record: &QqSessionRecord) -> QqToken {
    record.to_token()
}

// ============================================================
// 持久化辅助
// ============================================================

fn persist_qq_session(app: &AppHandle, record: QqSessionRecord) -> AppResult<()> {
    // 写 plugin-store
    let store = app
        .store("auth.json")
        .map_err(|e| AppError::Store(e.to_string()))?;
    let cookie = {
        let t = QqToken {
            music_id: record.user_id,
            music_key: record.music_key.clone(),
            refresh_token: record.refresh_token.clone(),
            refresh_key: record.refresh_key.clone(),
            login_type: record.login_type,
            expires_at: record.expires_at,
        };
        t.to_cookie()
    };
    store.set("qq_cookie", serde_json::Value::String(cookie));
    store
        .save()
        .map_err(|e| AppError::Store(e.to_string()))?;
    // 写 TOML（启动恢复用）
    persist_qq_session_meta(record)
}

fn persist_qq_session_meta(record: QqSessionRecord) -> AppResult<()> {
    let path = qq_session_path().ok_or_else(|| AppError::Internal("无法定位配置目录".to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let raw = toml::to_string_pretty(&record)
        .map_err(|e| AppError::Internal(format!("toml 序列化失败: {e}")))?;
    std::fs::write(&path, raw).map_err(AppError::Io)?;
    Ok(())
}

pub fn clear_qq_session_meta() -> AppResult<()> {
    let Some(path) = qq_session_path() else {
        return Ok(());
    };
    if path.is_file() {
        std::fs::remove_file(&path).map_err(AppError::Io)?;
    }
    Ok(())
}

fn qq_session_path() -> Option<PathBuf> {
    use directories::BaseDirs;
    let root = BaseDirs::new()?.config_dir().join("nnplayer");
    Some(root.join("auth").join("session_qq.toml"))
}

fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
