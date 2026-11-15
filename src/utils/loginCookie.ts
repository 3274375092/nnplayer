/**
 * 高级 Cookie 登录的输入校验。
 *
 * 这里只做“格式上是否像一条可用凭据”的判定，不猜测服务端是否接受它：
 * 真正能否登录仍由后端调用决定。校验存在的理由是错误预防——把注释、
 * 别的键名（如 `MUSIC_U2=`）或空值当成有效凭据，会让按钮亮着却必然失败。
 */

/** 判断 Cookie 文本里是否有一个非空的 `MUSIC_U=…` 键值对。 */
export function hasUsableMusicUCookie(raw: string): boolean {
  for (const segment of raw.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator).trim() !== "MUSIC_U") continue;
    const value = trimmed.slice(separator + 1).trim();
    if (value && value !== "undefined" && value !== "null") return true;
  }
  return false;
}
