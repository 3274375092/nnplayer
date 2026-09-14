use super::Query;
use crate::error::Result;
/// 数字专辑详情
/// 对应 Node.js module/album_detail.js（与 digitalAlbum_detail.js 内容一致）
use crate::request::{ApiClient, ApiResponse, CryptoType};
use serde_json::json;

impl ApiClient {
    /// 数字专辑详情
    /// 对应 /album/detail
    pub async fn album_detail(&self, query: &Query) -> Result<ApiResponse> {
        let data = json!({
            "id": query.get_or("id", "0")
        });
        self.request(
            // 上游 module/album_detail.js 打的就是 vipmall 数字专辑接口；
            // /api/v1/album/{id} 属于 module/album.js（已由 album.rs 移植）
            "/api/vipmall/albumproduct/detail",
            data,
            query.to_option(CryptoType::Weapi),
        )
        .await
    }
}
