use super::Query;
use crate::error::Result;
/// 绑定手机号码
/// 对应 Node.js module/user_bindingcellphone.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use md5::{Digest, Md5};
use serde_json::json;

impl ApiClient {
    /// 绑定手机号码
    /// 对应 /user/bindingcellphone
    ///
    /// 注意: 与 Node.js 版本一致，这里对传入的 `password` 原文做 MD5，
    /// 调用方应传原始密码，而不是已经 MD5 过的串。
    pub async fn user_bindingcellphone(&self, query: &Query) -> Result<ApiResponse> {
        let password = if let Some(pw) = query.get("password") {
            if !pw.is_empty() {
                hex::encode(Md5::digest(pw.as_bytes()))
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        let data = json!({
            "phone": query.get("phone").unwrap_or(""),
            "countrycode": query.get_or("countrycode", "86"),
            "captcha": query.get("captcha").unwrap_or(""),
            "password": password
        });
        self.request(
            "/api/user/bindingCellphone",
            data,
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}
