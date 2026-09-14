use super::Query;
use crate::error::{NcmError, Result};
/// 邮箱登录
/// 对应 Node.js module/login.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use md5::{Digest, Md5};
use serde_json::json;

impl ApiClient {
    /// 邮箱登录
    /// 对应 /login
    ///
    /// 注意: `password` 传原始密码（本方法内部做 MD5），
    /// `md5_password` 传已 MD5 的 32 位十六进制串（原样使用）。
    pub async fn login(&self, query: &Query) -> Result<ApiResponse> {
        let password = if let Some(md5_pw) = query.get("md5_password") {
            // 非 32 位十六进制说明调用方漏做/做错了 MD5，直接失败比发出坏凭据更清楚
            if md5_pw.len() != 32 || !md5_pw.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(NcmError::InvalidParam(
                    "md5_password must be 32 hex characters".to_string(),
                ));
            }
            md5_pw.to_string()
        } else {
            let pw = query.get("password").ok_or_else(|| {
                NcmError::InvalidParam("password or md5_password is required".to_string())
            })?;
            hex::encode(Md5::digest(pw.as_bytes()))
        };
        let data = json!({
            "type": "0",
            "https": "true",
            "username": query.get("email").unwrap_or(""),
            "password": password,
            "rememberLogin": "true"
        });
        let mut result = self
            .request("/api/w/login", data, query.to_option(CryptoType::Eapi))
            .await?;
        // 与上游 module/login.js 保持一致：502 仍然返回 status=200，
        // 业务失败由 body.code=502 表达（调用方通过 response_code 判定）。
        if result.body.get("code").and_then(|v| v.as_i64()) == Some(502) {
            result.status = 200;
            result.body = json!({
                "msg": "账号或密码错误",
                "code": 502,
                "message": "账号或密码错误"
            });
        }
        Ok(result)
    }
}
