use super::Query;
use crate::error::{NcmError, Result};
/// 编辑歌单
/// 对应 Node.js module/playlist_update.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 编辑歌单（批量更新名称、描述、标签）
    /// 对应 /playlist/update
    pub async fn playlist_update(&self, query: &Query) -> Result<ApiResponse> {
        let id: i64 = query
            .get("id")
            .ok_or_else(|| NcmError::InvalidParam("id is required".into()))?
            .parse()
            .map_err(|_| NcmError::InvalidParam("id must be numeric".into()))?;
        let name = query.get_or("name", "");
        let desc = query.get_or("desc", "");
        let tags = query.get_or("tags", "");
        let data = json!({
            "/api/playlist/desc/update": serde_json::to_string(&json!({"id": id, "desc": desc}))?,
            "/api/playlist/tags/update": serde_json::to_string(&json!({"id": id, "tags": tags}))?,
            "/api/playlist/update/name": serde_json::to_string(&json!({"id": id, "name": name}))?
        });
        self.request("/api/batch", data, query.to_option(CryptoType::Eapi))
            .await
    }
}
