// 播放音质档位：选项表、持久化、归一化与实际下发档位展示。
// 档位与 Rust 端 AudioQuality 枚举严格一致；“所选档位”只代表请求，
// 实际听什么以服务端下发的 SongUrl.actualLevel / bitrate 为准。

import type { AudioQuality } from "@/types/music";

export interface AudioQualityOption {
  value: AudioQuality;
  /** 完整标签（菜单项） */
  label: string;
  /** 短标签（播放条徽标） */
  shortLabel: string;
  /** 说明（菜单项副文本） */
  hint: string;
}

export const AUDIO_QUALITY_OPTIONS: readonly AudioQualityOption[] = [
  { value: "standard", label: "标准", shortLabel: "128K", hint: "128kbps MP3" },
  { value: "higher", label: "较高", shortLabel: "192K", hint: "192kbps MP3" },
  { value: "exhigh", label: "极高", shortLabel: "320K", hint: "320kbps MP3" },
  { value: "lossless", label: "无损", shortLabel: "无损", hint: "FLAC 无损压缩" },
  { value: "hires", label: "Hi-Res", shortLabel: "Hi-Res", hint: "高解析度 FLAC" },
  { value: "jymaster", label: "超清母带", shortLabel: "母带", hint: "母带级音质，最高档" },
];

export const DEFAULT_AUDIO_QUALITY: AudioQuality = "exhigh";

const QUALITY_STORAGE_KEY = "nnplayer.audioQuality";

const QUALITY_VALUES = new Set<string>(AUDIO_QUALITY_OPTIONS.map((o) => o.value));

/** 未知/损坏的持久化值一律回落默认档，不抛错。 */
export function normalizeAudioQuality(raw: unknown): AudioQuality {
  return typeof raw === "string" && QUALITY_VALUES.has(raw)
    ? (raw as AudioQuality)
    : DEFAULT_AUDIO_QUALITY;
}

export function readStoredAudioQuality(): AudioQuality {
  try {
    return normalizeAudioQuality(localStorage.getItem(QUALITY_STORAGE_KEY));
  } catch {
    // localStorage 不可用时沿用默认档位
    return DEFAULT_AUDIO_QUALITY;
  }
}

export function writeStoredAudioQuality(quality: AudioQuality): void {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, quality);
  } catch {
    // localStorage 不可用不应中断切档
  }
}

const OPTION_BY_VALUE = Object.fromEntries(
  AUDIO_QUALITY_OPTIONS.map((o) => [o.value, o]),
) as Readonly<Record<AudioQuality, AudioQualityOption>>;

export function audioQualityOption(quality: AudioQuality): AudioQualityOption {
  // 持久化入口已在 normalizeAudioQuality 收口，类型与 Record 约束保证这里必然命中。
  return OPTION_BY_VALUE[quality];
}

/** 档位高低序号（0 最低）；用于判断服务端是否下发了更低档位。 */
export function audioQualityRank(quality: AudioQuality): number {
  return AUDIO_QUALITY_OPTIONS.findIndex((o) => o.value === quality);
}

function bitrateToKbps(bitrate: number | null | undefined): number | null {
  if (typeof bitrate !== "number" || !Number.isFinite(bitrate) || bitrate <= 0) {
    return null;
  }
  return Math.round(bitrate / 1000);
}

/** 码率（bps）格式化为展示文本；0/null/非法值返回 null（未知）。 */
export function formatBitrate(bitrate: number | null | undefined): string | null {
  const kbps = bitrateToKbps(bitrate);
  return kbps === null ? null : `${kbps} kbps`;
}

/** 码率（bps）压缩为徽标短文本，如 320000 → "320K"；未知返回 null。 */
export function formatBitrateShort(bitrate: number | null | undefined): string | null {
  const kbps = bitrateToKbps(bitrate);
  return kbps === null ? null : `${kbps}K`;
}

/** 实际音质徽标短标签：优先档位短标签，其次实际码率；都未知返回 null。 */
export function actualQualityShortLabel(
  level: AudioQuality | null,
  bitrate: number | null,
): string | null {
  if (level !== null) return audioQualityOption(level).shortLabel;
  return formatBitrateShort(bitrate);
}

/** 实际音质完整描述，如 "极高 · 320 kbps"；档位未知但码率已知时
 *  明确标注“档位未知”，不猜测档位。 */
export function formatActualQuality(
  level: AudioQuality | null,
  bitrate: number | null,
): string | null {
  const label = level === null ? null : audioQualityOption(level).label;
  const rate = formatBitrate(bitrate);
  if (label !== null && rate !== null) return `${label} · ${rate}`;
  if (label !== null) return label;
  if (rate !== null) return `${rate}（档位未知）`;
  return null;
}

/** 实际下发档位是否低于所选档位；实际档位未知时返回 false（不臆测降级）。 */
export function isQualityDowngraded(
  actualLevel: AudioQuality | null,
  requested: AudioQuality,
): boolean {
  return (
    actualLevel !== null &&
    audioQualityRank(actualLevel) < audioQualityRank(requested)
  );
}
