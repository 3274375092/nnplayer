//! 播放音质档位：与前端 AudioQuality、NCM song/url/v1 的 level 参数一致。
//!
//! 请求档位由用户选择；响应里的 level 是服务端实际下发档位，可能因账号权益而更低。

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// 网易云 `song/url/v1` 的常规六档音质，不含 sky / jyeffect / dolby 等特效档。
///
/// serde 表示与 `as_str()` 一致，是前端 `AudioQuality` 联合类型的 wire 契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AudioQuality {
    #[serde(rename = "standard")]
    Standard,
    #[serde(rename = "higher")]
    Higher,
    #[serde(rename = "exhigh")]
    ExHigh,
    #[serde(rename = "lossless")]
    Lossless,
    #[serde(rename = "hires")]
    Hires,
    #[serde(rename = "jymaster")]
    Jymaster,
}

impl AudioQuality {
    /// 按档位从低到高排列，顺序同时用于前端菜单与降级判断。
    pub const ALL: [Self; 6] = [
        Self::Standard,
        Self::Higher,
        Self::ExHigh,
        Self::Lossless,
        Self::Hires,
        Self::Jymaster,
    ];

    /// 未指定档位时的历史默认值（320kbps）。
    pub const DEFAULT: Self = Self::ExHigh;

    /// NCM `level` 参数 / 响应中使用的字符串。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Higher => "higher",
            Self::ExHigh => "exhigh",
            Self::Lossless => "lossless",
            Self::Hires => "hires",
            Self::Jymaster => "jymaster",
        }
    }
}

impl fmt::Display for AudioQuality {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AudioQuality {
    type Err = UnknownAudioQuality;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|quality| quality.as_str() == raw)
            .ok_or(UnknownAudioQuality)
    }
}

/// `FromStr` 的错误类型：调用方可自行附加上下文，再映射为应用错误。
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("未知的音质档位")]
#[must_use]
pub struct UnknownAudioQuality;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_wire_strings_are_stable() {
        assert_eq!(
            AudioQuality::ALL.map(AudioQuality::as_str),
            ["standard", "higher", "exhigh", "lossless", "hires", "jymaster"]
        );
    }

    #[test]
    fn serde_round_trips_wire_strings() {
        for quality in AudioQuality::ALL {
            let json = serde_json::to_string(&quality).expect("音质必须可序列化");
            assert_eq!(json, format!("\"{}\"", quality.as_str()));
            let parsed: AudioQuality = serde_json::from_str(&json).expect("音质必须可反序列化");
            assert_eq!(parsed, quality);
        }
    }

    #[test]
    fn from_str_accepts_exactly_the_six_levels() {
        for quality in AudioQuality::ALL {
            assert_eq!(
                quality
                    .as_str()
                    .parse::<AudioQuality>()
                    .expect("合法档位必须可解析"),
                quality
            );
        }
    }

    #[test]
    fn from_str_rejects_unknown_levels() {
        for raw in [
            "sky",
            "jyeffect",
            "dolby",
            "EXHIGH",
            "",
            "999000",
            "exhigh\"); drop",
        ] {
            assert!(
                raw.parse::<AudioQuality>().is_err(),
                "{raw} 不应被接受为常规音质档位"
            );
        }
    }

    #[test]
    fn default_is_exhigh() {
        assert_eq!(AudioQuality::DEFAULT, AudioQuality::ExHigh);
    }
}
