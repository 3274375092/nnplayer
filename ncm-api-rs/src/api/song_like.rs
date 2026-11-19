use super::Query;
use crate::error::Result;
/// 喜欢歌曲
/// 对应 Node.js module/song_like.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 喜欢歌曲
    /// 对应 /song/like
    pub async fn song_like(&self, query: &Query) -> Result<ApiResponse> {
        self.request(
            "/api/song/like",
            request_body(query),
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}

fn request_body(query: &Query) -> serde_json::Value {
    json!({
        "trackId": query.get_or("id", ""),
        "userid": query.get_or("uid", ""),
        "like": query.get_bool("like", true)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn like_flag_in_request_body() {
        for (flag, expected) in [
            (None, true),
            (Some("0"), false),
            (Some("false"), false),
            (Some("1"), true),
            (Some("true"), true),
        ] {
            let query = flag.map_or_else(Query::new, |v| Query::new().param("like", v));
            assert_eq!(request_body(&query)["like"], expected);
        }
    }
}
