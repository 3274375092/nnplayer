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
