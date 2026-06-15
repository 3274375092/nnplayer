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
} from "@/composables/useNcmApi";

export type LoginMethod = "qr" | "account" | "phone" | "cookie" | "unknown";

export const useUserStore = defineStore("user", () => {
  // =============== 状态 ===============

  const loggedIn = ref<boolean>(false);
  const nickname = ref<string>("");
  const userId = ref<number | null>(null);
  const loginMethod = ref<LoginMethod>("unknown");

  const displayName = computed(() =>
    loggedIn.value ? nickname.value || "网易云用户" : "未登录"
  );

  // =============== 会话恢复 ===============

  /**
   * 应用启动时调用：后端的 lib.rs::restore_session 已经把会话读入内存，
   * 这里只是拉取一下显示出来。
   */
  async function refresh() {
    try {
      const s = await getAuthState();
      loggedIn.value = s.loggedIn;
      nickname.value = s.nickname ?? "";
      userId.value = s.userId ?? null;
      loginMethod.value = (s.loginMethod as LoginMethod) ?? "unknown";
    } catch (e) {
      console.warn("[user] refresh 失败", e);
      loggedIn.value = false;
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
   */
  async function pollQrLogin(unikey: string) {
    const res = await loginQrCheck(unikey);
    if (res.code === 803) {
      loggedIn.value = true;
      nickname.value = res.nickname ?? "网易云用户";
      userId.value = res.userId ?? null;
      loginMethod.value = "qr";
    }
    return res;
  }

  /**
   * 账号密码登录。
   * 前端：md5Password 由调用方传入（已 MD5 一次的 32 位小写 hex）。
   */
  async function loginByAccount(account: string, md5Password: string) {
    const res = await loginWithAccount(account, md5Password);
    loggedIn.value = true;
    nickname.value = res.nickname;
    userId.value = res.userId;
    loginMethod.value = "account";
    return res;
  }

  /** 发送手机验证码。*/
  async function sendPhoneCaptcha(phone: string) {
    await loginSendCaptcha(phone);
  }

  /** 手机验证码登录。*/
  async function loginByPhone(phone: string, captcha: string) {
    const res = await loginWithCaptcha(phone, captcha);
    loggedIn.value = true;
    nickname.value = res.nickname;
    userId.value = res.userId;
    loginMethod.value = "phone";
    return res;
  }

  /** 退出登录。*/
  async function logout() {
    try {
      await apiLogout();
    } catch (e) {
      console.warn("[user] 后端 logout 失败，继续清本地状态", e);
    }
    loggedIn.value = false;
    nickname.value = "";
    userId.value = null;
    loginMethod.value = "unknown";
  }

  return {
    loggedIn,
    nickname,
    userId,
    loginMethod,
    displayName,
    refresh,
    startQrLogin,
    pollQrLogin,
    loginByAccount,
    sendPhoneCaptcha,
    loginByPhone,
    logout,
  };
});
