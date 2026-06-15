// Tauri 应用主入口。
// 职责：
//   1. 初始化日志
//   2. 启动时尝试读取 session.toml → 调 login_status 校验有效性 → 写入内存
//   3. 注册插件 + 全局状态 + 命令处理器
// 业务代码一律拆分到 commands/* 子模块，本文件保持极简。

mod commands;
mod error;
mod models;
mod state;

use state::AppState;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 安装 rustls crypto provider（reqwest 用 rustls-no-provider 时必须手动安装）
    // 我们 Cargo.toml 里把 reqwest 关掉了 default crypto（避免拉入 openssl），
    // 改用 rustls + ring 纯 Rust 实现，需要在首次构造 Client 前显式 install。
    // 见 https://docs.rs/rustls/latest/rustls/#cryptography-providers
    let _ = rustls::crypto::ring::default_provider().install_default();

    // 初始化日志
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    // 启动前先读取持久化的 session，准备初始 cookie
    let initial_cookie = commands::load_session_meta().map(|r| r.cookie);
    let initial_app_state = AppState::new(initial_cookie)
        .expect("创建 AppState 失败");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // 全局状态
        .manage(initial_app_state)
        .setup(|app| {
            // 应用启动时异步校验 session 有效性
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                restore_session(&app_handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // === 认证 & 三种登录方式 ===
            // 注意：必须用 commands::auth::xxx 全路径，
            // 不能用 commands::xxx 通过 pub use 转发。
            // 因为 tauri::command 宏在原模块下生成的 __cmd__xxx helper
            // 不会随 pub use 重新导出，generate_handler 找不到会报 E0433。
            commands::auth::login_qr_key,
            commands::auth::login_qr_check,
            commands::auth::login_with_account,
            commands::auth::login_send_captcha,
            commands::auth::login_with_captcha,
            commands::auth::save_cookie,
            commands::auth::get_auth_state,
            commands::auth::logout,
            // === 业务接口 ===
            commands::music::search_songs,
            commands::music::search_suggest,
            commands::music::get_daily_recommend,
            commands::music::get_song_url,
            commands::user::get_user_playlists,
            commands::user::get_playlist_detail,
            // === 歌词 ===
            commands::lyric::get_lyric,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

/// 启动时自动恢复上一次会话：
///   1. 读取 session.toml（已在 AppState::new 中预读 cookie 到 ApiClient）
///   2. 调用 ncm_api::login_status 验证
///   3. 成功 → 把 user_id / nickname 写入 AuthState
///   4. 失败 → 清理持久化 + 清空内存 cookie
async fn restore_session(app: &tauri::AppHandle) {
    let state: tauri::State<AppState> = app.state();

    let Some(record) = commands::load_session_meta() else {
        log::info!("[startup] 没有持久化的会话，跳过恢复");
        return;
    };

    if record.cookie.trim().is_empty() {
        log::info!("[startup] cookie 为空，跳过恢复");
        return;
    }

    // 注入 cookie 到 ApiClient
    state.api.lock().await.set_cookie(record.cookie.clone());

    // 调 login_status 验证
    let api = state.api.lock().await;
    match api
        .login_status(&ncm_api::Query::new().cookie(&record.cookie))
        .await
    {
        Ok(resp) => {
            // 响应 body.data.account.id / profile.nickname
            let uid = resp
                .body
                .pointer("/data/account/id")
                .or_else(|| resp.body.pointer("/account/id"))
                .and_then(|v| v.as_u64())
                .unwrap_or(record.user_id);
            let nick = resp
                .body
                .pointer("/data/profile/nickname")
                .or_else(|| resp.body.pointer("/profile/nickname"))
                .and_then(|v| v.as_str())
                .unwrap_or(&record.nickname)
                .to_string();

            drop(api);
            let mut auth = state.auth.lock().await;
            auth.user_id = Some(uid);
            auth.nickname = Some(nick);
            auth.cookie = Some(record.cookie.clone());
            auth.login_method = Some(record.login_method.clone());
            log::info!("[startup] 会话恢复成功: user_id={uid}, method={}", record.login_method);
        }
        Err(e) => {
            log::warn!("[startup] 会话已失效，清空: {e}");
            drop(api);
            // 清空内存
            state.api.lock().await.set_cookie(String::new());
            *state.auth.lock().await = Default::default();
            // 清空持久化
            let _ = commands::clear_session_meta();
            if let Ok(store) = app.store("auth.json") {
                store.delete("cookie");
                let _ = store.save();
            }
        }
    }
}