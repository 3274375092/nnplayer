// 下载进度百分比：updater 的 Started 事件不保证带 Content-Length，
// 缺失时返回 null，界面显示「正在下载更新…」而不是伪造一个百分比。

export function downloadPercent(received: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(received) || received <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}
