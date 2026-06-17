// 跨平台 DTO 边界映射。
//
// 所有从 qq-music::QqXxx 转换为 nnplayer 内部 Song/Playlist DTO 的逻辑
// 集中在这里，便于：
//   1. 隔离平台特有的字段名差异
//   2. 多个 commands/qq_*.rs 共用同一份转换代码
//   3. 未来扩展其他平台时按相同模式加文件

use qq_music::{QqPlaylist, QqSong};

use crate::models::{Playlist, Song};

/// QQ mid (字符串) → nnplayer u64 折叠
///
/// QQ song id 是字符串（mid），但现有 Song.id 是 u64（NCM 的数字 id）。
/// 使用稳定 hash 折叠到 u64：取 mid 字符串的 FNV-1a 64 哈希。
/// 注意：仅用作前端唯一标识，**不**用于业务查询（业务查询仍用原始 mid）。
pub fn qq_mid_to_u64(mid: &str) -> u64 {
    // FNV-1a 64
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in mid.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    // 0 是 NCM 的非法 id，强制替换
    if h == 0 {
        1
    } else {
        h
    }
}

/// 将 QQ 平台 DTO 转换为 nnplayer 内部 Song。
pub fn qq_song_to_dto(s: QqSong) -> Song {
    let id = qq_mid_to_u64(&s.id);
    let artists = s
        .artists
        .into_iter()
        .map(|a| a.name)
        .collect::<Vec<_>>()
        .join(" / ");
    Song {
        id,
        name: s.name,
        artists,
        album: s.album,
        duration: s.duration_ms as u64,
        pic_url: Some(s.pic_url),
        platform: "qq".to_string(),
        qq_mid: Some(s.id),
    }
}

/// 将 QQ 平台歌单 DTO 转换为 nnplayer 内部 Playlist。
/// QQ 歌单 ID 是纯数字字符串（如 "123456"），直接 parse 为 u64。
/// 不经过 `qq_mid_to_u64` 哈希（那是给歌曲 mid 用的）。
pub fn qq_playlist_to_dto(p: QqPlaylist) -> Playlist {
    Playlist {
        id: p.id.parse::<u64>().unwrap_or(0),
        name: p.name,
        cover_url: p.pic_url,
        track_count: 0,
        creator: p.creator,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use qq_music::{QqArtist, QqPlaylist, QqSong};

    #[test]
    fn qq_mid_to_u64_is_stable_and_nonzero() {
        assert_eq!(qq_mid_to_u64("001"), qq_mid_to_u64("001"));
        assert_ne!(qq_mid_to_u64("001"), 0);
        assert_ne!(qq_mid_to_u64("a"), qq_mid_to_u64("b"));
    }

    #[test]
    fn qq_song_to_dto_uses_qq_platform_tag() {
        let song = QqSong {
            id: "001abc".into(),
            name: "test".into(),
            artists: vec![QqArtist { id: "s1".into(), name: "singer".into() }],
            album: "alb".into(),
            pic_url: "https://example.com/p.jpg".into(),
            duration_ms: 180_000,
        };
        let dto = qq_song_to_dto(song);
        assert_eq!(dto.platform, "qq");
        assert_eq!(dto.name, "test");
        assert_eq!(dto.artists, "singer");
        assert_eq!(dto.duration, 180_000);
        assert_eq!(dto.pic_url.as_deref(), Some("https://example.com/p.jpg"));
    }

    #[test]
    fn qq_playlist_to_dto_uses_numeric_id() {
        let p = QqPlaylist {
            id: "123456".into(),
            name: "plist".into(),
            pic_url: "https://x.jpg".into(),
            creator: Some("me".into()),
        };
        let dto = qq_playlist_to_dto(p);
        assert_eq!(dto.id, 123456);
        assert_eq!(dto.creator.as_deref(), Some("me"));
        assert_eq!(dto.name, "plist");
    }
}
