//! 窗口几何工具：校验恢复的窗口位置是否仍落在可见屏幕范围内。

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;

/// 判断坐标是否落在任一显示器范围内（窗口位置恢复前校验；
/// 拿不到显示器信息时保守返回 true）。
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
        x >= pos.x && y >= pos.y && x < pos.x + size.width as i32 && y < pos.y + size.height as i32
    })
}

/// 移动端无多显示器概念，恒返回 true。
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn is_position_on_screen(_app: tauri::AppHandle, _x: i32, _y: i32) -> bool {
    true
}
