#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn is_position_on_screen(app: tauri::AppHandle, x: i32, y: i32) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return true;
    };
    let monitors = match main.available_monitors() {
        Ok(m) => m,
        Err(_) => return true,
    };
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        x >= pos.x
            && y >= pos.y
            && x < pos.x + size.width as i32
            && y < pos.y + size.height as i32
    })
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn is_position_on_screen(_app: tauri::AppHandle, _x: i32, _y: i32) -> bool {
    true
}
