use super::Query;
use crate::error::Result;
/// 关注歌手新 MV
/// 对应 Node.js module/artist_new_mv.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 关注歌手新 MV
    /// 对应 /artist/new/mv
    pub async fn artist_new_mv(&self, query: &Query) -> Result<ApiResponse> {
        // get_or 的缺省值是临时 String，借用不能逃逸语句，这里需要 owned
        let before = query
            .get_or("before", &chrono::Utc::now().timestamp_millis().to_string())
            .into_owned();
        let data = json!({
            "limit": query.get_or("limit", "20"),
            "startTimestamp": before
        });
        self.request(
            "/api/sub/artist/new/works/mv/list",
            data,
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}
