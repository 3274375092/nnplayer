<script setup lang="ts">
// 全局非阻塞状态条：只渲染 notice store 的当前通知，不产生业务状态。
// - 位置在内容区底部、播放条上方（登录页没有播放条，落在页面底部）；
// - status 与 alert 各用一个常驻 live region：读屏不会因为节点在
//   role=status / role=alert 之间切换而沿用旧语气；
// - 不自动消失，用户手动关闭；多条提示折叠保留，逐条露出；
// - 关闭/执行动作/被外部状态收起时把焦点归还到出现通知前的元素，
//   避免焦点掉到 <body>；
// - 纸面 + Floating 阴影，沿用 DESIGN.md 的既有表面与阴影 token。

import { computed, nextTick, ref, watch } from "vue";
import { CircleAlert, Info, X } from "@lucide/vue";
import { useNoticeStore } from "@/stores/notice";

withDefaults(
  defineProps<{
    /** true = 位于播放条上方；false = 页面底部（登录页等没有播放条的路由）。 */
    abovePlayerBar?: boolean;
  }>(),
  { abovePlayerBar: true },
);

/** 常驻的两个 live region：信息用 polite/status，错误用 assertive/alert。 */
const LIVE_REGIONS = [
  { tone: "info", role: "status", live: "polite" },
  { tone: "error", role: "alert", live: "assertive" },
] as const;

const noticeStore = useNoticeStore();

const current = computed(() => noticeStore.current);
const pendingCount = computed(() => noticeStore.pendingCount);
const rootRef = ref<HTMLElement | null>(null);

/** 通知出现前用户所在的元素；关闭/动作后把焦点还回去。 */
let focusBeforeNotice: HTMLElement | null = null;
let restoreScheduled = false;

function isFocusInsideNotice(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && rootRef.value?.contains(active) === true;
}

/** 找不到原焦点时的兜底：播放条上第一个可用控件（主控制），没有播放条就回到内容区。 */
function resolveFallbackFocus(): HTMLElement | null {
  const playerBarButtons =
    document.querySelectorAll<HTMLButtonElement>(".player-bar-grid button");
  for (const button of playerBarButtons) {
    if (!button.disabled) return button;
  }
  return document.querySelector<HTMLElement>(".app-main");
}

/** 归还焦点；多次调用（关闭 + watch 收起）只执行一次。 */
function restoreFocusSoon() {
  if (restoreScheduled) return;
  restoreScheduled = true;
  void nextTick(() => {
    restoreScheduled = false;
    const target = focusBeforeNotice;
    focusBeforeNotice = null;
    if (target?.isConnected) {
      target.focus();
      return;
    }
    resolveFallbackFocus()?.focus();
  });
}

watch(
  current,
  (notice, previous) => {
    if (notice && !previous) {
      // 只在提示从无到有时记录焦点；同一条提示更新内容不覆盖原焦点。
      const active = document.activeElement;
      focusBeforeNotice =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    }
    if (!notice && previous) {
      // 外部状态把通知收起（例如重试成功后引擎清除失败通报）：焦点正在
      // 通知内或已经掉到 body 时归还焦点；本来在内容里则无需干预。
      if (isFocusInsideNotice() || document.activeElement === document.body) {
        restoreFocusSoon();
      }
    }
  },
  { flush: "post" },
);

function close() {
  const notice = current.value;
  if (!notice) return;
  noticeStore.dismiss(notice.id);
  restoreFocusSoon();
}

function runAction() {
  const action = current.value?.action;
  if (!action) return;
  try {
    // 动作通常是异步重试：不在这里关闭提示，等产生方把状态清掉后通知自然收起。
    action.run();
  } catch (error) {
    // 提示动作自身失败不应打断界面，保留提示让用户重试其余动作或关闭。
    console.warn("[notice] 提示动作执行失败", error);
  } finally {
    // 动作是用户对提示的最终处理：把焦点交还内容，避免停在即将消失的按钮上。
    restoreFocusSoon();
  }
}
</script>

<template>
  <div
    ref="rootRef"
    class="global-notice"
    :class="{ 'global-notice--above-player': abovePlayerBar }"
  >
    <!-- 两个 region 常驻 DOM：空着时也在，读屏可按固定极性播报。 -->
    <div
      v-for="region in LIVE_REGIONS"
      :key="region.tone"
      class="notice-live"
      :role="region.role"
      :aria-live="region.live"
      aria-atomic="true"
    >
      <Transition name="notice-pop">
        <section
          v-if="current && current.tone === region.tone"
          class="notice"
          :class="`notice--${region.tone}`"
        >
          <CircleAlert
            v-if="region.tone === 'error'"
            :size="18"
            :stroke-width="2"
            class="notice-icon"
            aria-hidden="true"
          />
          <Info
            v-else
            :size="18"
            :stroke-width="2"
            class="notice-icon"
            aria-hidden="true"
          />
          <div class="notice-body">
            <p class="notice-title">{{ current.title }}</p>
            <p v-if="current.hint" class="notice-hint">{{ current.hint }}</p>
            <details v-if="current.detail" class="notice-detail">
              <summary class="notice-detail-summary">技术详情</summary>
              <code class="notice-detail-code">{{ current.detail }}</code>
            </details>
            <p v-if="pendingCount > 0" class="notice-pending">
              还有 {{ pendingCount }} 条提示，关闭这条后显示下一条。
            </p>
          </div>
          <div class="notice-actions">
            <button
              v-if="current.action"
              type="button"
              class="notice-action"
              @click="runAction"
            >
              {{ current.action.label }}
            </button>
            <button
              type="button"
              class="notice-close"
              aria-label="关闭提示"
              @click="close"
            >
              <X :size="14" :stroke-width="2" aria-hidden="true" />
            </button>
          </div>
        </section>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.global-notice {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 25;
  width: min(780px, calc(100% - 24px));
  height: 0;
  transform: translateX(-50%);
  /* 容器本身不拦截点击，只有状态条本体可交互。 */
  pointer-events: none;
}

.global-notice--above-player {
  bottom: calc(var(--player-reserved-space, 100px) + 10px);
}

.notice-live {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-radius: 8px;
  background: var(--color-raised);
  box-shadow: var(--shadow-floating);
  color: var(--color-text-primary);
  pointer-events: auto;
}

.notice-icon {
  flex: 0 0 auto;
  margin-top: 1px;
}

.notice--error .notice-icon {
  color: var(--color-accent);
}

.notice--info .notice-icon {
  color: var(--color-text-secondary);
}

.notice-body {
  flex: 1 1 auto;
  min-width: 0;
}

.notice-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.notice-hint {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.notice-detail {
  margin-top: 6px;
}

.notice-detail-summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.notice-detail-summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

.notice-detail-code {
  display: block;
  margin-top: 6px;
  max-height: 96px;
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: var(--color-surface-soft);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.notice-pending {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.notice-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

.notice-action {
  border: 0;
  border-radius: 6px;
  padding: 6px 10px;
  background: transparent;
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.18s ease;
}

.notice-action:hover {
  background: var(--color-surface-strong);
}

.notice-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.notice-close:hover {
  background: var(--color-surface-strong);
  color: var(--color-text-primary);
}

.notice-action:focus-visible,
.notice-close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.notice-pop-enter-active,
.notice-pop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}

.notice-pop-enter-from,
.notice-pop-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .notice-pop-enter-active,
  .notice-pop-leave-active {
    transition-duration: 0.01ms;
  }

  .notice-pop-enter-from,
  .notice-pop-leave-to {
    transform: none;
  }
}
</style>
