// 桌面歌词窗口几何信息校验命令。
//
// is_position_on_screen：在恢复持久化位置前检查 (x, y) 是否仍在某个
// 可用显示器范围内，避免拔掉副屏后窗口"消失"。

use tauri::Manager;

/// 检查 (x, y) 是否位于任一当前可用显示器范围内。
/// 用于桌面歌词窗口恢复持久化位置前做边界校验。
/// 失败时保守返回 true（不阻止窗口创建，主窗会居中兜底）。
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
