use super::Query;
use crate::error::Result;
/// 歌曲是否喜爱
/// 对应 Node.js module/song_like_check.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 歌曲是否喜爱
    /// 对应 /song/like/check
    pub async fn song_like_check(&self, query: &Query) -> Result<ApiResponse> {
        // 与上游 module/song_like_check.js 一致：trackIds 直接透传 ids 原文
        let data = json!({
            "trackIds": query.get_or("ids", ""),
        });
        self.request(
            "/api/song/like/check",
            data,
            query.to_option(CryptoType::Eapi),
        )
        .await
    }
}
