use super::Query;
use crate::error::{NcmError, Result};
/// 歌单所有歌曲
/// 对应 Node.js module/playlist_track_all.js
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 歌单所有歌曲（两步请求：先获取 trackIds，再获取歌曲详情）
    /// 对应 /playlist/track/all
    pub async fn playlist_track_all(&self, query: &Query) -> Result<ApiResponse> {
        let id = query
            .get("id")
            .filter(|v| !v.is_empty())
            .ok_or_else(|| NcmError::InvalidParam("id is required".into()))?;
        // 上游是 parseInt(...) || 默认值 的容错语义：非法/空值回退默认值、
        // 负数按 0 处理（上游会落到 JS slice 的负索引，这里取更可预期的钳位）。
        let limit = query.get_i64("limit", 1000).max(0);
        let offset = query.get_i64("offset", 0).max(0);

        // Step 1: 获取歌单详情（含 trackIds）
        let data1 = json!({
            "id": id,
            "n": 100000,
            "s": query.get_i64("s", 8)
        });
        let res = self
            .request(
                "/api/v6/playlist/detail",
                data1,
                query.to_option(CryptoType::Eapi),
            )
            .await?;

        // Step 2: 从 trackIds 中截取分页范围
        if let Some(track_ids) = res.body["playlist"]["trackIds"].as_array() {
            let start = (offset as usize).min(track_ids.len());
            let end = start.saturating_add(limit as usize).min(track_ids.len());
            let sliced = &track_ids[start..end];

            let c: Vec<String> = sliced
                .iter()
                .filter_map(|t| t["id"].as_i64())
                .map(|id| format!(r#"{{"id":{}}}"#, id))
                .collect();

            let data2 = json!({
                "c": format!("[{}]", c.join(","))
            });
            self.request(
                "/api/v3/song/detail",
                data2,
                query.to_option(CryptoType::Eapi),
            )
            .await
        } else {
            // 没有 trackIds 说明上游返回了业务错误或结构变了，
            // 直接返回原始响应会让调用方误以为请求成功。
            Err(NcmError::Unknown(
                "playlist detail response is missing the 'playlist.trackIds' array".to_string(),
            ))
        }
    }
}
