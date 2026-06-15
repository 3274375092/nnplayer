// Tauri 应用主入口。
// 职责：
//   1. 初始化日志
//   2. 启动时尝试读取 session.toml → 调 login_status 校验有效性 → 写入内存
//   3. 注册插件 + 全局状态 + 命令处理器
//   4. 阶段5：托盘菜单 / 全局快捷键 / 窗口状态持久化
// 业务代码一律拆分到 commands/* 子模块，本文件保持极简。

mod commands;
mod error;
mod models;
mod state;

use state::AppState;
use tauri::Emitter;
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

    // 启动前先读取持久化的 session，准备初始 cookie 和 AuthState
    let record = commands::load_session_meta();
    let initial_cookie = record.as_ref().map(|r| r.cookie.clone());
    let initial_auth = record.as_ref().map(commands::session_to_auth).unwrap_or_default();
    let initial_app_state = AppState::new(initial_cookie, initial_auth)
        .expect("创建 AppState 失败");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // 阶段5：桌面集成插件
        // - tray 内置在 tauri 主 crate 中（无需独立 plugin crate）
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 全局状态
        .manage(initial_app_state)
        .setup(|app| {
            // 应用启动时异步校验 session 有效性
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                restore_session(&app_handle).await;
            });

            // 阶段5：托盘 + 全局快捷键
            if let Err(e) = build_tray(app.handle()) {
                log::warn!("[startup] 创建托盘失败: {e}");
            }
            if let Err(e) = register_global_shortcuts(app.handle()) {
                log::warn!("[startup] 注册全局快捷键失败: {e}");
            }

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
            // 优先用 login_status 响应的最新 avatarUrl,失败回落 session.toml 的旧值
            let avatar_url = resp
                .body
                .pointer("/data/profile/avatarUrl")
                .or_else(|| resp.body.pointer("/profile/avatarUrl"))
                .and_then(|v| v.as_str())
                .and_then(commands::auth::normalize_avatar_url)
                .or_else(|| record.avatar_url.clone());

            drop(api);
            let mut auth = state.auth.lock().await;
            auth.user_id = Some(uid);
            auth.nickname = Some(nick);
            auth.cookie = Some(record.cookie.clone());
            auth.login_method = Some(record.login_method.clone());
            auth.avatar_url = avatar_url;
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

// =============== 阶段5：托盘 + 全局快捷键 ===============
//
// 这里没有新 command，但需要：
// 1. 创建系统托盘（菜单：播放/暂停、上一首、下一首、桌面歌词、退出）
// 2. 注册 4 个全局快捷键
// 3. 通过 app.emit("player:toggle" / ...) 通知前端执行
//
// 为什么在前端 listen 而不是在 Rust 直接操作 audio？
// - 播放状态/队列在 Pinia store 中，前端是 single source of truth
// - Rust emit 是单向信号，UI 与 store 同步由 Vue 负责
// - 若 Rust 端持有 audio 状态会引入双份状态同步问题

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// 构建系统托盘。失败不阻塞主流程，仅日志记录。
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(app, "toggle", "播放/暂停", true, None::<&str>)?;
    let prev_item = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let lyrics_item = MenuItem::with_id(app, "lyrics", "显示/隐藏桌面歌词", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&toggle_item, &prev_item, &next_item, &lyrics_item, &separator, &quit_item],
    )?;

    let _tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "toggle" => {
                    let _ = app.emit("player:toggle", ());
                }
                "prev" => {
                    let _ = app.emit("player:prev", ());
                }
                "next" => {
                    let _ = app.emit("player:next", ());
                }
                "lyrics" => {
                    let _ = app.emit("desktop-lyrics:toggle", ());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // 单击托盘：显示/隐藏主窗口
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// 注册 4 个全局快捷键。
/// 全部 emit 到前端，由前端在 store / composable 中处理。
fn register_global_shortcuts(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::Builder as ShortcutBuilder;
    // Shortcut::new 直接返回 Shortcut，不返回 Result
    let shortcuts: Vec<Shortcut> = vec![
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::ArrowLeft),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::ArrowRight),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyL),
    ];
    let plugin = ShortcutBuilder::new()
        .with_shortcuts(shortcuts)
        .map_err(|e| tauri::Error::Anyhow(anyhow::Error::new(e)))?
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let id = format!("{:?}", shortcut.key);
            let emit_name = match id.as_str() {
                "KeyP" => "player:toggle",
                "ArrowLeft" => "player:prev",
                "ArrowRight" => "player:next",
                "KeyL" => "desktop-lyrics:toggle",
                _ => return,
            };
            let _ = app.emit(emit_name, ());
        })
        .build();
    let _ = app.plugin(plugin);
    Ok(())
}