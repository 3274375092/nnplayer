<script setup lang="ts">
// 登录页 - 三个 Tab：
//   1. 二维码登录（自动轮询 1.5s）
//   2. 账号密码登录（邮箱 / 用户名）
//   3. 手机验证码登录（60s 倒计时）
//
// 设计风格沿用 UI 规范：柔和米黄背景 + 12px 圆角 + 橘红强调色。

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "@/stores/user";
import { qqDebugRawQr, qqLoginQrCheck, qqLoginQrKey, qqLoginSetCookie } from "@/composables/useQqApi";
import { isValidEmail, isValidPhone, md5Password } from "@/utils/crypto";

type Tab = "qr" | "account" | "phone" | "qq";
const tab = ref<Tab>("qr");

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

// =============== 二维码登录状态 ===============

const qr = ref<{ unikey: string; qrUrl: string; qrImage: string | null } | null>(null);
const qrStatus = ref<string>("请使用网易云音乐 App 扫码登录");
const qrLoading = ref(false);
let pollTimer: number | undefined;

async function loadQr() {
  qrLoading.value = true;
  try {
    qr.value = await userStore.startQrLogin();
    qrStatus.value = "请使用网易云音乐 App 扫码登录";
    startPolling();
  } catch (e) {
    qrStatus.value = e instanceof Error ? e.message : "二维码加载失败";
    qr.value = null;
  } finally {
    qrLoading.value = false;
  }
}

function startPolling() {
  stopPolling();
  if (!qr.value) return;
  pollTimer = window.setInterval(async () => {
    if (!qr.value) return;
    try {
      const res = await userStore.pollQrLogin(qr.value.unikey);
      if (res.code === 800) {
        qrStatus.value = "二维码已过期，正在刷新…";
        stopPolling();
        await loadQr();
      } else if (res.code === 801) {
        qrStatus.value = "等待扫码…";
      } else if (res.code === 802) {
        qrStatus.value = "已扫码，请在手机上确认";
      } else if (res.code === 803) {
        qrStatus.value = "登录成功，正在跳转…";
        stopPolling();
        redirectAfterLogin();
      }
    } catch (e) {
      qrStatus.value = e instanceof Error ? e.message : "轮询失败";
    }
  }, 1500);
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

// =============== 账号密码登录 ===============

const account = ref("");
const accountPwd = ref("");
const accountLoading = ref(false);
const accountError = ref("");

const accountValid = computed(
  () => account.value.trim().length > 0 && accountPwd.value.length > 0
);

async function submitAccount() {
  if (!accountValid.value) return;
  accountLoading.value = true;
  accountError.value = "";
  try {
    await userStore.loginByAccount(account.value.trim(), md5Password(accountPwd.value));
    redirectAfterLogin();
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : "登录失败";
  } finally {
    accountLoading.value = false;
  }
}

// =============== 手机验证码登录 ===============

const phone = ref("");
const captcha = ref("");
const phoneLoading = ref(false);
const phoneError = ref("");

const phoneValid = computed(() => isValidPhone(phone.value) && captcha.value.length >= 4);

// 60s 倒计时
const countdown = ref(0);
let countdownTimer: number | undefined;

async function sendCaptcha() {
  if (!isValidPhone(phone.value)) {
    phoneError.value = "请输入有效的 11 位手机号";
    return;
  }
  if (countdown.value > 0) return;
  phoneError.value = "";
  try {
    await userStore.sendPhoneCaptcha(phone.value);
    countdown.value = 60;
    countdownTimer = window.setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0 && countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = undefined;
      }
    }, 1000);
  } catch (e) {
    phoneError.value = e instanceof Error ? e.message : "发送失败";
  }
}

async function submitPhone() {
  if (!phoneValid.value) return;
  phoneLoading.value = true;
  phoneError.value = "";
  try {
    await userStore.loginByPhone(phone.value.trim(), captcha.value.trim());
    redirectAfterLogin();
  } catch (e) {
    phoneError.value = e instanceof Error ? e.message : "登录失败";
  } finally {
    phoneLoading.value = false;
  }
}

// =============== 通用 ===============

function redirectAfterLogin() {
  const redirect = (route.query.redirect as string) || "/daily";
  router.replace(redirect);
}

function switchTab(t: Tab) {
  stopPolling();
  stopQrPolling();
  tab.value = t;
  // 切到 QR 时自动加载
  if (t === "qr" && !qr.value) {
    void loadQr();
  }
  // 切到 QQ 时自动加载
  if (t === "qq" && !qqQr.value) {
    void loadQrQq();
  }
}

// =============== QQ 音乐 QR 登录 ===============

const qqQr = ref<{ sessionId: string; qrImage: string } | null>(null);
const qqQrStatus = ref<string>("准备二维码…");
const qqDebugRaw = ref<string>("");
const qqDebugOpen = ref(false);

async function debugFetchRawQr() {
  try {
    qqDebugRaw.value = "请求中…";
    const raw = await qqDebugRawQr();
    qqDebugRaw.value = raw;
  } catch (e) {
    qqDebugRaw.value = `捕获错误: ${e instanceof Error ? e.message : String(e)}`;
  }
}
const qqQrLoading = ref(false);
let qrPollTimer: number | undefined;
let qrRefreshing = false;

async function loadQrQq() {
  qqQrLoading.value = true;
  qqQrStatus.value = "正在生成二维码…";
  try {
    const res = await qqLoginQrKey();
    qqQr.value = res;
    qqQrStatus.value = "请使用 QQ App 扫码登录";
    startQrPolling(res.sessionId);
  } catch (e) {
    console.error("[qq-login] 加载二维码失败:", e);
    qqQrStatus.value = e instanceof Error ? e.message : "二维码加载失败";
    qqQr.value = null;
  } finally {
    qqQrLoading.value = false;
  }
}

function startQrPolling(sessionId: string) {
  stopQrPolling();
  qrPollTimer = window.setInterval(async () => {
    if (!sessionId || qrRefreshing) return;
    try {
      const res = await qqLoginQrCheck(sessionId);
      switch (res.code) {
      case "Success":
          qqQrStatus.value = "登录成功，正在跳转…";
          stopQrPolling();
          if (res.token) {
            userStore.loginQqFromCookie(res.token.cookie, res.token.userId);
          }
          redirectAfterLogin();
          break;
        case "QrCodeExpired":
          qqQrStatus.value = "二维码已过期，正在刷新…";
          stopQrPolling();
          void refreshQrQq();
          break;
        case "WaitingScan":
          qqQrStatus.value = "等待扫码…";
          break;
        case "WaitingConfirm":
          qqQrStatus.value = "已扫码，请在 QQ 上确认";
          break;
        case "Failed":
          qqQrStatus.value = "登录失败，已重试…";
          stopQrPolling();
          void refreshQrQq();
          break;
      }
    } catch (e) {
      qqQrStatus.value = e instanceof Error ? e.message : "轮询失败";
    }
  }, 1500);
}

function stopQrPolling() {
  if (qrPollTimer) {
    window.clearInterval(qrPollTimer);
    qrPollTimer = undefined;
  }
}

async function refreshQrQq() {
  qrRefreshing = true;
  await loadQrQq();
  qrRefreshing = false;
}

// =============== QQ 音乐 cookie 粘贴登录（折叠到高级）===============

const showQqCookie = ref(false);
const qqCookieRaw = ref("");
const qqLoading = ref(false);
const qqError = ref("");

const qqCookieValid = computed(
  () => qqCookieRaw.value.includes("uin=") && qqCookieRaw.value.includes("qqmusic_key="),
);

async function submitQqCookie() {
  if (!qqCookieValid.value) return;
  qqLoading.value = true;
  qqError.value = "";
  try {
    const res = await qqLoginSetCookie(qqCookieRaw.value.trim());
    userStore.loginQqFromCookie(res.cookie, res.userId);
    redirectAfterLogin();
  } catch (e) {
    qqError.value = e instanceof Error ? e.message : "QQ Cookie 登录失败";
  } finally {
    qqLoading.value = false;
  }
}

onMounted(() => {
  if (tab.value === "qr") void loadQr();
});

onBeforeUnmount(() => {
  stopPolling();
  stopQrPolling();
  if (countdownTimer) window.clearInterval(countdownTimer);
});

// =============== 调试用的 Cookie 粘贴入口（隐藏） ===============
const showCookieDebug = ref(false);
const cookieRaw = ref("");
async function submitCookie() {
  if (!cookieRaw.value.includes("MUSIC_U")) {
    accountError.value = "Cookie 中缺少 MUSIC_U";
    return;
  }
  try {
    await userStore.loginByCookie(cookieRaw.value.trim());
    redirectAfterLogin();
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : "Cookie 登录失败";
  }
}

// 触发开发提示：账号输入框支持识别邮箱
const accountHint = computed(() => {
  if (!account.value) return "邮箱 / 用户名";
  if (account.value.includes("@")) {
    return isValidEmail(account.value) ? "✓ 邮箱格式正确" : "邮箱格式有误";
  }
  return "将以用户名登录";
});
</script>

<template>
  <div class="h-full flex items-center justify-center px-6">
    <div class="card w-full max-w-md p-8">
      <h1 class="text-xl font-semibold mb-1">登录 nnplayer</h1>
      <p class="text-xs text-text-secondary mb-5">
        选择一种登录方式开始使用
      </p>

      <!-- Tab 切换 -->
      <div class="flex gap-2 mb-6 border-b border-hover">
        <button
          v-for="t in [
            { key: 'qr', label: '网易云·二维码' },
            { key: 'account', label: '网易云·账号' },
            { key: 'phone', label: '网易云·手机' },
            { key: 'qq', label: 'QQ 音乐' },
          ]"
          :key="t.key"
          class="px-4 py-2 text-sm transition-colors"
          :class="
            tab === t.key
              ? 'text-accent border-b-2 border-accent font-medium'
              : 'text-text-secondary hover:text-text-primary'
          "
          @click="switchTab(t.key as Tab)"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- =============== Tab 1: 二维码 =============== -->
      <div v-if="tab === 'qr'" class="flex flex-col items-center">
        <div
          class="w-56 h-56 rounded-card bg-white p-2 flex items-center justify-center overflow-hidden"
        >
          <img
            v-if="qr?.qrImage"
            :src="qr.qrImage"
            alt="登录二维码"
            class="w-full h-full"
          />
          <span v-else-if="qrLoading" class="text-text-secondary text-xs">加载中…</span>
          <span v-else class="text-text-secondary text-xs">二维码加载失败</span>
        </div>
        <div class="mt-4 text-xs text-text-secondary text-center">
          {{ qrStatus }}
        </div>
        <button class="btn btn-ghost mt-3 text-xs" @click="loadQr">
          刷新二维码
        </button>
        <div class="mt-4 text-[11px] text-text-secondary text-center leading-relaxed">
          打开网易云音乐 App<br />扫一扫即可登录
        </div>
      </div>

      <!-- =============== Tab 2: 账号密码 =============== -->
      <form v-else-if="tab === 'account'" @submit.prevent="submitAccount">
        <label class="block text-xs text-text-secondary mb-1">
          {{ accountHint }}
        </label>
        <input
          v-model="account"
          type="text"
          class="input mb-3"
          placeholder="邮箱 / 用户名"
          autocomplete="username"
        />

        <label class="block text-xs text-text-secondary mb-1">密码</label>
        <input
          v-model="accountPwd"
          type="password"
          class="input mb-3"
          placeholder="请输入密码"
          autocomplete="current-password"
        />

        <div v-if="accountError" class="text-xs text-accent mb-2">
          {{ accountError }}
        </div>

        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="!accountValid || accountLoading"
        >
          {{ accountLoading ? "登录中…" : "登录" }}
        </button>
      </form>

      <!-- =============== Tab 3: 手机验证码 =============== -->
      <form v-else-if="tab === 'phone'" @submit.prevent="submitPhone">
        <label class="block text-xs text-text-secondary mb-1">手机号</label>
        <input
          v-model="phone"
          type="tel"
          class="input mb-3"
          placeholder="11 位手机号"
          maxlength="11"
          autocomplete="tel"
        />

        <label class="block text-xs text-text-secondary mb-1">验证码</label>
        <div class="flex gap-2 mb-3">
          <input
            v-model="captcha"
            type="text"
            class="input flex-1"
            placeholder="6 位验证码"
            maxlength="6"
            autocomplete="one-time-code"
          />
          <button
            type="button"
            class="btn btn-ghost shrink-0 px-3 text-xs"
            :disabled="!isValidPhone(phone) || countdown > 0"
            @click="sendCaptcha"
          >
            {{ countdown > 0 ? `${countdown}s 后重试` : "发送验证码" }}
          </button>
        </div>

        <div v-if="phoneError" class="text-xs text-accent mb-2">
          {{ phoneError }}
        </div>

        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="!phoneValid || phoneLoading"
        >
          {{ phoneLoading ? "登录中…" : "登录" }}
        </button>
      </form>

      <!-- =============== Tab 4: QQ 音乐（QR + 高级 cookie）=============== -->
      <div v-else-if="tab === 'qq'" class="flex flex-col items-center">
        <!-- QR 区域 -->
        <div
          class="w-56 h-56 rounded-card bg-white p-2 flex items-center justify-center overflow-hidden"
        >
          <img
            v-if="qqQr?.qrImage"
            :src="qqQr.qrImage"
            alt="QQ 登录二维码"
            class="w-full h-full"
          />
          <span v-else-if="qqQrLoading" class="text-text-secondary text-xs">加载中…</span>
          <span v-else class="text-text-secondary text-xs">二维码加载失败</span>
        </div>
        <div class="mt-4 text-xs text-text-secondary text-center">
          {{ qqQrStatus }}
        </div>
        <button class="btn btn-ghost mt-3 text-xs" @click="loadQrQq">
          刷新二维码
        </button>
        <div class="mt-4 text-[11px] text-text-secondary text-center leading-relaxed">
          打开 QQ App<br />扫一扫即可登录
        </div>

        <!-- 调试：查看原始 API 响应（排查二维码加载失败时用） -->
        <div class="mt-6 pt-4 border-t border-hover w-full">
          <button
            class="text-[11px] text-text-secondary hover:text-text-primary"
            @click="qqDebugOpen = !qqDebugOpen"
          >
            {{ qqDebugOpen ? "收起" : "调试" }}：查看 QQ API 原始响应
          </button>
          <div v-if="qqDebugOpen" class="mt-2">
            <button class="btn btn-ghost text-xs mb-2" @click="debugFetchRawQr">
              获取原始响应
            </button>
            <pre
              v-if="qqDebugRaw"
              class="text-[10px] font-mono bg-white/50 p-2 rounded-btn overflow-auto max-h-40 whitespace-pre-wrap break-all"
            >{{ qqDebugRaw }}</pre>
            <p v-else class="text-[10px] text-text-secondary">
              点击"获取原始响应"查看 QQ API 返回内容
            </p>
          </div>
        </div>

        <!-- 高级：cookie 粘贴 -->
        <div class="mt-6 pt-4 border-t border-hover w-full">
          <button
            class="text-[11px] text-text-secondary hover:text-text-primary"
            @click="showQqCookie = !showQqCookie"
          >
            {{ showQqCookie ? "收起" : "高级" }}：粘贴 Cookie 登录
          </button>
          <div v-if="showQqCookie" class="mt-2">
            <label class="block text-xs text-text-secondary mb-1">
              在浏览器登录
              <a
                href="https://y.qq.com"
                target="_blank"
                rel="noopener"
                class="text-accent hover:underline"
              >QQ 音乐网页版</a>，DevTools → Network → 复制
              <code class="text-[10px] bg-hover px-1 rounded">Cookie</code>。
            </label>
            <textarea
              v-model="qqCookieRaw"
              rows="3"
              class="input font-mono text-[11px] resize-none"
              placeholder="uin=12345; qqmusic_key=xxx; qm_keyst=xxx; tmeLoginType=6"
            />
            <div v-if="qqError" class="text-xs text-accent mb-1 mt-1">
              {{ qqError }}
            </div>
            <button
              class="btn btn-ghost w-full mt-2 text-xs"
              :disabled="!qqCookieValid || qqLoading"
              @click="submitQqCookie"
            >
              {{ qqLoading ? "登录中…" : "使用 Cookie 登录" }}
            </button>
          </div>
        </div>
      </div>

      <!-- =============== 调试：粘贴 Cookie =============== -->
      <div class="mt-6 pt-4 border-t border-hover">
        <button
          class="text-[11px] text-text-secondary hover:text-text-primary"
          @click="showCookieDebug = !showCookieDebug"
        >
          {{ showCookieDebug ? "收起" : "高级" }}：粘贴 Cookie 登录
        </button>
        <div v-if="showCookieDebug" class="mt-2">
          <textarea
            v-model="cookieRaw"
            rows="3"
            class="input font-mono text-[11px] resize-none"
            placeholder="MUSIC_U=xxx; __csrf=xxx; ..."
          />
          <button
            class="btn btn-ghost w-full mt-2 text-xs"
            :disabled="!cookieRaw.includes('MUSIC_U')"
            @click="submitCookie"
          >
            使用 Cookie 登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>