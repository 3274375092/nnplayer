// 用户登录态 Pinia Store。
// 负责：
//   1. 应用启动时自动调用 refresh() 读取后端已恢复的会话
//   2. 三种登录方式（QR / 账号 / 手机验证码）的入口
//   3. 退出登录

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  getAuthState,
  loginQrCheck,
  loginQrKey,
  loginSendCaptcha,
  loginWithAccount,
  loginWithCaptcha,
  logout as apiLogout,
  saveCookie,
} from "@/composables/useNcmApi";

export type LoginMethod = "qr" | "account" | "phone" | "cookie" | "unknown" | "failed";

export const useUserStore = defineStore("user", () => {
  // =============== 状态 ===============

  const loggedIn = ref<boolean>(false);
  const nickname = ref<string>("");
  const userId = ref<number | null>(null);
  const loginMethod = ref<LoginMethod>("unknown");
  const avatarUrl = ref<string>("");

  const displayName = computed(() =>
    loggedIn.value ? nickname.value || "网易云用户" : "未登录"
  );

  // refresh 调用去重：允许多次调用但只发一次请求
  let refreshPromise: Promise<void> | null = null;

  function setAuthState(opts: {
    loggedIn: boolean;
    nickname?: string;
    userId?: number | null;
    loginMethod?: LoginMethod;
    avatarUrl?: string;
  }) {
    loggedIn.value = opts.loggedIn;
    nickname.value = opts.nickname ?? "";
    userId.value = opts.userId ?? null;
    loginMethod.value = opts.loginMethod ?? "unknown";
    avatarUrl.value = opts.avatarUrl ?? "";
  }

  // =============== 会话恢复 ===============

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = _refresh();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function _refresh() {
    try {
      const s = await getAuthState();
      setAuthState({
        loggedIn: s.loggedIn,
        nickname: s.nickname,
        userId: s.userId,
        loginMethod: (s.loginMethod as LoginMethod) ?? "unknown",
        avatarUrl: s.avatarUrl,
      });
    } catch (e) {
      console.warn("[user] refresh 失败", e);
      setAuthState({ loggedIn: false, loginMethod: "failed" });
    }
  }

  // =============== 登录入口 ===============

  /**
   * QR 登录第一步：拿 unikey。
   */
  async function startQrLogin(): Promise<{ unikey: string; qrUrl: string; qrImage: string | null }> {
    return loginQrKey();
  }

  /**
   * QR 登录第二步：轮询一次。
   * 返回 { code, ... }，code=803 表示登录成功。
   * 登录成功时同步把后端返回的 avatarUrl 写入 store（避免额外 IPC 刷新）。
   */
  async function pollQrLogin(unikey: string) {
    const res = await loginQrCheck(unikey);
    if (res.code === 803) {
      setAuthState({
        loggedIn: true,
        nickname: res.nickname ?? "网易云用户",
        userId: res.userId ?? null,
        loginMethod: "qr",
        avatarUrl: res.avatarUrl ?? "",
      });
    }
    return res;
  }

  async function loginByAccount(account: string, md5Password: string) {
    const res = await loginWithAccount(account, md5Password);
    setAuthState({
      loggedIn: true,
      nickname: res.nickname,
      userId: res.userId ?? null,
      loginMethod: "account",
      avatarUrl: res.avatarUrl ?? "",
    });
    return res;
  }

  async function loginByCookie(cookie: string) {
    const res = await saveCookie(cookie);
    setAuthState({
      loggedIn: true,
      nickname: res.nickname,
      userId: res.userId ?? null,
      loginMethod: "cookie",
      avatarUrl: res.avatarUrl ?? "",
    });
    return res;
  }

  async function sendPhoneCaptcha(phone: string) {
    await loginSendCaptcha(phone);
  }

  async function loginByPhone(phone: string, captcha: string) {
    const res = await loginWithCaptcha(phone, captcha);
    setAuthState({
      loggedIn: true,
      nickname: res.nickname,
      userId: res.userId ?? null,
      loginMethod: "phone",
      avatarUrl: res.avatarUrl ?? "",
    });
    return res;
  }

  /** 退出登录。*/
  async function logout() {
    try {
      await apiLogout();
    } catch (e) {
      console.warn("[user] 后端 logout 失败，继续清本地状态", e);
    }
    setAuthState({
      loggedIn: false,
      nickname: "",
      userId: null,
      loginMethod: "unknown",
      avatarUrl: "",
    });
  }

  /** 图片加载失败时由 UI 调用，清空头像。 */
  function clearAvatar() {
    avatarUrl.value = "";
  }

  return {
    loggedIn,
    nickname,
    userId,
    loginMethod,
    avatarUrl,
    displayName,
    refresh,
    startQrLogin,
    pollQrLogin,
    loginByAccount,
    sendPhoneCaptcha,
    loginByPhone,
    loginByCookie,
    clearAvatar,
    logout,
  };
});
