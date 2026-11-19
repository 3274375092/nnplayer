use super::Query;
use crate::error::Result;
/// 声音列表搜索
/// 对应 Node.js module/voicelist_search.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 声音列表搜索
    /// 对应 /voicelist/search
    pub async fn voicelist_search(&self, query: &Query) -> Result<ApiResponse> {
        self.request(
            "/api/search/voicelist/get",
            request_body(query),
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}

fn request_body(query: &Query) -> serde_json::Value {
    json!({
        "keyword": query.get("keyword").or_else(|| query.get("podcastName")).unwrap_or(""),
        "scene": "normal",
        "limit": query.get_or("limit", "10"),
        "offset": query.get_or("offset", "0"),
        "e_r": true
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_keyword_and_first_page_remain_compatible() {
        let query = Query::new().param("podcastName", "legacy");
        assert_eq!(request_body(&query)["keyword"], "legacy");
        assert_eq!(request_body(&query)["offset"], "0");
        let query = query.param("keyword", "new").param("offset", "20");
        assert_eq!(request_body(&query)["keyword"], "new");
        assert_eq!(request_body(&query)["offset"], "20");
    }
}
