//! 精简后的 DTO（Data Transfer Object）。
//!
//! NCM 接口字段繁杂，Rust 端仅向前端返回必要字段，降低前端解析负担。
//! 所有字段与前端 types/music.d.ts 严格保持一致。

use serde::Serialize;

use crate::audio_quality::AudioQuality;

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
    /// 码率（bps），如 320000 表示 320kbps；0 表示上游未下发或超出
    /// `u32` 可表示范围（未知），不得展示为 0kbps。
    pub bitrate: u32,
    /// 服务端实际下发档位；`None` 表示上游未返回或无法识别。
    /// 可能低于请求档位，展示时不得回填成请求档位。
    pub actual_level: Option<AudioQuality>,
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

/// 从 NCM `/song/url/v1` 响应体提取播放 URL、实际码率与实际下发档位。
///
/// `data[0].level` 是服务端按账号权益实际下发的档位（请求 lossless 时
/// 可能返回 exhigh），必须原样保留；缺失或未知值解析为 `None`，由前端
/// 展示实际码率并标注“档位未知”，不能回填请求档位。
///
/// `br` 缺失、非整数或超出 `u32` 可表示范围时一律收敛为 `0`（未知），
/// 不用 `as` 截断成一个看似合理的错误码率。
pub fn parse_song_url(song_id: u64, body: &serde_json::Value) -> SongUrl {
    let item = body.pointer("/data/0");
    let url = item
        .and_then(|v| v.get("url"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let bitrate = item
        .and_then(|v| v.get("br"))
        .and_then(|v| v.as_u64())
        .and_then(|br| u32::try_from(br).ok())
        .unwrap_or(0);
    let actual_level = item
        .and_then(|v| v.get("level"))
        .and_then(|v| v.as_str())
        .and_then(|raw| raw.parse::<AudioQuality>().ok());
    SongUrl {
        id: song_id,
        url,
        bitrate,
        actual_level,
    }
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
        assert_eq!(
            song.pic_url.as_deref(),
            Some("https://example.com/cover.jpg")
        );
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

    // ── DTO serialization: verify camelCase keys match frontend types ──

    #[test]
    fn song_serializes_snake_to_camel() {
        let s = Song {
            id: 123,
            name: "晴天".into(),
            artists: "周杰伦".into(),
            album: "叶惠美".into(),
            duration: 269000,
            pic_url: Some("https://example.com/c.jpg".into()),
        };
        let v = serde_json::to_value(&s).expect("Song must serialize");
        assert_eq!(v["id"], 123);
        assert_eq!(v["name"], "晴天");
        assert_eq!(v["artists"], "周杰伦");
        assert_eq!(v["album"], "叶惠美");
        assert_eq!(v["duration"], 269000);
        assert_eq!(v["picUrl"], "https://example.com/c.jpg"); // camelCase!
        assert!(v.get("pic_url").is_none(), "snake_case key must not exist");
    }

    #[test]
    fn song_url_serializes_camel_case() {
        let su = SongUrl {
            id: 1,
            url: Some("https://".into()),
            bitrate: 320000,
            actual_level: Some(AudioQuality::ExHigh),
        };
        let v = serde_json::to_value(&su).expect("SongUrl must serialize");
        assert_eq!(v["id"], 1);
        assert_eq!(v["url"], "https://");
        // bitrate is already lowercase, verify it's correct
        assert_eq!(v["bitrate"], 320000);
        assert_eq!(v["actualLevel"], "exhigh"); // snake → camel
        assert!(v.get("actual_level").is_none());
    }

    #[test]
    fn song_url_serializes_unknown_actual_level_as_null() {
        let su = SongUrl {
            id: 1,
            url: None,
            bitrate: 0,
            actual_level: None,
        };
        let v = serde_json::to_value(&su).expect("SongUrl must serialize");
        assert_eq!(v["actualLevel"], serde_json::Value::Null);
    }

    #[test]
    fn parse_song_url_keeps_downgraded_actual_level() {
        // 请求 lossless，但服务端按账号权益下发 exhigh/320k。
        let body = serde_json::json!({
            "data": [{
                "url": "https://example.com/song.mp3",
                "br": 320000,
                "level": "exhigh",
            }],
        });
        let su = parse_song_url(7, &body);
        assert_eq!(su.id, 7);
        assert_eq!(su.url.as_deref(), Some("https://example.com/song.mp3"));
        assert_eq!(su.bitrate, 320000);
        assert_eq!(su.actual_level, Some(AudioQuality::ExHigh));
    }

    #[test]
    fn parse_song_url_parses_lossless_level() {
        let body = serde_json::json!({
            "data": [{ "url": "https://example.com/song.flac", "br": 999000, "level": "lossless" }],
        });
        let su = parse_song_url(8, &body);
        assert_eq!(su.bitrate, 999000);
        assert_eq!(su.actual_level, Some(AudioQuality::Lossless));
    }

    #[test]
    fn parse_song_url_marks_missing_or_unknown_level_as_none() {
        for body in [
            serde_json::json!({ "data": [{ "url": "u", "br": 320000 }] }),
            serde_json::json!({ "data": [{ "url": "u", "br": 320000, "level": null }] }),
            // 特效档不属于常规六档，不能猜成某一档。
            serde_json::json!({ "data": [{ "url": "u", "br": 320000, "level": "sky" }] }),
        ] {
            let su = parse_song_url(9, &body);
            assert_eq!(su.actual_level, None, "未知档位必须解析为 None");
            assert_eq!(su.bitrate, 320000);
        }
    }

    #[test]
    fn parse_song_url_tolerates_missing_data() {
        let su = parse_song_url(10, &serde_json::json!({ "data": [] }));
        assert_eq!(su.id, 10);
        assert_eq!(su.url, None);
        assert_eq!(su.bitrate, 0);
        assert_eq!(su.actual_level, None);
    }

    #[test]
    fn parse_song_url_degrades_out_of_range_bitrate_to_unknown() {
        // 2^32 超出 u32：不得用 as 截断成 0 或残值，必须按“未知”(0) 处理。
        let body = serde_json::json!({
            "data": [{ "url": "u", "br": 4_294_967_296u64, "level": "exhigh" }],
        });
        let su = parse_song_url(11, &body);
        assert_eq!(su.bitrate, 0, "超出 u32 的码率必须收敛为未知哨兵");
        assert_eq!(su.actual_level, Some(AudioQuality::ExHigh));

        // 范围内的码率（含 u32::MAX 边界）必须原样保留。
        for (song_id, br) in [(12u64, 999_000u64), (13u64, u64::from(u32::MAX))] {
            let body = serde_json::json!({
                "data": [{ "url": "u", "br": br }],
            });
            let su = parse_song_url(song_id, &body);
            assert_eq!(su.bitrate, u32::try_from(br).expect("测试值必须在 u32 内"));
        }
    }

    #[test]
    fn playlist_serializes_camel_case() {
        let pl = Playlist {
            id: 1,
            name: "歌单".into(),
            cover_url: "https://c.jpg".into(),
            track_count: 42,
            creator: Some("作者".into()),
        };
        let v = serde_json::to_value(&pl).expect("Playlist must serialize");
        assert_eq!(v["id"], 1);
        assert_eq!(v["name"], "歌单");
        assert_eq!(v["coverUrl"], "https://c.jpg"); // snake → camel
        assert_eq!(v["trackCount"], 42); // snake → camel
        assert_eq!(v["creator"], "作者");
        assert!(v.get("cover_url").is_none());
        assert!(v.get("track_count").is_none());
    }

    #[test]
    fn playlist_detail_serializes_nested_correctly() {
        let pl = Playlist {
            id: 2,
            name: "P".into(),
            cover_url: "u".into(),
            track_count: 10,
            creator: None,
        };
        let songs = vec![Song {
            id: 3,
            name: "S".into(),
            artists: "A".into(),
            album: "B".into(),
            duration: 1000,
            pic_url: None,
        }];
        let pd = PlaylistDetail {
            playlist: pl,
            songs,
        };
        let v = serde_json::to_value(&pd).expect("PlaylistDetail must serialize");
        assert_eq!(v["playlist"]["id"], 2);
        assert_eq!(v["playlist"]["coverUrl"], "u");
        assert_eq!(v["playlist"]["trackCount"], 10);
        assert_eq!(v["songs"][0]["id"], 3);
        assert_eq!(v["songs"][0]["picUrl"], serde_json::Value::Null);
    }

    #[test]
    fn search_result_serializes_camel_case() {
        let sr = SearchResult {
            songs: vec![],
            total: 99,
        };
        let v = serde_json::to_value(&sr).expect("SearchResult must serialize");
        assert_eq!(v["total"], 99);
        assert_eq!(v["songs"], serde_json::Value::Array(vec![]));
    }

    #[test]
    fn daily_recommend_serializes_camel_case() {
        let dr = DailyRecommend {
            songs: vec![],
            date: "2025-01-01".into(),
        };
        let v = serde_json::to_value(&dr).expect("DailyRecommend must serialize");
        assert_eq!(v["date"], "2025-01-01");
    }

    #[test]
    fn search_suggestion_serializes_camel_case() {
        let ss = SearchSuggestion {
            keyword: "晴".into(),
            song: None,
        };
        let v = serde_json::to_value(&ss).expect("SearchSuggestion must serialize");
        assert_eq!(v["keyword"], "晴");
        assert_eq!(v["song"], serde_json::Value::Null);
    }

    #[test]
    fn lyric_result_serializes_camel_case() {
        let lr = LyricResult {
            lrc: Some("[00:01]A".into()),
            t_lrc: Some("[00:01]B".into()),
            y_lrc: None,
        };
        let v = serde_json::to_value(&lr).expect("LyricResult must serialize");
        assert_eq!(v["lrc"], "[00:01]A");
        assert_eq!(v["tLrc"], "[00:01]B"); // snake → camel
        assert_eq!(v["yLrc"], serde_json::Value::Null); // snake → camel
        assert!(v.get("t_lrc").is_none());
        assert!(v.get("y_lrc").is_none());
    }

    #[test]
    fn all_eight_dtos_use_camel_case_keys_only() {
        // Verify that renaming works: no snake_case keys leak through
        let song = Song {
            id: 1,
            name: "".into(),
            artists: "".into(),
            album: "".into(),
            duration: 0,
            pic_url: Some("".into()),
        };
        let song_json = serde_json::to_string(&song).expect("Song must serialize");
        assert!(!song_json.contains("pic_url"));

        let pl = Playlist {
            id: 1,
            name: "".into(),
            cover_url: "".into(),
            track_count: 0,
            creator: None,
        };
        let pl_json = serde_json::to_string(&pl).expect("Playlist must serialize");
        assert!(
            !pl_json.contains("cover_url"),
            "cover_url should be coverUrl"
        );
        assert!(
            !pl_json.contains("track_count"),
            "track_count should be trackCount"
        );

        let lr = LyricResult {
            lrc: None,
            t_lrc: Some("".into()),
            y_lrc: None,
        };
        let lr_json = serde_json::to_string(&lr).expect("LyricResult must serialize");
        assert!(!lr_json.contains("t_lrc"), "t_lrc should be tLrc");
        assert!(!lr_json.contains("y_lrc"), "y_lrc should be yLrc");
    }
}
