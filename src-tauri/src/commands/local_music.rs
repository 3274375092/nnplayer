use std::collections::HashSet;
use std::fs;
use std::path::Path;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{Accessor, ItemKey, TagExt};
use ncm_api::Query;
use tauri::State;
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::models::LocalSongMetadata;
use crate::state::AppState;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wv", "ape", "alac",
];

/// 递归扫描目录，返回所有支持的音频文件的元数据。
#[tauri::command]
pub fn scan_local_folder(folder: String) -> AppResult<Vec<LocalSongMetadata>> {
    let mut results = Vec::new();

    let ext_set: HashSet<&str> = SUPPORTED_EXTENSIONS.iter().copied().collect();

    for entry in WalkDir::new(&folder)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // 跳过隐藏目录和系统目录
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.')
        })
    {
        match entry {
            Ok(e) if e.file_type().is_file() => {
                let path = e.path();
                let ext = match path.extension().and_then(|e| e.to_str()) {
                    Some(ext) => ext.to_lowercase(),
                    None => continue,
                };
                if !ext_set.contains(ext.as_str()) {
                    continue;
                }
                match read_local_metadata(path) {
                    Ok(meta) => results.push(meta),
                    Err(err) => {
                        log::warn!("[local] 跳过 {}: {}", path.display(), err);
                    }
                }
            }
            Ok(_) => {}
            Err(err) => {
                log::warn!("[local] 遍历目录失败: {err}");
            }
        }
    }

    Ok(results)
}

/// 提取本地音频文件的内嵌封面（JPEG bytes）。
#[tauri::command]
pub fn get_local_cover(path: String) -> AppResult<Vec<u8>> {
    let tagged = lofty::read_from_path(&path).map_err(|e| {
        AppError::Audio(format!("读取元数据失败: {e}"))
    })?;

    // 尝试从所有 tag 中找封面
    for tag in tagged.tags() {
        if let Some(pic) = tag.pictures().iter().find(|p| {
            p.pic_type() == lofty::picture::PictureType::CoverFront
        }) {
            // 用已有依赖 image crate 缩放到 512x512
            // CatmullRom：质量接近 Lanczos3 但速度快 2-3 倍，列表缩略图场景无可见差异
            if let Ok(img) = image::load_from_memory(pic.data()) {
                let resized = img.resize(512, 512, image::imageops::FilterType::CatmullRom);
                let mut buf = Vec::new();
                resized
                    .write_to(
                        &mut std::io::Cursor::new(&mut buf),
                        image::ImageFormat::Jpeg,
                    )
                    .ok();
                return Ok(buf);
            }
            // 缩放失败时返回原始数据
            return Ok(pic.data().to_vec());
        }
    }

    Err(AppError::Audio("未找到封面".to_string()))
}

/// 获取本地音频文件的歌词。优先级：
///   1. 内嵌 tag 的 USLT/Lyrics 字段（FLAC Vorbis、MP3 ID3v2、M4A iTunes、OGG 等都支持）
///   2. 同目录的 .lrc / .yrc / .qrc / .krc 文件
///
/// 返回空串表示"无歌词"，由前端 LyricPanel 显示"暂无歌词"，不算错误。
#[tauri::command]
pub fn get_local_lyric(path: String) -> AppResult<String> {
    log::info!("[local] get_local_lyric 被调用: {path}");

    // 1. 内嵌 tag
    match lofty::read_from_path(&path) {
        Ok(tagged) => {
            let tag_count = tagged.tags().len();
            log::info!("[local] lofty 解析成功, tag 数量 = {tag_count}");
            for (i, tag) in tagged.tags().iter().enumerate() {
                log::info!("[local] tag[{i}] tag_type = {:?}, items 数量 = {}", tag.tag_type(), tag.len());

                // ① 标准 ItemKey::Lyrics (USLT / ©lyr / LYRICS)
                if let Some(lyrics) = tag.get_string(ItemKey::Lyrics) {
                    let s = lyrics.trim();
                    if !s.is_empty() {
                        log::info!("[local] 内嵌歌词命中 tag[{}] (ItemKey::Lyrics) {} bytes", i, s.len());
                        return Ok(s.to_string());
                    }
                }

                // ② 兜底：直接遍历所有 item key，把名字包含 "lyric" 的全部拿出来
                //    覆盖 UNSYNCEDLYRICS / LYRICS / Lyrics / lyrics 等大小写、连字符变体
                for item in tag.items() {
                    let key = format!("{:?}", item.key());
                    if key.to_lowercase().contains("lyric") {
                        if let Some(val) = item.value().text() {
                            let s = val.trim();
                            if !s.is_empty() {
                                log::info!(
                                    "[local] 内嵌歌词命中 tag[{}] key={} {} bytes",
                                    i, key, s.len()
                                );
                                return Ok(s.to_string());
                            }
                        }
                    }
                }

                // ③ 诊断：dump 前 5 个 item 的 key，方便排查
                for (k, item) in tag.items().take(5).enumerate() {
                    log::info!("[local] tag[{}] item[{}] key={:?}", i, k, item.key());
                }
            }
        }
        Err(e) => {
            log::warn!("[local] lofty 读取失败({e}), 尝试同目录歌词文件");
        }
    }

    // 2. 同目录 .lrc / .yrc / .qrc / .krc
    let path_buf = Path::new(&path);
    let stem = match path_buf.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s,
        None => {
            log::info!("[local] 路径无 file_stem, 返回空串");
            return Ok(String::new());
        }
    };
    let parent = match path_buf.parent() {
        Some(p) => p,
        None => {
            log::info!("[local] 路径无 parent, 返回空串");
            return Ok(String::new());
        }
    };

    for ext in ["lrc", "yrc", "qrc", "krc"] {
        let candidate = parent.join(format!("{stem}.{ext}"));
        match fs::read_to_string(&candidate) {
            Ok(text) => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    log::info!(
                        "[local] 同目录歌词命中 {} ({} bytes), 前 80 字符: {:?}",
                        candidate.display(), trimmed.len(),
                        &trimmed.chars().take(80).collect::<String>()
                    );
                    return Ok(trimmed.to_string());
                }
            }
            Err(e) => {
                log::info!("[local] 候选 {} 读取失败: {e}", candidate.display());
            }
        }
    }

    log::info!("[local] 全部来源都没找到歌词, 返回空串");
    Ok(String::new())
}

/// 在线兜底：用 title + artist 走 NCM cloudsearch 找最佳匹配，再调 lyric_new 拉歌词。
///
/// 设计要点：
///   1. 未登录 / NCM 请求失败 → 静默返回 None，不阻塞 UI（本地歌曲不会因为没登录就没歌词）
///   2. 匹配优先级：name 完全相同 + 艺人包含 → name 完全相同 → 第一条
///   3. 复用 ncm_api::ApiClient（与 get_lyric / search_songs 一致）
#[tauri::command]
pub async fn fetch_online_lyric(
    state: State<'_, AppState>,
    title: String,
    artist: Option<String>,
) -> AppResult<Option<String>> {
    if title.trim().is_empty() {
        return Ok(None);
    }

    // 未登录直接返回 None
    let logged_in = state.auth.lock().await.is_logged_in();
    if !logged_in {
        log::info!("[online-lyric] 未登录, 跳过在线搜歌词 ('{title}')");
        return Ok(None);
    }

    let keyword = match artist.as_deref() {
        Some(a) if !a.trim().is_empty() => format!("{title} {a}"),
        _ => title.clone(),
    };
    log::info!("[online-lyric] 搜索: '{keyword}'");

    let cookie = state.cookie().await;

    // 1. cloudsearch 拿候选
    let api = state.api.lock().await;
    let search_resp = api
        .cloudsearch(
            &Query::new()
                .cookie(&cookie)
                .param("keywords", &keyword)
                .param("type", "1")
                .param("limit", "5")
                .param("offset", "0"),
        )
        .await;
    drop(api);

    let search_resp = match search_resp {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[online-lyric] cloudsearch 失败: {e}");
            return Ok(None);
        }
    };

    let songs = search_resp
        .body
        .pointer("/result/songs")
        .and_then(|v| v.as_array());

    let Some(songs) = songs else {
        log::info!("[online-lyric] 搜索无结果: '{keyword}'");
        return Ok(None);
    };

    // 2. 选最佳匹配
    let mut best_id: Option<u64> = None;

    // 优先级 1：name 完全相同 + 艺人包含
    for s in songs {
        let n = s.pointer("/name").and_then(|v| v.as_str()).unwrap_or("");
        if n.trim() != title.trim() {
            continue;
        }
        if let Some(target) = artist.as_deref() {
            let ar: Vec<String> = s
                .pointer("/ar")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.pointer("/name").and_then(|v| v.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            if ar.iter().any(|a| a.contains(target) || target.contains(a)) {
                best_id = s.pointer("/id").and_then(|v| v.as_u64());
                break;
            }
        } else {
            best_id = s.pointer("/id").and_then(|v| v.as_u64());
            break;
        }
    }

    // 优先级 2：name 完全相同（无艺人匹配）
    if best_id.is_none() {
        for s in songs {
            let n = s.pointer("/name").and_then(|v| v.as_str()).unwrap_or("");
            if n.trim() == title.trim() {
                best_id = s.pointer("/id").and_then(|v| v.as_u64());
                break;
            }
        }
    }

    // 优先级 3：第一条
    if best_id.is_none() {
        best_id = songs
            .first()
            .and_then(|s| s.pointer("/id").and_then(|v| v.as_u64()));
    }

    let Some(song_id) = best_id else {
        log::info!("[online-lyric] 无可用 song_id, 返回 None");
        return Ok(None);
    };

    log::info!("[online-lyric] 命中 song_id={song_id} for '{title}'");

    // 3. lyric_new 拉歌词
    let api = state.api.lock().await;
    let lyric_resp = api
        .lyric_new(
            &Query::new()
                .cookie(&cookie)
                .param("id", &song_id.to_string()),
        )
        .await;
    drop(api);

    let lyric_resp = match lyric_resp {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[online-lyric] lyric_new 失败: {e}");
            return Ok(None);
        }
    };

    let lrc = lyric_resp
        .body
        .pointer("/lrc/lyric")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match &lrc {
        Some(text) if !text.trim().is_empty() => {
            log::info!(
                "[online-lyric] 命中歌词 {} bytes for song_id={}",
                text.len(),
                song_id
            );
            Ok(lrc)
        }
        _ => {
            log::info!("[online-lyric] song_id={song_id} 无歌词字段");
            Ok(None)
        }
    }
}

// =============== 内部辅助 ===============

fn read_local_metadata(path: &Path) -> Result<LocalSongMetadata, String> {
    let tagged = lofty::read_from_path(path).map_err(|e| format!("lofty 读取失败: {e}"))?;

    // 从第一个有效 tag 提取文本字段
    let tag = tagged.first_tag();

    let title = tag
        .and_then(|t| t.title())
        .unwrap_or_default()
        .to_string();
    let artist: String = tag
        .and_then(|t| t.artist().map(|c| c.to_string()))
        .unwrap_or_else(|| {
            tag.and_then(|t| t.get_string(lofty::tag::ItemKey::TrackArtist))
                .unwrap_or("")
                .to_string()
        })
        .to_string();
    let album = tag
        .and_then(|t| t.album())
        .unwrap_or_default()
        .to_string();

    // 使用文件名作为 fallback
    let title = if title.is_empty() {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未知")
            .to_string()
    } else {
        title
    };

    let props = tagged.properties();
    let duration = props.duration().as_secs_f64();
    let bitrate = props.audio_bitrate().unwrap_or(0);
    let sample_rate = props.sample_rate().unwrap_or(0);

    // 检查是否有封面
    let has_cover = tagged.tags().iter().any(|t| {
        t.get_picture_type(lofty::picture::PictureType::CoverFront)
            .is_some()
    });

    let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    Ok(LocalSongMetadata {
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        duration,
        bitrate,
        sample_rate,
        has_cover,
        file_size,
    })
}
