use super::Query;
use crate::error::Result;
/// 更新用户资料
/// 对应 Node.js module/user_update.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 更新用户资料
    /// 对应 /user/update
    pub async fn user_update(&self, query: &Query) -> Result<ApiResponse> {
        // 上游只会提交调用方实际传入的字段（JSON.stringify 丢弃 undefined）；
        // 这里若用 "" 兜底会清空服务端已有的资料。
        let mut data = serde_json::Map::new();
        for key in [
            "birthday",
            "city",
            "gender",
            "nickname",
            "province",
            "signature",
        ] {
            if let Some(value) = query.get(key) {
                data.insert(key.to_string(), json!(value));
            }
        }
        let data = serde_json::Value::Object(data);
        self.request(
            "/api/user/profile/update",
            data,
            query.to_option(CryptoType::Eapi),
        )
        .await
    }
}
