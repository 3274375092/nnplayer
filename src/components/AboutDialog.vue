<script setup lang="ts">
// 关于/帮助弹层：版本、非官方声明、全局快捷键、托盘驻留说明、检查更新、
// 许可证与仓库链接。可发现性入口由 Sidebar 的品牌区提供。
// - 只读查询更新（@tauri-apps/plugin-updater 动态 import），不自动下载/安装；
// - 外链统一经 tauri-plugin-opener 交给系统浏览器打开；
// - dialog 语义 + Esc + Tab 焦点循环 + 关闭后焦点归还触发按钮。

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  CircleCheck,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  X,
} from "@lucide/vue";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { isUnsupportedPlatformError } from "@/utils/updateErrors";

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
    case "unsupported":
      return "当前平台不在更新清单中，请前往发布页查看最新版本。";
    case "error":
      return "检查更新失败，请稍后重试，或前往发布页查看最新版本。";
    default:
      return "还没有检查更新。";
  }
});

const checkingUpdate = computed(() => updateStatus.value === "checking");
/** 失败类状态：通用错误与「当前平台未列入清单」共用一个发布页兜底入口。 */
const updateFailed = computed(
  () => updateStatus.value === "error" || updateStatus.value === "unsupported",
);
const showReleaseAction = computed(
  () => updateStatus.value === "available" || updateFailed.value,
);
const releaseActionLabel = computed(() =>
  updateStatus.value === "available" ? "打开发布页" : "查看发布页",
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

/** 只查询更新信息：不调用 download/downloadAndInstall，安装交给用户去发布页。 */
async function checkUpdates() {
  if (checkingUpdate.value) return;
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
    latestVersion.value = update.version;
    updateStatus.value = "available";
  } catch (e) {
    console.warn("[about] 检查更新失败", e);
    // 平台条目缺失不是网络抖动：重试不会改变结果，文案与入口都要区分。
    updateStatus.value = isUnsupportedPlatformError(e) ? "unsupported" : "error";
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
                title="关闭关于"
                aria-label="关闭关于"
                @click="requestClose"
              >
                <X :size="16" :stroke-width="2" aria-hidden="true" />
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
                    'about-update-status--available': updateStatus === 'available',
                  }"
                  role="status"
                >
                  <CircleCheck
                    v-if="updateStatus === 'latest'"
                    :size="14"
                    :stroke-width="2"
                    class="about-status-icon"
                    aria-hidden="true"
                  />
                  {{ updateSummary }}
                </p>
                <p class="about-note">
                  只会查询 GitHub Releases 上的最新版本，不会自动下载或安装。
                </p>
                <div class="about-update-actions">
                  <button
                    type="button"
                    class="btn btn-ghost about-action"
                    :disabled="checkingUpdate"
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
                    :class="[
                      'btn',
                      'about-action',
                      updateStatus === 'available' ? 'btn-primary' : 'btn-ghost',
                    ]"
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

            <!-- 外链失败提示放在固定区，不会随内容滚动而看不见。 -->
            <p v-if="externalError" class="about-error about-error--fixed" role="alert">
              {{ externalError }}
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
  width: 30px;
  height: 30px;
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
  margin: 0 0 6px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
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
  opacity: 0.6;
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
  .about-link {
    transition: none;
  }
}
</style>
