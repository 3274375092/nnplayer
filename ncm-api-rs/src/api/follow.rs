use super::Query;
use crate::error::{NcmError, Result};
/// 关注/取消关注用户
/// 对应 Node.js module/follow.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 关注/取消关注用户
    /// 对应 /follow
    pub async fn follow(&self, query: &Query) -> Result<ApiResponse> {
        let t = query.get_or("t", "1");
        let path = if t == "1" { "follow" } else { "delfollow" };
        let id: i64 = query
            .get("id")
            .ok_or_else(|| NcmError::InvalidParam("id is required".into()))?
            .parse()
            .map_err(|_| NcmError::InvalidParam("id must be numeric".into()))?;
        let data = json!({});
        self.request(
            &format!("/api/user/{}/{}", path, id),
            data,
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}
