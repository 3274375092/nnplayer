use super::Query;
use crate::error::Result;
/// 广播电台 - 收藏/取消收藏电台
/// 对应 Node.js module/broadcast_sub.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 广播电台 - 收藏/取消收藏电台
    /// 对应 /broadcast/sub
    pub async fn broadcast_sub(&self, query: &Query) -> Result<ApiResponse> {
        // cancelCollect 是布尔字段，字符串 "true"/"false" 会被服务端当作真值处理
        let cancel_collect = query.get_or("t", "0") != "1";
        let data = json!({
            "contentType": "BROADCAST",
            "contentId": query.get_or("id", ""),
            "cancelCollect": cancel_collect
        });
        self.request(
            "/api/content/interact/collect",
            data,
            query.to_option(CryptoType::Eapi),
        )
        .await
    }
}
