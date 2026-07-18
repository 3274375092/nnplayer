<script setup lang="ts">
// 登录页 - 三个 Tab：
//   1. 二维码登录（自动轮询 1.5s）
//   2. 账号密码登录（邮箱 / 用户名）
//   3. 手机验证码登录（60s 倒计时）
//

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "@/stores/user";
import { isValidEmail, isValidPhone, md5Password } from "@/utils/crypto";

type Tab = "qr" | "account" | "phone";
const tab = ref<Tab>("qr");

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

// =============== 二维码登录状态 ===============

const qr = ref<{ unikey: string; qrUrl: string; qrImage: string | null } | null>(null);
const qrStatus = ref<string>("请使用网易云音乐 App 扫码登录");
const qrLoading = ref(false);
let pollTimer: number | undefined;
let pollGeneration = 0;
let qrLoadSeq = 0;
let disposed = false;

async function loadQr() {
  const seq = ++qrLoadSeq;
  stopPolling();
  qrLoading.value = true;
  try {
    const nextQr = await userStore.startQrLogin();
    if (disposed || seq !== qrLoadSeq || tab.value !== "qr") return;
    qr.value = nextQr;
    qrStatus.value = "请使用网易云音乐 App 扫码登录";
    startPolling();
  } catch (e) {
    if (disposed || seq !== qrLoadSeq) return;
    qrStatus.value = e instanceof Error ? e.message : "二维码加载失败";
    qr.value = null;
  } finally {
    if (seq === qrLoadSeq) qrLoading.value = false;
  }
}

function startPolling() {
  stopPolling();
  if (!qr.value) return;
  const generation = ++pollGeneration;
  const unikey = qr.value.unikey;

  const isActive = () =>
    !disposed && generation === pollGeneration && tab.value === "qr";
  const scheduleNext = () => {
    if (!isActive()) return;
    pollTimer = window.setTimeout(() => void pollOnce(), 1500);
  };
  const pollOnce = async () => {
    if (!isActive()) return;
    try {
      const res = await userStore.pollQrLogin(unikey);
      if (!isActive()) return;
      if (res.code === 800) {
        qrStatus.value = "二维码已过期，正在刷新…";
        stopPolling();
        await loadQr();
        return;
      } else if (res.code === 801) {
        qrStatus.value = "等待扫码…";
      } else if (res.code === 802) {
        qrStatus.value = "已扫码，请在手机上确认";
      } else if (res.code === 803) {
        qrStatus.value = "登录成功，正在跳转…";
        stopPolling();
        redirectAfterLogin();
        return;
      }
    } catch (e) {
      if (!isActive()) return;
      qrStatus.value = e instanceof Error ? e.message : "轮询失败";
    }
    scheduleNext();
  };

  scheduleNext();
}

function stopPolling() {
  pollGeneration += 1;
  if (pollTimer) {
    window.clearTimeout(pollTimer);
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
  if (!accountValid.value || accountLoading.value) return;
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
const captchaSending = ref(false);
let countdownTimer: number | undefined;

async function sendCaptcha() {
  if (!isValidPhone(phone.value)) {
    phoneError.value = "请输入有效的 11 位手机号";
    return;
  }
  if (countdown.value > 0 || captchaSending.value) return;
  phoneError.value = "";
  captchaSending.value = true;
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
  } finally {
    captchaSending.value = false;
  }
}

async function submitPhone() {
  if (!phoneValid.value || phoneLoading.value) return;
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
  const raw = typeof route.query.redirect === "string" ? route.query.redirect : "";
  const redirect = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login")
    ? raw
    : "/daily";
  router.replace(redirect);
}

function switchTab(t: Tab) {
  qrLoadSeq += 1;
  stopPolling();
  tab.value = t;
  // 每次回到 QR 都生成新二维码，避免恢复一个已停止轮询的旧 key。
  if (t === "qr") {
    void loadQr();
  }
}

onMounted(() => {
  disposed = false;
  if (tab.value === "qr") void loadQr();
});

onBeforeUnmount(() => {
  disposed = true;
  qrLoadSeq += 1;
  stopPolling();
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
  <div class="h-full flex items-center justify-center px-6 relative overflow-hidden">
    <!-- 背景装饰 -->
    <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div class="absolute top-1/4 -left-20 w-96 h-96 rounded-full opacity-[0.07] blur-3xl" style="background: radial-gradient(circle, var(--color-accent) 0%, transparent 70%);" />
      <div class="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full opacity-[0.05] blur-3xl" style="background: radial-gradient(circle, var(--color-accent-secondary) 0%, transparent 70%);" />
    </div>

    <div class="card w-full max-w-md p-8 animate-fade-in-up relative z-10">
      <h1 class="text-xl font-semibold mb-1">登录 nnplayer</h1>
      <p class="text-xs text-text-secondary mb-5">
        选择一种登录方式开始使用
      </p>

      <!-- Tab 切换 -->
      <div class="flex gap-1 mb-6 rounded-xl bg-[rgba(255,255,255,0.03)] p-1">
        <button
          v-for="t in [
            { key: 'qr', label: '二维码' },
            { key: 'account', label: '账号密码' },
            { key: 'phone', label: '手机验证' },
          ]"
          :key="t.key"
          class="flex-1 px-3 py-2 text-sm rounded-lg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
          :class="
            tab === t.key
              ? 'bg-accent text-on-accent shadow-lg shadow-accent/25 font-medium'
              : 'text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]'
          "
          @click="switchTab(t.key as Tab)"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- =============== Tab 1: 二维码 =============== -->
      <div v-if="tab === 'qr'" class="flex flex-col items-center">
        <div
          class="w-56 h-56 rounded-xl bg-white p-2 flex items-center justify-center overflow-hidden shadow-lg"
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
            :disabled="!isValidPhone(phone) || countdown > 0 || captchaSending"
            @click="sendCaptcha"
          >
            {{ captchaSending ? "发送中…" : countdown > 0 ? `${countdown}s 后重试` : "发送验证码" }}
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

      <!-- =============== 调试：粘贴 Cookie =============== -->
      <div class="mt-6 pt-4 border-t border-border">
        <button
          class="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
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
