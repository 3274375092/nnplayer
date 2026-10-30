/** 格式化秒数为 mm:ss */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 格式化毫秒数为 mm:ss */
export function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  return fmtDuration(Math.floor(ms / 1000));
}

/**
 * 长时长的用户语言格式：≥1 小时显示「X 小时 Y 分」，否则「X 分 YY 秒」。
 * 用于队列剩余时长这类不需要精确到秒的汇总信息，避免出现「124 分 51 秒」。
 */
export function fmtLongDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 分";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }
  return `${seconds} 秒`;
}
