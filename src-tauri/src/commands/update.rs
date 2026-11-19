//! 为更新检查和后续下载创建同一个直连资源；签名验证、安装仍由 updater 插件负责。

use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

/// JS `Update` 构造器需要的元数据；rid 仅在发起检查的 WebView 中有效。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    date: Option<String>,
    raw_json: serde_json::Value,
}

/// AboutDialog 主动检查时才联网；无更新不分配资源，已分配的资源由前端 close。
#[tauri::command]
pub async fn check_update(webview: Webview) -> Result<Option<UpdateMetadata>, String> {
    let updater = webview
        .updater_builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| err.to_string())?;
    let Some(update) = updater.check().await.map_err(|err| err.to_string())? else {
        return Ok(None);
    };
    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        date: update.raw_json["pub_date"].as_str().map(String::from),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}
