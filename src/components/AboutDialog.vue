<script setup lang="ts">
// 关于/帮助弹层：版本、非官方声明、全局快捷键、托盘驻留说明、检查更新、
// 许可证与仓库链接。可发现性入口由 Sidebar 的品牌区提供。
// - 检查更新后由用户确认再下载安装；Linux deb/rpm 可能请求管理员授权；
// - 外链统一经 tauri-plugin-opener 交给系统浏览器打开；
// - dialog 语义 + Esc + Tab 焦点循环 + 关闭后焦点归还触发按钮。

import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import {
  CircleCheck,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  X,
} from "@lucide/vue";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DownloadEvent,
  Update as UpdaterUpdate,
} from "@tauri-apps/plugin-updater";
import { isUnsupportedPlatformError } from "@/utils/updateErrors";
import { downloadPercent } from "@/utils/updateProgress";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

/** 构建版本号由 vite 从 package.json 注入（__APP_VERSION__）；getVersion 失败时回退到它。
 *  不写死字符串：硬编码会在发版后把 v0.4.0 报成旧版本，违背状态诚实原则。 */
const FALLBACK_VERSION = __APP_VERSION__;
const REPO_URL = "https://github.com/3274375092/nnplayer";
const RELEASES_URL = `${REPO_URL}/releases/latest`;

type UpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "installing"
  | "download-error"
  | "install-error"
  | "installed"
  | "unsupported"
  | "error";

const SHORTCUTS = [
  { label: "播放 / 暂停", keys: ["Ctrl", "Alt", "P"] },
  { label: "上一首", keys: ["Ctrl", "Alt", "←"] },
  { label: "下一首", keys: ["Ctrl", "Alt", "→"] },
  { label: "桌面歌词开关", keys: ["Ctrl", "Alt", "L"] },
] as const;

const version = ref(FALLBACK_VERSION);
const versionLoaded = ref(false);
const updateStatus = ref<UpdateStatus>("idle");
const latestVersion = ref("");
/** 当前可安装的更新句柄；check 成功后保留，安装失败时可重试。 */
// Update 是带私有字段的 Tauri Resource，用 shallowRef 避免 Vue 深解包破坏类型。
const pendingUpdate = shallowRef<UpdaterUpdate | null>(null);
const downloadProgress = ref<number | null>(null);
/** 安装包是否已下载完成：决定失败后是「重试下载」还是「重试安装」。 */
const updateDownloaded = ref(false);
/** 安装/重启动作失败时的固定区提示；外链错误仍用 externalError。 */
const updateActionError = ref("");
/** 外链打开失败时给出手动地址，不让按钮静默失效。 */
const externalError = ref("");

const panelRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
let lastActiveElement: HTMLElement | null = null;

const updateSummary = computed(() => {
  switch (updateStatus.value) {
    case "checking":
      return "正在检查更新…";
    case "latest":
      return `已是最新版本（v${version.value}）`;
    case "available":
      return `发现新版本 v${latestVersion.value}（当前 v${version.value}）`;
    case "downloading":
      return downloadProgress.value === null
        ? "正在下载更新…"
        : `正在下载更新… ${downloadProgress.value}%`;
    case "installing":
      return "正在安装更新，可能需要管理员授权…";
    case "download-error":
      return "下载更新失败，请检查网络后重试。";
    case "install-error":
      return "安装更新失败，请重试或前往发布页手动安装。";
    case "installed":
      return "更新已安装，请重启应用完成升级。";
    case "unsupported":
      return "当前平台不在更新清单中，请前往发布页查看最新版本。";
    case "error":
      return "检查更新失败，请稍后重试，或前往发布页查看最新版本。";
    default:
      return "还没有检查更新。";
  }
});

const checkingUpdate = computed(() => updateStatus.value === "checking");
const busyUpdate = computed(
  () =>
    updateStatus.value === "downloading" ||
    updateStatus.value === "installing",
);
/** 失败类状态：检查失败、平台缺失、下载/安装失败共用发布页兜底入口。 */
const updateFailed = computed(
  () =>
    updateStatus.value === "error" ||
    updateStatus.value === "unsupported" ||
    updateStatus.value === "download-error" ||
    updateStatus.value === "install-error",
);
const updateHighlighted = computed(
  () =>
    updateStatus.value === "available" ||
    updateStatus.value === "downloading" ||
    updateStatus.value === "installing" ||
    updateStatus.value === "installed",
);
const showReleaseAction = computed(
  () => updateStatus.value === "available" || updateFailed.value,
);
const releaseActionLabel = computed(() =>
  updateStatus.value === "available" ? "打开发布页" : "查看发布页",
);
const canInstall = computed(
  () =>
    pendingUpdate.value !== null &&
    (updateStatus.value === "available" ||
      updateStatus.value === "download-error" ||
      updateStatus.value === "install-error"),
);
const canRestart = computed(() => updateStatus.value === "installed");
const installButtonLabel = computed(() => {
  switch (updateStatus.value) {
    case "download-error":
      return "重试下载";
    case "install-error":
      return "重试安装";
    default:
      return "下载并安装";
  }
});
const downloadProgressStyle = computed(() =>
  downloadProgress.value === null
    ? undefined
    : { width: `${downloadProgress.value}%` },
);
/** 已有检查结果后按钮改为「重新检查」，避免重复同一个动作却看不出状态。 */
const checkButtonLabel = computed(() =>
  checkingUpdate.value
    ? "正在检查…"
    : updateStatus.value === "idle"
      ? "检查更新"
      : "重新检查",
);

/** 读取应用版本；失败（如浏览器预览没有 Tauri runtime）回退构建版本号。 */
async function loadVersion() {
  if (versionLoaded.value) return;
  versionLoaded.value = true;
  try {
    const reported = await getVersion();
    if (reported) version.value = reported;
  } catch (e) {
    console.warn("[about] 读取应用版本失败，使用构建版本号", e);
    version.value = FALLBACK_VERSION;
  }
}

/** 释放当前更新句柄；重试安装时不能提前释放，否则已下载的包会一起丢掉。 */
async function closePendingUpdate() {
  const update = pendingUpdate.value;
  pendingUpdate.value = null;
  updateDownloaded.value = false;
  if (!update) return;
  try {
    await update.close();
  } catch (e) {
    console.warn("[about] 释放更新资源失败", e);
  }
}

/** 只查询更新信息；下载与安装由 installUpdate 在用户确认后执行。 */
async function checkUpdates() {
  if (
    checkingUpdate.value ||
    busyUpdate.value ||
    updateStatus.value === "installed"
  ) {
    return;
  }
  updateActionError.value = "";
  await closePendingUpdate();
  downloadProgress.value = null;
  updateStatus.value = "checking";
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    // 10s 超时：网络卡住时不让「正在检查…」无限挂着。
    const update = await check({ timeout: 10_000 });
    if (!update) {
      latestVersion.value = "";
      updateStatus.value = "latest";
      return;
    }
    pendingUpdate.value = update;
    latestVersion.value = update.version;
    updateStatus.value = "available";
  } catch (e) {
    console.warn("[about] 检查更新失败", e);
    // 平台条目缺失不是网络抖动：重试不会改变结果，文案与入口都要区分。
    updateStatus.value = isUnsupportedPlatformError(e) ? "unsupported" : "error";
  }
}

/** 下载安装包；完成后立即进入安装。失败时保留句柄，允许重试。 */
async function downloadUpdate(update: UpdaterUpdate) {
  updateStatus.value = "downloading";
  downloadProgress.value = null;
  updateDownloaded.value = false;
  let totalBytes = 0;
  let receivedBytes = 0;

  try {
    await update.download(
      (event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          receivedBytes = 0;
          downloadProgress.value = downloadPercent(receivedBytes, totalBytes);
          return;
        }
        if (event.event === "Progress") {
          receivedBytes += event.data.chunkLength;
          downloadProgress.value = downloadPercent(receivedBytes, totalBytes);
          return;
        }
        downloadProgress.value = 100;
      },
      // 5 分钟：AppImage 体积较大，慢网络下也不能让「正在下载」无限挂着。
      { timeout: 300_000 },
    );
    updateDownloaded.value = true;
    await installDownloaded(update);
  } catch (e) {
    console.warn("[about] 下载更新失败", e);
    downloadProgress.value = null;
    updateStatus.value = "download-error";
  }
}

/** 安装已下载的更新；Linux 上完成后需要主动重启进程。 */
async function installDownloaded(update: UpdaterUpdate) {
  updateStatus.value = "installing";
  downloadProgress.value = 100;
  try {
    await update.install({ restartAfterInstall: true });
    await restartApp();
  } catch (e) {
    console.warn("[about] 安装更新失败", e);
    downloadProgress.value = null;
    updateStatus.value = "install-error";
  }
}

async function installUpdate() {
  const update = pendingUpdate.value;
  if (!update || busyUpdate.value) return;
  updateActionError.value = "";
  // 下载成功但安装失败：已下载的包还在 Update 句柄里，只重试安装。
  if (updateStatus.value === "install-error" && updateDownloaded.value) {
    await installDownloaded(update);
    return;
  }
  await downloadUpdate(update);
}

/** 安装完成后重启；Windows 的 NSIS 安装器会自行重启，不会走到这里。 */
async function restartApp() {
  updateStatus.value = "installed";
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    console.warn("[about] 重启应用失败", e);
    updateActionError.value =
      "更新已安装，但自动重启失败，请手动退出并重新打开 nnplayer。";
  }
}

async function openExternal(url: string) {
  externalError.value = "";
  try {
    if (isTauri()) {
      // capability 已授予 opener:default；直接调用插件命令，避免依赖未安装的 JS 包。
      // with 显式传 null：Option<String> 参数需要键存在，不能依赖缺省反序列化。
      await invoke("plugin:opener|open_url", { url, with: null });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (e) {
    console.warn("[about] 打开外部链接失败", e);
    externalError.value = `无法自动打开浏览器，请手动访问：${url}`;
  }
}

/** 关闭请求统一走这里：父组件收起弹层后由 watch 归还焦点。 */
function requestClose() {
  // 下载/安装过程中不允许收起弹层，避免用户以为操作已取消。
  if (busyUpdate.value) return;
  emit("close");
}

// ===== dialog 键盘/焦点管理 =====

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(): HTMLElement[] {
  const panel = panelRef.value;
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.getClientRects().length > 0);
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    requestClose();
    return;
  }
  if (e.key !== "Tab") return;
  const focusable = getFocusableElements();
  if (focusable.length === 0) {
    e.preventDefault();
    panelRef.value?.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  const insidePanel = panelRef.value?.contains(active) ?? false;
  if (!insidePanel) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === panelRef.value)) {
    e.preventDefault();
    last.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      const active = document.activeElement;
      lastActiveElement = active instanceof HTMLElement ? active : null;
      void loadVersion();
      document.addEventListener("keydown", onGlobalKeydown);
      await nextTick();
      closeButtonRef.value?.focus();
    } else {
      document.removeEventListener("keydown", onGlobalKeydown);
      const target = lastActiveElement;
      lastActiveElement = null;
      if (target?.isConnected) target.focus();
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onGlobalKeydown);
  if (!busyUpdate.value) void closePendingUpdate();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="about-fade">
      <div
        v-if="open"
        class="about-layer fixed inset-0 z-50 overflow-y-auto bg-black/20"
      >
        <!-- 点击面板外空白处关闭；面板本体不响应关闭。 -->
        <div class="about-stage" @click.self="requestClose">
          <section
            ref="panelRef"
            class="about-panel glass"
            role="dialog"
            aria-modal="true"
            aria-label="关于 nnplayer"
            tabindex="-1"
          >
            <header class="about-header">
              <div class="about-heading">
                <h2 class="about-title">关于 nnplayer</h2>
                <span class="about-version">v{{ version }}</span>
              </div>
              <button
                ref="closeButtonRef"
                type="button"
                class="about-close"
                :title="busyUpdate ? '更新进行中，请稍候' : '关闭关于'"
                :aria-label="busyUpdate ? '更新进行中，无法关闭' : '关闭关于'"
                :disabled="busyUpdate"
                @click="requestClose"
              >
                <X :size="18" :stroke-width="1.75" aria-hidden="true" />
              </button>
            </header>

            <div class="about-body">
              <p class="about-lede">
                nnplayer 是非官方第三方客户端，仅供学习与个人使用。内容经网易云接口获取，与网易云音乐及其关联公司无隶属关系。
              </p>

              <section class="about-section" aria-labelledby="about-shortcuts">
                <h3 id="about-shortcuts" class="about-section-title">
                  全局快捷键
                </h3>
                <dl class="about-shortcuts">
                  <div
                    v-for="row in SHORTCUTS"
                    :key="row.label"
                    class="about-shortcut"
                  >
                    <dt class="about-shortcut-label">{{ row.label }}</dt>
                    <dd class="about-keys">
                      <template v-for="(key, index) in row.keys" :key="key">
                        <span
                          v-if="index > 0"
                          class="about-key-sep"
                          aria-hidden="true"
                        >+</span>
                        <kbd class="about-key">{{ key }}</kbd>
                      </template>
                    </dd>
                  </div>
                </dl>
              </section>

              <section class="about-section">
                <h3 class="about-section-title">关闭窗口后继续播放</h3>
                <p class="about-text">
                  关闭主窗口不会停止播放，nnplayer 会留在系统托盘。点击托盘图标可显示或隐藏窗口，或从托盘菜单退出应用。
                </p>
              </section>

              <section class="about-section">
                <h3 class="about-section-title">更新</h3>
                <p
                  class="about-update-status"
                  :class="{
                    'about-update-status--error': updateFailed,
                    'about-update-status--available': updateHighlighted,
                  }"
                  role="status"
                >
                  <LoaderCircle
                    v-if="busyUpdate"
                    :size="14"
                    :stroke-width="2"
                    class="animate-spin about-status-icon"
                    aria-hidden="true"
                  />
                  <CircleCheck
                    v-else-if="updateStatus === 'latest' || updateStatus === 'installed'"
                    :size="14"
                    :stroke-width="2"
                    class="about-status-icon"
                    aria-hidden="true"
                  />
                  {{ updateSummary }}
                </p>
                <div
                  v-if="updateStatus === 'downloading' && downloadProgress !== null"
                  class="about-update-progress"
                  role="progressbar"
                  aria-label="更新下载进度"
                  :aria-valuenow="downloadProgress ?? 0"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="about-update-progress-bar"
                    :style="downloadProgressStyle"
                  ></div>
                </div>
                <p class="about-note">
                  检查只查询版本；下载并安装会调用系统安装程序，Linux 上可能需要管理员授权，安装完成后自动重启。
                </p>
                <div class="about-update-actions">
                  <button
                    v-if="canInstall"
                    type="button"
                    class="btn btn-primary about-action"
                    @click="installUpdate"
                  >
                    <RefreshCw
                      v-if="updateStatus === 'download-error' || updateStatus === 'install-error'"
                      :size="14"
                      :stroke-width="2"
                      aria-hidden="true"
                    />
                    <Download
                      v-else
                      :size="14"
                      :stroke-width="2"
                      aria-hidden="true"
                    />
                    {{ installButtonLabel }}
                  </button>
                  <button
                    v-if="canRestart"
                    type="button"
                    class="btn btn-primary about-action"
                    @click="restartApp"
                  >
                    <RefreshCw :size="14" :stroke-width="2" aria-hidden="true" />
                    重启应用
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost about-action"
                    :disabled="
                      checkingUpdate || busyUpdate || updateStatus === 'installed'
                    "
                    @click="checkUpdates"
                  >
                    <LoaderCircle
                      v-if="checkingUpdate"
                      :size="14"
                      :stroke-width="2"
                      class="animate-spin"
                      aria-hidden="true"
                    />
                    <RefreshCw
                      v-else
                      :size="14"
                      :stroke-width="2"
                      aria-hidden="true"
                    />
                    {{ checkButtonLabel }}
                  </button>
                  <button
                    v-if="showReleaseAction"
                    type="button"
                    class="btn btn-ghost about-action"
                    :title="`在浏览器中打开 ${RELEASES_URL}`"
                    @click="openExternal(RELEASES_URL)"
                  >
                    {{ releaseActionLabel }}
                    <ExternalLink
                      :size="13"
                      :stroke-width="2"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </section>
            </div>

            <!-- 外链/安装/重启失败提示放在固定区，不会随内容滚动而看不见。 -->
            <p
              v-if="externalError || updateActionError"
              class="about-error about-error--fixed"
              role="alert"
            >
              {{ externalError || updateActionError }}
            </p>

            <footer class="about-footer">
              <span class="about-license">MIT License · 开源项目</span>
              <a
                class="about-link"
                :href="REPO_URL"
                target="_blank"
                rel="noreferrer"
                @click.prevent="openExternal(REPO_URL)"
              >
                GitHub 仓库
                <ExternalLink :size="12" :stroke-width="2" aria-hidden="true" />
              </a>
            </footer>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 遮罩下给播放条留出安全区：面板最大高度止于播放条上方，不遮挡悬浮播放条。 */
.about-stage {
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100%;
  padding: 24px 16px calc(100px + 16px);
}

.about-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 100px - 40px);
  overflow: hidden;
  border-radius: 12px;
}

.about-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  padding: 16px 20px 0;
}

.about-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.about-title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.3;
}

.about-version {
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.about-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary);
  background: transparent;
  transition: color 0.18s ease, background-color 0.18s ease;
}

.about-close:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-soft, var(--color-card-hover));
}

.about-close:disabled {
  cursor: default;
  opacity: 0.5;
}

.about-close:disabled:hover {
  color: var(--color-text-secondary);
  background: transparent;
}

.about-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 12px 20px 4px;
  overflow-y: auto;
}

.about-lede {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.55;
}

.about-section {
  margin: 0;
}

.about-section-title {
  margin: 0 0 8px;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.about-shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 6px 20px;
  margin: 0;
}

.about-shortcut {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.about-shortcut-label {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.about-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
}

.about-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--color-surface-soft, var(--color-card-hover));
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.about-key-sep {
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.about-text {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.55;
}

.about-update-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.55;
}

.about-update-status--error {
  color: var(--color-accent);
}

.about-update-status--available {
  color: var(--color-text-primary);
  font-weight: 500;
}

.about-status-icon {
  color: var(--color-accent);
  flex: 0 0 auto;
}

.about-note {
  margin: 2px 0 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.5;
}

.about-update-progress {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-surface-soft, var(--color-card-hover));
}

.about-update-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width 0.2s ease;
}

.about-update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.about-action {
  gap: 6px;
  padding: 6px 12px;
}

.about-action:disabled {
  cursor: default;
  opacity: 0.5;
}

.about-error {
  margin: 8px 0 0;
  color: var(--color-accent);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.about-error--fixed {
  margin: 0;
  padding: 8px 20px 0;
}

.about-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  padding: 12px 20px 16px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.5;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-accent);
  text-decoration: none;
  transition: color 0.18s ease;
}

.about-link:hover {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.about-panel button:focus-visible,
.about-panel a:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.about-fade-enter-active,
.about-fade-leave-active {
  transition: opacity 0.18s ease;
}

.about-fade-enter-from,
.about-fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  /* 与外壳/队列共用同一窄窗几何：74px 播放条 + 8px 底距 + 8px 间隙 = 90px
     （历史 76px 对应旧 60px 条；见 tests/playerBarGeometry.test.mjs）。 */
  .about-stage {
    padding: 16px 12px calc(90px + 12px);
  }

  .about-panel {
    max-height: calc(100vh - 90px - 28px);
  }
}

@media (max-width: 520px) {
  .about-shortcuts {
    grid-template-columns: 1fr;
  }

  .about-header {
    padding: 14px 16px 0;
  }

  .about-body {
    padding: 10px 16px 4px;
  }

  .about-footer {
    padding: 10px 16px 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .about-fade-enter-active,
  .about-fade-leave-active,
  .about-close,
  .about-update-progress-bar,
  .about-link {
    transition: none;
  }
}
</style>
