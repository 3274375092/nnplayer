use super::Query;
use crate::error::{NcmError, Result};
/// 收藏/取消收藏歌单
/// 对应 Node.js module/playlist_subscribe.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 收藏/取消收藏歌单
    /// 对应 /playlist/subscribe
    pub async fn playlist_subscribe(&self, query: &Query) -> Result<ApiResponse> {
        let t = query.get_or("t", "1");
        let path = match t.as_ref() {
            "1" => "subscribe",
            "0" => "unsubscribe",
            _ => return Err(NcmError::InvalidParam("t must be 0 or 1".into())),
        };
        let id: i64 = query
            .get("id")
            .ok_or_else(|| NcmError::InvalidParam("id is required".into()))?
            .parse()
            .map_err(|_| NcmError::InvalidParam("id must be numeric".into()))?;
        let data = json!({ "id": id });
        self.request(
            &format!("/api/playlist/{}", path),
            data,
            // 上游 module/playlist_subscribe.js 显式传 'weapi'（其余 playlist_* 走默认 eapi）
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}
