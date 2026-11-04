// 更新检查错误分类：只识别「当前平台不在 latest.json 的 platforms 里」
// 这一种可解释的失败，其余（网络、超时、JSON、签名）仍走通用失败态。
//
// tauri-plugin-updater 的两个相关错误文案：
//   - TargetNotFound:  the platform `x` was not found in the response `platforms` object
//   - TargetsNotFound: None of the fallback platforms `[...]` were found in the
//                      response `platforms` object
// 插件未来改文案时这里会漏判，但只会回落到通用错误，不会把网络失败误报成
// 「平台不支持」。

const PLATFORM_MISSING_PATTERN = /`platforms` object/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }
  return "";
}

export function isUnsupportedPlatformError(error: unknown): boolean {
  return PLATFORM_MISSING_PATTERN.test(errorMessage(error));
}
