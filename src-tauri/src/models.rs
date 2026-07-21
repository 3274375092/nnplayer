// 精简后的 DTO（Data Transfer Object）。
// 规范要求：NCM 接口字段繁杂，Rust 端仅向前端返回必要字段，降低前端解析负担。
// 所有字段与前端 types/music.d.ts 严格保持一致。

use serde::Serialize;

/// 歌曲（前端统一模型）。
#[derive(Debug, Clone, Serialize)]
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
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongUrl {
    pub id: u64,
    pub url: Option<String>,
    /// 码率（bps），如 320000 表示 320kbps
    pub bitrate: u32,
}

/// 歌单（列表项）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: u64,
    pub name: String,
    pub cover_url: String,
    pub track_count: u32,
    pub creator: Option<String>,
}

/// 歌单详情（含歌曲列表）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub playlist: Playlist,
    pub songs: Vec<Song>,
}

/// 搜索结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub songs: Vec<Song>,
    pub total: u32,
}

/// 每日推荐响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyRecommend {
    pub songs: Vec<Song>,
    pub date: String,
}

/// 搜索建议单条结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    /// 建议关键词
    pub keyword: String,
    /// 命中歌曲（可能为空）
    pub song: Option<Song>,
}

/// 歌词响应（仅返回精简字段）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricResult {
    /// 原文 LRC
    pub lrc: Option<String>,
    /// 翻译 LRC（若存在）
    pub t_lrc: Option<String>,
    /// YRC 逐字歌词（若存在）
    pub y_lrc: Option<String>,
}

// =============== 共享解析函数 ===============

fn join_artists(arr: &[serde_json::Value]) -> String {
    arr.iter()
        .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
        .collect::<Vec<_>>()
        .join(" / ")
}

/// 从 NCM JSON value 中提取歌曲字段，构造 Song。
/// duration 字段名不同接口不同：/search 用 `duration`，其他用 `dt`
pub fn parse_ncm_song(val: &serde_json::Value, duration_field: &str) -> Option<Song> {
    let id = val.get("id")?.as_u64()?;
    let name = val.get("name")?.as_str()?.to_string();
    let artists = val
        .pointer("/ar")
        .and_then(|v| v.as_array())
        .map(|a| join_artists(a))
        .unwrap_or_default();
    let album = val
        .pointer("/al/name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let duration = val
        .get(duration_field)
        .or_else(|| val.get("dt"))
        .or_else(|| val.get("duration"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let pic_url = val
        .pointer("/al/picUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(Song {
        id,
        name,
        artists,
        album,
        duration,
        pic_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_ncm_song_basic() {
        let val = json!({
            "id": 12345,
            "name": "晴天",
            "ar": [{"name": "周杰伦"}],
            "al": {"name": "叶惠美", "picUrl": "https://example.com/cover.jpg"},
            "dt": 269000
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.id, 12345);
        assert_eq!(song.name, "晴天");
        assert_eq!(song.artists, "周杰伦");
        assert_eq!(song.album, "叶惠美");
        assert_eq!(song.duration, 269000);
        assert_eq!(song.pic_url.as_deref(), Some("https://example.com/cover.jpg"));
    }

    #[test]
    fn parse_ncm_song_uses_duration_field_from_search() {
        let val = json!({
            "id": 1,
            "name": "Song",
            "ar": [{"name": "Artist"}],
            "al": {"name": "Album"},
            "duration": 180000
        });
        let song = parse_ncm_song(&val, "duration").expect("should parse");
        assert_eq!(song.duration, 180000);
    }

    #[test]
    fn parse_ncm_song_falls_back_to_dt_when_named_field_missing() {
        let val = json!({
            "id": 999,
            "name": "Missing",
            "ar": [],
            "al": {},
            "dt": 200000
        });
        // duration_field "nonexist" won't match; fallback to dt.
        let song = parse_ncm_song(&val, "nonexist").expect("should parse");
        assert_eq!(song.duration, 200000);
    }

    #[test]
    fn parse_ncm_song_falls_back_to_duration_when_dt_missing() {
        let val = json!({
            "id": 999,
            "name": "Missing",
            "ar": [],
            "al": {},
            "duration": 200000
        });
        let song = parse_ncm_song(&val, "nonexist").expect("should parse");
        assert_eq!(song.duration, 200000);
    }

    #[test]
    fn parse_ncm_song_returns_zero_duration_when_all_fields_missing() {
        let val = json!({
            "id": 1,
            "name": "S",
            "ar": [{"name": "A"}],
            "al": {"name": "B"}
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.duration, 0);
    }

    #[test]
    fn parse_ncm_song_returns_none_on_missing_id() {
        let val = json!({ "name": "NoId", "ar": [], "al": {} });
        assert!(parse_ncm_song(&val, "dt").is_none());
    }

    #[test]
    fn parse_ncm_song_returns_none_on_missing_name() {
        let val = json!({ "id": 1, "ar": [], "al": {} });
        assert!(parse_ncm_song(&val, "dt").is_none());
    }

    #[test]
    fn parse_ncm_song_handles_multiple_artists() {
        let val = json!({
            "id": 1,
            "name": "Duet",
            "ar": [{"name": "A"}, {"name": "B"}, {"name": "C"}],
            "al": {"name": "AL"},
            "dt": 1000
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.artists, "A / B / C");
    }

    #[test]
    fn parse_ncm_song_handles_null_artist_array() {
        let val = json!({
            "id": 1,
            "name": "Solo",
            "ar": null,
            "al": {"name": "AL"},
            "dt": 1000
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.artists, "");
    }

    #[test]
    fn parse_ncm_song_handles_artists_with_missing_names() {
        let val = json!({
            "id": 1,
            "name": "Song",
            "ar": [{"id": 1}, {"name": "B"}],
            "al": {"name": "AL"},
            "dt": 1000
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.artists, "B");
    }

    #[test]
    fn parse_ncm_song_missing_album_name_yields_empty_string() {
        let val = json!({
            "id": 1,
            "name": "Song",
            "ar": [{"name": "A"}],
            "al": {},
            "dt": 1000
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.album, "");
    }

    #[test]
    fn parse_ncm_song_missing_pic_url_yields_none() {
        let val = json!({
            "id": 1,
            "name": "Song",
            "ar": [{"name": "A"}],
            "al": {"name": "AL"},
            "dt": 1000
        });
        let song = parse_ncm_song(&val, "dt").expect("should parse");
        assert_eq!(song.pic_url, None);
    }
}
