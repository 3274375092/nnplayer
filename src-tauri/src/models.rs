// 精简后的 DTO（Data Transfer Object）。
// 规范要求：NCM 接口字段繁杂，Rust 端仅向前端返回必要字段，降低前端解析负担。
// 所有字段与前端 types/music.d.ts 严格保持一致。

use serde::{Deserialize, Serialize};

/// 歌曲（前端统一模型）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: u64,
    pub name: String,
    pub artists: String,
    pub album: String,
    /// 毫秒
    pub duration: u64,
    /// 封面 URL
    pub pic_url: Option<String>,
}

/// 歌曲 URL（播放时使用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongUrl {
    pub id: u64,
    pub url: Option<String>,
    /// 码率（bps），如 320000 表示 320kbps
    pub bitrate: u32,
}

/// 歌单（列表项）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: u64,
    pub name: String,
    pub cover_url: String,
    pub track_count: u32,
    pub creator: Option<String>,
}

/// 歌单详情（含歌曲列表）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub playlist: Playlist,
    pub songs: Vec<Song>,
}

/// 搜索结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub songs: Vec<Song>,
    pub total: u32,
}

/// 每日推荐响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyRecommend {
    pub songs: Vec<Song>,
    pub date: String,
}

/// 搜索建议单条结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    /// 建议关键词
    pub keyword: String,
    /// 命中歌曲（可能为空，NCM 接口字段为 order / songs，前端只关心 songs）
    pub song: Option<Song>,
}

/// 歌词响应（仅返回精简字段，避免大 JSON 整坨返回前端）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricResult {
    /// 原文 LRC
    pub lrc: Option<String>,
    /// 翻译 LRC（若存在）
    pub t_lrc: Option<String>,
    /// YRC 逐字歌词（若存在）
    pub y_lrc: Option<String>,
}