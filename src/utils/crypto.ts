// 网易云密码处理工具。
// 与 CNMPlayer 一致：只做 MD5，不做 RSA+AES 加密。
// ncm-api 的 login() 内部已经会再做 MD5，所以前端只需要把明文 MD5 一次即可。

import md5 from "blueimp-md5";

/**
 * 把明文密码计算成 NCM 期望的 MD5 hex（小写 32 位）。
 * 这就是 login_with_account 所需的 md5_password 字段。
 */
export function md5Password(plain: string): string {
  return md5(plain).toLowerCase();
}

/**
 * 验证手机号格式（中国大陆 11 位）。
 */
export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 验证邮箱格式。
 */
export function isValidEmail(email: string): boolean {
  return /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email);
}