use super::Query;
use crate::error::{NcmError, Result};
/// 通用 API 代理接口
/// 对应 Node.js module/api.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 通用 API 代理接口，允许调用任意 API 路径
    /// 对应 /api
    pub async fn api(&self, query: &Query) -> Result<ApiResponse> {
        let uri = query.get_or("uri", "");
        let data_str = query.get_or("data", "{}");
        if uri.trim().is_empty() || !uri.starts_with('/') {
            return Err(NcmError::InvalidParam("uri must start with /".into()));
        }
        let data: serde_json::Value = if data_str.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&data_str)?
        };
        let crypto_str = query.get_or("crypto", "");
        let crypto = CryptoType::from(crypto_str.as_ref());
        self.request(&uri, data, query.to_option(crypto)).await
    }
}
