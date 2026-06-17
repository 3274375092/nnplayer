// 用户登录态 Pinia Store。
// 设计：同一时间只能登录一个平台（NCM 或 QQ），不允许多平台同时在线。
// activePlatform 决定当前 API 路由，简洁且不存在双状态不一致问题。
//
// 流程：
//   1. 启动时 refresh() 先后拉取 NCM/QQ 后端，取"当前有登录态的那个"设为 active
//   2. 用户登录 NCM → activePlatform = 'netease'
//   3. 用户登录 QQ  → activePlatform = 'qq'
//   4. 用户退出任何平台 → activePlatform = null（完全登出）

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
import {
  qqGetAuthState,
  qqLoginSetCookie,
  qqLogout as apiQqLogout,
} from "@/composables/useQqApi";

export type LoginMethod = "qr" | "account" | "phone" | "cookie" | "unknown" | "failed";

export const useUserStore = defineStore("user", () => {
  // =============== 状态 ===============

  /** 当前活跃平台。null 表示未登录。 */
  const activePlatform = ref<"netease" | "qq" | null>(null);

  // — NCM 字段（仅 activePlatform='netease' 时有意义）
  const nickname = ref<string>("");
  const userId = ref<number | null>(null);
  const loginMethod = ref<LoginMethod>("unknown");
  const avatarUrl = ref<string>("");

  // — QQ 字段（仅 activePlatform='qq' 时有意义）
  const qqUserId = ref<number | null>(null);
  const qqCookie = ref<string>("");

  // =============== 计算属性 ===============

  const loggedIn = computed(() => activePlatform.value !== null);

  const displayName = computed(() => {
    if (activePlatform.value === "netease") return nickname.value || "网易云用户";
    if (activePlatform.value === "qq") return `QQ 用户 ${qqUserId.value ?? ""}`;
    return "未登录";
  });

  // =============== 登录/登出 ===============

  /** NCM 登录成功。清除 QQ 状态，设 activePlatform='netease'。 */
  function loginNetease(opts: {
    nickname: string;
    userId: number | null;
    avatarUrl: string;
    loginMethod: LoginMethod;
  }) {
    activePlatform.value = "netease";
    nickname.value = opts.nickname;
    userId.value = opts.userId;
    loginMethod.value = opts.loginMethod;
    avatarUrl.value = opts.avatarUrl;
    // 清除 QQ
    qqUserId.value = null;
    qqCookie.value = "";
  }

  /** QQ 登录成功。清除 NCM 状态，设 activePlatform='qq'。 */
  function loginQq(opts: { userId: number | null; cookie: string }) {
    activePlatform.value = "qq";
    qqUserId.value = opts.userId;
    qqCookie.value = opts.cookie;
    // 清除 NCM
    nickname.value = "";
    userId.value = null;
    loginMethod.value = "unknown";
    avatarUrl.value = "";
  }

  /** 完全登出。 */
  function logout() {
    activePlatform.value = null;
    nickname.value = "";
    userId.value = null;
    loginMethod.value = "unknown";
    avatarUrl.value = "";
    qqUserId.value = null;
    qqCookie.value = "";
  }

  // =============== 会话恢复 ===============

  let refreshPromise: Promise<void> | null = null;

  /**
   * 应用启动时调一次，扫描 NCM / QQ 后端，取"当前有登录态的那个"设为 active。
   * 两个端都试，先试 NCM（取到后就不再试 QQ）。
   */
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
    // 先试 NCM
    try {
      const s = await getAuthState();
      if (s.loggedIn) {
        loginNetease({
          nickname: s.nickname ?? "网易云用户",
          userId: s.userId ?? null,
          avatarUrl: s.avatarUrl ?? "",
          loginMethod: (s.loginMethod as LoginMethod) ?? "unknown",
        });
        return;
      }
    } catch {
      // fall through
    }

    // NCM 未登录，试 QQ
    try {
      const s = await qqGetAuthState();
      if (s.loggedIn) {
        loginQq({
          userId: s.userId ?? null,
          cookie: s.cookie ?? "",
        });
        return;
      }
    } catch {
      // fall through
    }

    // 都未登录
    logout();
  }

  // =============== NCM 登录入口 ===============

  async function startQrLogin(): Promise<{ unikey: string; qrUrl: string; qrImage: string | null }> {
    return loginQrKey();
  }

  async function pollQrLogin(unikey: string) {
    const res = await loginQrCheck(unikey);
    if (res.code === 803) {
      loginNetease({
        nickname: res.nickname ?? "网易云用户",
        userId: res.userId ?? null,
        avatarUrl: res.avatarUrl ?? "",
        loginMethod: "qr",
      });
    }
    return res;
  }

  async function loginByAccount(account: string, md5Password: string) {
    const res = await loginWithAccount(account, md5Password);
    loginNetease({
      nickname: res.nickname,
      userId: res.userId ?? null,
      avatarUrl: res.avatarUrl ?? "",
      loginMethod: "account",
    });
    return res;
  }

  async function loginByCookie(cookie: string) {
    const res = await saveCookie(cookie);
    loginNetease({
      nickname: res.nickname,
      userId: res.userId ?? null,
      avatarUrl: res.avatarUrl ?? "",
      loginMethod: "cookie",
    });
    return res;
  }

  async function sendPhoneCaptcha(phone: string) {
    await loginSendCaptcha(phone);
  }

  async function loginByPhone(phone: string, captcha: string) {
    const res = await loginWithCaptcha(phone, captcha);
    loginNetease({
      nickname: res.nickname,
      userId: res.userId ?? null,
      avatarUrl: res.avatarUrl ?? "",
      loginMethod: "phone",
    });
    return res;
  }

  // =============== QQ 登录入口 ===============

  /** QQ 从 QR 成功或 cookie 粘贴统一走这个（后端已持久化）。 */
  function loginQqFromCookie(cookie: string, userId: number) {
    loginQq({ userId, cookie });
  }

  // =============== 退出 ===============

  async function doLogout() {
    if (activePlatform.value === "netease") {
      try {
        await apiLogout();
      } catch (e) {
        console.warn("[user] NCM 后端 logout 失败", e);
      }
    } else if (activePlatform.value === "qq") {
      try {
        await apiQqLogout();
      } catch (e) {
        console.warn("[user] QQ 后端 logout 失败", e);
      }
    }
    logout();
  }

  /** 图片加载失败时由 UI 调用。 */
  function clearAvatar() {
    avatarUrl.value = "";
  }

  return {
    activePlatform,
    loggedIn,
    nickname,
    userId,
    loginMethod,
    avatarUrl,
    displayName,
    qqUserId,
    qqCookie,
    refresh,
    loginNetease,
    loginQq,
    loginQqFromCookie,
    startQrLogin,
    pollQrLogin,
    loginByAccount,
    loginByCookie,
    sendPhoneCaptcha,
    loginByPhone,
    doLogout,
    clearAvatar,
  };
});
