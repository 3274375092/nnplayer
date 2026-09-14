use super::Query;
use crate::error::Result;
/// 发送/删除/回复评论
/// 对应 Node.js module/comment.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 发送/删除/回复评论
    /// 对应 /comment
    /// t: 1=发送, 0=删除, 2=回复
    pub async fn comment(&self, query: &Query) -> Result<ApiResponse> {
        // 上游对 t 没有默认值：缺参数应当是失败，而不是悄悄走"发布评论"写路径
        let t = query
            .get("t")
            .ok_or_else(|| crate::error::NcmError::InvalidParam("t is required".into()))?;
        let action = match t {
            "1" => "add",
            "0" => "delete",
            "2" => "reply",
            other => {
                // 未知取值不能回落成写操作，否则一个拼写错误就会真的发出评论
                return Err(crate::error::NcmError::InvalidParam(format!(
                    "invalid comment action t={other}, expected 0 (delete), 1 (add) or 2 (reply)"
                )));
            }
        };
        let resource_type = query.get_or("type", "0");
        let thread_id = crate::util::config::RESOURCE_TYPE_MAP
            .get(resource_type.as_ref())
            .map(|prefix| format!("{}{}", prefix, query.get_or("id", "0")))
            .unwrap_or_default();
        let mut data = json!({
            "threadId": thread_id
        });
        match action {
            "add" => {
                data["content"] = json!(query.get_or("content", ""));
            }
            "delete" => {
                data["commentId"] = json!(query.get_or("commentId", "0"));
            }
            "reply" => {
                data["commentId"] = json!(query.get_or("commentId", "0"));
                data["content"] = json!(query.get_or("content", ""));
            }
            _ => {}
        }
        self.request(
            &format!("/api/resource/comments/{}", action),
            data,
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}
