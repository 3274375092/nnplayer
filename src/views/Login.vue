<script setup lang="ts">
// 登录页 - 三个 Tab：
//   1. 二维码登录（自动轮询 1.5s）
//   2. 账号密码登录（邮箱 / 用户名）
//   3. 手机验证码登录（60s 倒计时）
//

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "@/stores/user";
import { describeAppError, describeInputError, describeLoginError } from "@/utils/appErrors";
import type { UserFacingError } from "@/utils/appErrors";
import { isValidEmail, isValidPhone, md5Password } from "@/utils/crypto";

type Tab = "qr" | "account" | "phone";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "qr", label: "扫码登录" },
  { key: "account", label: "账号密码" },
  { key: "phone", label: "手机验证码" },
];
const tab = ref<Tab>("qr");

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

/** 从受保护页面被守卫重定向过来时，明确告诉用户为什么回到登录页。 */
const loginHint = computed(() =>
  typeof route.query.redirect === "string" && route.query.redirect.length > 0
    ? "登录后才能继续使用；登录后会回到刚才的页面。"
    : "",
);

// =============== 二维码登录状态 ===============

const qr = ref<{ unikey: string; qrUrl: string; qrImage: string | null } | null>(null);
const qrStatus = ref<string>("");
/** 二维码接口失败时的人话错误；技术原文收在可折叠详情里。 */
const qrError = ref<UserFacingError | null>(null);
const qrLoading = ref(false);
let pollTimer: number | undefined;
let pollGeneration = 0;
let qrLoadSeq = 0;
let disposed = false;

async function loadQr() {
  const seq = ++qrLoadSeq;
  stopPolling();
  qrLoading.value = true;
  qrError.value = null;
  qrStatus.value = "";
  try {
    const nextQr = await userStore.startQrLogin();
    if (disposed || seq !== qrLoadSeq || tab.value !== "qr") return;
    qr.value = nextQr;
    qrError.value = null;
    // 图片渲染失败时服务端仍会返回 unikey；此时不能再说「请扫码」，
    // 否则界面一边说没有二维码、一边让用户去扫。
    qrStatus.value = nextQr.qrImage
      ? "请使用网易云音乐 App 扫码登录"
      : "二维码图片没有生成，请刷新二维码后重试。";
    startPolling();
  } catch (e) {
    if (disposed || seq !== qrLoadSeq) return;
    // 失败原因由下方错误块说明，状态行不再重复「加载失败」。
    qrError.value = describeAppError(e);
    qrStatus.value = "";
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
      qrError.value = null;
      if (res.code === 800) {
        qrStatus.value = "二维码已过期，正在刷新…";
        stopPolling();
        await loadQr();
        return;
      } else if (res.code === 801) {
        qrStatus.value = "请使用网易云音乐 App 扫码登录";
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
      // 轮询失败保留自动重试，但把原因告诉用户，不能只显示「等待扫码」。
      qrError.value = describeAppError(e);
      qrStatus.value = "扫码状态获取失败，正在重试…";
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
const accountError = ref<UserFacingError | null>(null);

const accountValid = computed(
  () => account.value.trim().length > 0 && accountPwd.value.length > 0
);

async function submitAccount() {
  if (!accountValid.value || accountLoading.value) return;
  const accountValue = account.value.trim();
  if (accountValue.includes("@") && !isValidEmail(accountValue)) {
    accountError.value = describeInputError("邮箱格式不正确，请检查后重试");
    return;
  }
  accountLoading.value = true;
  accountError.value = null;
  try {
    await userStore.loginByAccount(accountValue, md5Password(accountPwd.value));
    redirectAfterLogin();
  } catch (e) {
    accountError.value = describeLoginError(e, "account");
  } finally {
    accountLoading.value = false;
  }
}

// =============== 手机验证码登录 ===============

const phone = ref("");
const captcha = ref("");
const phoneLoading = ref(false);
const phoneError = ref<UserFacingError | null>(null);

const phoneValid = computed(() => isValidPhone(phone.value) && captcha.value.length >= 4);

// 60s 倒计时
const countdown = ref(0);
const captchaSending = ref(false);
let countdownTimer: number | undefined;

async function sendCaptcha() {
  if (!isValidPhone(phone.value)) {
    phoneError.value = describeInputError("请输入有效的 11 位手机号");
    return;
  }
  if (countdown.value > 0 || captchaSending.value) return;
  phoneError.value = null;
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
    phoneError.value = describeLoginError(e, "phone");
  } finally {
    captchaSending.value = false;
  }
}

async function submitPhone() {
  if (!phoneValid.value || phoneLoading.value) return;
  phoneLoading.value = true;
  phoneError.value = null;
  try {
    await userStore.loginByPhone(phone.value.trim(), captcha.value.trim());
    redirectAfterLogin();
  } catch (e) {
    phoneError.value = describeLoginError(e, "phone");
  } finally {
    phoneLoading.value = false;
  }
}

// =============== 通用 ===============

function redirectAfterLogin() {
  const raw = typeof route.query.redirect === "string" ? route.query.redirect : "";
  let target = "/daily";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login")) {
    try {
      // 浏览器会把 '\' 归一化为 '/'，必须校验解析后的来源是否同源
      const url = new URL(raw.replace(/\\/g, "/"), window.location.origin);
      if (url.origin === window.location.origin) target = raw;
    } catch {
      target = "/daily";
    }
  }
  router.replace(target);
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

/** 标准 tab 键盘语义：左右方向键循环，Home/End 跳到首尾。 */
function onTabKeydown(e: KeyboardEvent, index: number) {
  let nextIndex: number | null = null;
  if (e.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
  else if (e.key === "ArrowLeft") {
    nextIndex = (index - 1 + TABS.length) % TABS.length;
  } else if (e.key === "Home") nextIndex = 0;
  else if (e.key === "End") nextIndex = TABS.length - 1;
  if (nextIndex === null) return;
  e.preventDefault();
  const next = TABS[nextIndex]!;
  switchTab(next.key);
  void nextTick(() => {
    document.getElementById(`login-tab-${next.key}`)?.focus();
  });
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

// =============== 高级：粘贴 Cookie 登录 ===============
const showCookieDebug = ref(false);
const cookieRaw = ref("");
const cookieError = ref<UserFacingError | null>(null);
async function submitCookie() {
  if (!cookieRaw.value.includes("MUSIC_U")) {
    cookieError.value = describeInputError(
      "Cookie 中缺少 MUSIC_U，请粘贴包含 MUSIC_U 的完整 Cookie",
    );
    return;
  }
  cookieError.value = null;
  try {
    await userStore.loginByCookie(cookieRaw.value.trim());
    redirectAfterLogin();
  } catch (e) {
    cookieError.value = describeLoginError(e, "cookie");
  }
}
</script>

<template>
  <!-- 512 CSS 高的验收基线里卡片比视口高：页面本身负责滚动（overflow-y-auto），
       卡片用 my-auto 在装得下时垂直居中、装不下时 auto 外边距归零从顶部开始，
       避免 flex 居中 + 滚动容器把卡片顶端裁到不可滚区域。 -->
  <div class="h-full flex justify-center px-6 py-6 relative overflow-x-hidden overflow-y-auto">
    <!-- 背景装饰 -->
    <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div class="absolute top-1/4 -left-20 w-96 h-96 rounded-full opacity-[0.07] blur-3xl" style="background: radial-gradient(circle, var(--color-ambient-primary) 0%, transparent 70%);" />
      <div class="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full opacity-[0.05] blur-3xl" style="background: radial-gradient(circle, var(--color-ambient-secondary) 0%, transparent 70%);" />
    </div>

    <div class="login-panel my-auto w-full max-w-md p-8 animate-fade-in-up relative z-10">
      <h1 class="text-xl font-semibold mb-1">登录 nnplayer</h1>
      <p v-if="loginHint" class="text-xs text-text-secondary mb-5">
        {{ loginHint }}
      </p>
      <div v-else class="mb-5"></div>

      <!-- Tab 切换 -->
      <div role="tablist" aria-label="登录方式" class="flex gap-1 mb-6 rounded-xl bg-surface-soft p-1">
        <button
          v-for="(t, i) in TABS"
          :id="`login-tab-${t.key}`"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          :aria-controls="`login-panel-${t.key}`"
          :tabindex="tab === t.key ? 0 : -1"
          class="flex-1 px-3 py-2 text-sm rounded-lg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
          :class="
            tab === t.key
              ? 'bg-accent text-on-accent shadow-[0_8px_24px_var(--color-glow)] font-medium'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-strong'
          "
          @click="switchTab(t.key)"
          @keydown="onTabKeydown($event, i)"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- =============== Tab 1: 二维码 =============== -->
      <div
        v-if="tab === 'qr'"
        id="login-panel-qr"
        role="tabpanel"
        aria-labelledby="login-tab-qr"
        tabindex="0"
        class="flex flex-col items-center"
      >
        <div
          class="login-qr rounded-xl bg-white p-2 flex items-center justify-center overflow-hidden"
        >
          <img
            v-if="qr?.qrImage"
            :src="qr.qrImage"
            alt="网易云音乐登录二维码"
            class="w-full h-full"
          />
          <span v-else-if="qrLoading" class="text-text-secondary text-xs" role="status">正在获取二维码…</span>
          <span v-else class="text-text-secondary text-xs">二维码暂不可用</span>
        </div>
        <p
          v-if="qrStatus"
          class="mt-4 text-xs text-text-secondary text-center"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ qrStatus }}
        </p>
        <div
          v-if="qrError"
          class="login-inline-error mt-3"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <p class="login-error-title">{{ qrError.title }}</p>
          <p v-if="qrError.hint" class="login-error-hint">{{ qrError.hint }}</p>
          <div v-if="qrError.retryable" class="login-error-actions">
            <button type="button" class="btn btn-ghost" :disabled="qrLoading" @click="loadQr">
              刷新二维码
            </button>
          </div>
          <details v-if="qrError.detail" class="login-error-detail">
            <summary>技术详情</summary>
            <code>{{ qrError.detail }}</code>
          </details>
        </div>
        <button
          v-if="!qrError"
          class="btn btn-ghost mt-3"
          type="button"
          :disabled="qrLoading"
          @click="loadQr"
        >
          刷新二维码
        </button>
      </div>

      <!-- =============== Tab 2: 账号密码 =============== -->
      <form
        v-else-if="tab === 'account'"
        id="login-panel-account"
        role="tabpanel"
        aria-labelledby="login-tab-account"
        tabindex="0"
        @submit.prevent="submitAccount"
      >
        <label for="login-account" class="block text-xs text-text-secondary mb-1">
          邮箱或用户名
        </label>
        <input
          id="login-account"
          v-model="account"
          type="text"
          class="input mb-3"
          placeholder="name@example.com 或用户名"
          autocomplete="username"
          :aria-invalid="accountError ? 'true' : undefined"
          :aria-describedby="accountError ? 'login-account-error' : undefined"
        />

        <label for="login-password" class="block text-xs text-text-secondary mb-1">密码</label>
        <input
          id="login-password"
          v-model="accountPwd"
          type="password"
          class="input mb-3"
          autocomplete="current-password"
          :aria-invalid="accountError ? 'true' : undefined"
          :aria-describedby="accountError ? 'login-account-error' : undefined"
        />

        <!-- 常驻错误节点：错误文案注入这个始终挂载的 assertive region，提交失败
             时照旧朗读，之后重新进入任一输入框也能经 aria-describedby 再读到。
             两个字段共用一份表单级错误（后端只说「账号或密码不正确」，无法归因
             到单个字段）。 -->
        <div
          id="login-account-error"
          :class="accountError ? 'login-inline-error mb-3' : ''"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <p v-if="accountError" class="login-error-title">{{ accountError.title }}</p>
          <p v-if="accountError?.hint" class="login-error-hint">
            {{ accountError.hint }}
          </p>
          <details v-if="accountError?.detail" class="login-error-detail">
            <summary>技术详情</summary>
            <code>{{ accountError.detail }}</code>
          </details>
        </div>

        <!-- 提交按钮未填完整时保持 disabled，但把「缺什么」写成常驻可见、并被
             aria-describedby 关联的说明，替代此前静默禁用。 -->
        <p
          v-if="!accountValid && !accountLoading"
          id="login-account-submit-hint"
          class="login-field-help"
        >
          请填写邮箱或用户名和密码后再登录。
        </p>

        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="!accountValid || accountLoading"
          :aria-describedby="
            !accountValid && !accountLoading
              ? 'login-account-submit-hint'
              : undefined
          "
        >
          {{ accountLoading ? "登录中…" : "登录" }}
        </button>
      </form>

      <!-- =============== Tab 3: 手机验证码 =============== -->
      <form
        v-else-if="tab === 'phone'"
        id="login-panel-phone"
        role="tabpanel"
        aria-labelledby="login-tab-phone"
        tabindex="0"
        @submit.prevent="submitPhone"
      >
        <label for="login-phone" class="block text-xs text-text-secondary mb-1">手机号</label>
        <input
          id="login-phone"
          v-model="phone"
          type="tel"
          class="input mb-3"
          placeholder="11 位手机号"
          maxlength="11"
          autocomplete="tel"
          :aria-invalid="phoneError ? 'true' : undefined"
          :aria-describedby="phoneError ? 'login-phone-error' : undefined"
        />

        <label for="login-captcha" class="block text-xs text-text-secondary mb-1">验证码</label>
        <div class="flex gap-2 mb-3">
          <input
            id="login-captcha"
            v-model="captcha"
            type="text"
            class="input flex-1"
            placeholder="4–6 位数字"
            maxlength="6"
            autocomplete="one-time-code"
            :aria-invalid="phoneError ? 'true' : undefined"
            :aria-describedby="phoneError ? 'login-phone-error' : undefined"
          />
          <button
            type="button"
            class="btn btn-ghost shrink-0 px-3"
            :disabled="!isValidPhone(phone) || countdown > 0 || captchaSending"
            @click="sendCaptcha"
          >
            {{ captchaSending ? "发送中…" : countdown > 0 ? `${countdown}s 后重试` : "发送验证码" }}
          </button>
        </div>

        <!-- 与账号表单同一套常驻错误节点：读屏可重复读取，两个字段共享表单级错误。 -->
        <div
          id="login-phone-error"
          :class="phoneError ? 'login-inline-error mb-3' : ''"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <p v-if="phoneError" class="login-error-title">{{ phoneError.title }}</p>
          <p v-if="phoneError?.hint" class="login-error-hint">
            {{ phoneError.hint }}
          </p>
          <details v-if="phoneError?.detail" class="login-error-detail">
            <summary>技术详情</summary>
            <code>{{ phoneError.detail }}</code>
          </details>
        </div>

        <p
          v-if="!phoneValid && !phoneLoading"
          id="login-phone-submit-hint"
          class="login-field-help"
        >
          请填写有效的 11 位手机号和验证码后再登录。
        </p>

        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="!phoneValid || phoneLoading"
          :aria-describedby="
            !phoneValid && !phoneLoading
              ? 'login-phone-submit-hint'
              : undefined
          "
        >
          {{ phoneLoading ? "登录中…" : "登录" }}
        </button>
      </form>

      <!-- =============== 高级：粘贴 Cookie =============== -->
      <div class="mt-6 pt-4">
        <button
          type="button"
          class="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          @click="showCookieDebug = !showCookieDebug"
        >
          {{ showCookieDebug ? "收起高级登录" : "高级登录：使用 Cookie" }}
        </button>
        <div v-if="showCookieDebug" class="mt-2">
          <label for="login-cookie" class="block text-xs text-text-secondary mb-1">
            Cookie（需包含 MUSIC_U）
          </label>
          <p id="login-cookie-help" class="text-[11px] text-text-secondary mb-2 leading-relaxed">
            从已登录网易云音乐的浏览器中复制完整 Cookie，粘贴到这里。
          </p>
          <textarea
            id="login-cookie"
            v-model="cookieRaw"
            rows="3"
            class="input font-mono text-[11px] resize-none"
            placeholder="MUSIC_U=xxx; __csrf=xxx; ..."
            :aria-invalid="cookieError ? 'true' : undefined"
            :aria-describedby="
              cookieError
                ? 'login-cookie-help login-cookie-error'
                : 'login-cookie-help'
            "
          />
          <div
            id="login-cookie-error"
            :class="cookieError ? 'login-inline-error mt-2' : ''"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <p v-if="cookieError" class="login-error-title">{{ cookieError.title }}</p>
            <p v-if="cookieError?.hint" class="login-error-hint">
              {{ cookieError.hint }}
            </p>
            <details v-if="cookieError?.detail" class="login-error-detail">
              <summary>技术详情</summary>
              <code>{{ cookieError.detail }}</code>
            </details>
          </div>
          <button
            type="button"
            class="btn btn-ghost w-full mt-2"
            :disabled="!cookieRaw.includes('MUSIC_U')"
            :aria-describedby="
              !cookieRaw.includes('MUSIC_U') ? 'login-cookie-help' : undefined
            "
            @click="submitCookie"
          >
            使用 Cookie 登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-panel {
  border-radius: 12px;
  background: var(--color-raised);
  box-shadow: var(--shadow-floating);
}

/* 二维码外框沿用 Floating 阴影（Two-Shadow Rule），不再用 Tailwind 的黑色
   shadow-lg。bg-white 是二维码静区（quiet zone）的扫描要求，不属于纸面配色，
   因此保留纯白而不是换成 raised-paper。 */
.login-qr {
  width: 14rem;
  height: 14rem;
  box-shadow: var(--shadow-floating);
}

/* 矮窗（512 CSS 高验收基线）里 224px 的二维码会把卡片顶到滚不到的位置；
   收一档到 160px，既保住扫描尺寸，又让卡片首尾都能滚到。 */
@media (max-height: 560px) {
  .login-qr {
    width: 10rem;
    height: 10rem;
  }
}

/* 登录表单的常驻说明文字：和错误一样紧贴对应控件，不占用标签位置。
   直接给底部间距（scoped 样式在 cascade layer 之外，会盖掉 Tailwind 的 mb-2）。 */
.login-field-help {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

/* 登录页内联错误：陶土色小字为主，恢复方式与原始详情分开层级。 */
.login-inline-error {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  text-align: left;
}

.login-error-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent);
}

.login-error-hint {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.login-error-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.login-error-detail {
  margin-top: 8px;
}

.login-error-detail summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.login-error-detail summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

.login-error-detail code {
  display: block;
  margin-top: 6px;
  max-height: 96px;
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: var(--color-raised);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
