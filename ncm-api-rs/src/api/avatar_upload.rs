use super::Query;
use crate::error::Result;
/// 上传头像
/// 对应 Node.js module/avatar_upload.js + plugins/upload.js
///
/// 注意: 此端点需要调用者提供图片文件的二进制数据。
/// 由于 Rust SDK 是纯库，文件读取由调用者负责。
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 上传头像图片
    ///
    /// query 参数:
    /// - `img_data`: 不通过 Query 传递，由专用参数传入
    /// - `img_name`: 图片文件名
    /// - `img_mimetype`: 图片 MIME 类型，默认 "image/jpeg"
    ///
    /// 此方法包含两步:
    /// 1. 申请 NOS 上传 token
    /// 2. 上传文件到 NOS
    /// 3. 调用头像更新接口
    pub async fn avatar_upload(&self, query: &Query, img_data: Vec<u8>) -> Result<ApiResponse> {
        let img_name = query.get_or("img_name", "avatar.jpg");
        let img_mimetype = query.get_or("img_mimetype", "image/jpeg");

        // Step 1: 申请上传 token
        let token_data = json!({
            "bucket": "yyimgs",
            "ext": "jpg",
            "filename": img_name,
            "local": false,
            "nos_product": 0,
            "return_body": "{\"code\":200,\"size\":\"$(ObjectSize)\"}",
            "type": "other"
        });

        let token_res = self
            .request(
                "/api/nos/token/alloc",
                token_data,
                query.to_option(CryptoType::Weapi),
            )
            .await?;

        let result = &token_res.body["result"];
        let object_key = result["objectKey"].as_str().unwrap_or_default();
        let token = result["token"].as_str().unwrap_or_default();
        let doc_id = result["docId"].clone();

        // token 申请失败时必须立即报错，否则会用空 token 上传并注册空 imgid
        if object_key.is_empty() || token.is_empty() || doc_id.is_null() {
            return Err(crate::error::NcmError::InvalidParam(
                "NOS token alloc failed: missing objectKey/token/docId".to_string(),
            ));
        }

        // Step 2: 上传文件到 NOS
        let upload_url = format!(
            "https://nosup-hz1.127.net/yyimgs/{}?offset=0&complete=true&version=1.0",
            object_key
        );

        let upload_res = self
            .client
            .post(&upload_url)
            .header("x-nos-token", token)
            .header("Content-Type", img_mimetype.as_ref())
            .body(img_data)
            .send()
            .await
            .map_err(crate::error::NcmError::Http)?;

        // reqwest 只在传输层失败时返回 Err，NOS 返回的 4xx/5xx 必须显式检查
        if !upload_res.status().is_success() {
            return Err(crate::error::NcmError::Unknown(format!(
                "NOS upload failed with HTTP status {}",
                upload_res.status()
            )));
        }

        // Step 3: 更新头像
        let update_data = json!({
            "imgid": doc_id
        });

        let update_res = self
            .request(
                "/api/user/avatar/upload/v1",
                update_data,
                query.to_option(CryptoType::Eapi),
            )
            .await?;

        // 合并结果
        let url_pre = format!("https://p1.music.126.net/{}", object_key);
        let mut body = update_res.body.clone();
        if let Some(obj) = body.as_object_mut() {
            obj.insert("url_pre".to_string(), json!(url_pre));
            obj.insert("imgId".to_string(), doc_id);
        }

        Ok(ApiResponse {
            status: 200,
            body,
            cookie: update_res.cookie,
        })
    }
}
