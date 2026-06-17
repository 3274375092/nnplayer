use serde::Serialize;
use std::sync::RwLock;
use std::time::Instant;

/// 播放器内部状态（Rust 端读写）
/// 用 system clock 计算 position（Player::get_pos 在 rodio 0.22 里不可靠，会卡死）
pub struct InternalState {
    pub playing: bool,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub path: Option<String>,
    /// 播放起始时刻（pause/resume/play 都会重置）
    pub play_started_at: Option<Instant>,
    /// 起始时的位置偏移（暂停时把已播时间累加到这里）
    pub play_offset: f64,
}

impl Default for InternalState {
    fn default() -> Self {
        Self {
            playing: false,
            current_time: 0.0,
            duration: 0.0,
            volume: 0.8,
            path: None,
            play_started_at: None,
            play_offset: 0.0,
        }
    }
}

/// 向前端推送的快照（Serialize 由 event/tick 发给前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStateSnapshot {
    pub playing: bool,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub path: Option<String>,
}

impl From<&RwLock<InternalState>> for AudioStateSnapshot {
    fn from(lock: &RwLock<InternalState>) -> Self {
        let s = lock.read().expect("AudioState lock poisoned");
        Self {
            playing: s.playing,
            current_time: s.current_time,
            duration: s.duration,
            volume: s.volume,
            path: s.path.clone(),
        }
    }
}
