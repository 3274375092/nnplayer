mod commands;
mod error;
mod models;
mod state;

use state::AppState;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    let session = commands::load_session_meta();
    // 持久化会话在远端校验成功前绝不能暴露为“已登录”。
    let initial_app_state = AppState::new(None, Default::default()).expect("创建 AppState 失败");

    let mut builder = tauri::Builder::default();

    builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if window.label() == "main" {
                api.prevent_close();
                let _ = window.hide();
            }
        }
    });

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["desktop-lyrics"])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(initial_app_state.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = initial_app_state.clone();
            tauri::async_runtime::spawn(async move {
                restore_session(&app_handle, &state, session).await;
                state.mark_restore_complete();
            });

            if let Err(e) = build_tray(app.handle()) {
                log::warn!("[startup] 创建托盘失败: {e}");
            }
            if let Err(e) = register_global_shortcuts(app.handle()) {
                log::warn!("[startup] 注册全局快捷键失败: {e}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::login_qr_key,
            commands::auth::login_qr_check,
            commands::auth::login_with_account,
            commands::auth::login_send_captcha,
            commands::auth::login_with_captcha,
            commands::auth::save_cookie,
            commands::auth::get_auth_state,
            commands::auth::logout,
            commands::music::search_songs,
            commands::music::search_suggest,
            commands::music::get_daily_recommend,
            commands::music::get_song_url,
            commands::user::get_user_playlists,
            commands::user::get_playlist_detail,
            commands::lyric::get_lyric,
            commands::window_geom::is_position_on_screen,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

async fn restore_session(
    app: &tauri::AppHandle,
    state: &AppState,
    session: Option<commands::auth::SessionRecord>,
) {
    let Some(record) = session else {
        log::info!("[startup] 没有持久化的会话，跳过恢复");
        return;
    };

    if record.cookie.trim().is_empty() {
        log::info!("[startup] cookie 为空，跳过恢复");
        return;
    }

    state.api.write().await.set_cookie(record.cookie.clone());

    let api = state.api.read().await;
    match api
        .login_status(&ncm_api::Query::new().cookie(&record.cookie))
        .await
    {
        Ok(resp) => {
            let uid = resp
                .body
                .pointer("/data/account/id")
                .or_else(|| resp.body.pointer("/account/id"))
                .and_then(|v| v.as_u64())
                .filter(|id| *id > 0);
            let Some(uid) = uid else {
                log::warn!("[startup] login_status 未返回有效账户，会话已失效");
                drop(api);
                clear_invalid_session(app, state).await;
                return;
            };
            let nick = resp
                .body
                .pointer("/data/profile/nickname")
                .or_else(|| resp.body.pointer("/profile/nickname"))
                .and_then(|v| v.as_str())
                .unwrap_or(&record.nickname)
                .to_string();
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
            log::info!(
                "[startup] 会话恢复成功: user_id={uid}, method={}",
                record.login_method
            );
        }
        Err(e) => {
            log::warn!("[startup] 会话已失效，清空: {e}");
            drop(api);
            clear_invalid_session(app, state).await;
        }
    }
}

async fn clear_invalid_session(app: &tauri::AppHandle, state: &AppState) {
    state.api.write().await.set_cookie(String::new());
    *state.auth.lock().await = Default::default();
    let _ = commands::clear_session_meta();
    if let Ok(store) = app.store("auth.json") {
        store.delete("cookie");
        let _ = store.save();
    }
}

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(app, "toggle", "播放/暂停", true, None::<&str>)?;
    let prev_item = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let lyrics_item = MenuItem::with_id(app, "lyrics", "显示/隐藏桌面歌词", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &prev_item,
            &next_item,
            &lyrics_item,
            &separator,
            &quit_item,
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|e| tauri::Error::Anyhow(anyhow::Error::new(e)))?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
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
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
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

fn register_global_shortcuts(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::Builder as ShortcutBuilder;
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
