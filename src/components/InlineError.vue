<script setup lang="ts">
// 页内内联错误块：把 appErrors 映射后的「发生了什么 + 怎么恢复 + 技术详情」
// 渲染成统一组件，供 Search / MyPlaylists / PlaylistDetail / DailyRecommend 复用。
// - role=alert 让读屏在错误出现时播报；
// - 是否显示「重试 / 重新登录」由映射结果决定，动作本身交回页面（emit）；
// - 技术详情默认折叠，原始后端文本只在展开后出现。

import type { UserFacingError } from "@/utils/appErrors";

defineProps<{
  error: UserFacingError;
}>();

const emit = defineEmits<{
  retry: [];
  relogin: [];
}>();
</script>

<template>
  <div
    class="inline-error"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
  >
    <p class="inline-error-title">{{ error.title }}</p>
    <p v-if="error.hint" class="inline-error-hint">{{ error.hint }}</p>
    <div v-if="error.retryable || error.relogin" class="inline-error-actions">
      <button
        v-if="error.retryable"
        type="button"
        class="btn btn-primary"
        @click="emit('retry')"
      >
        重试
      </button>
      <button
        v-if="error.relogin"
        type="button"
        class="btn btn-ghost"
        @click="emit('relogin')"
      >
        重新登录
      </button>
    </div>
    <details v-if="error.detail" class="inline-error-detail">
      <summary>技术详情</summary>
      <code>{{ error.detail }}</code>
    </details>
  </div>
</template>

<style scoped>
.inline-error {
  max-width: 40rem;
  padding: 20px 22px;
  border-radius: 12px;
  background: var(--color-surface-soft);
}

.inline-error-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.inline-error-hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.inline-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.inline-error-detail {
  margin-top: 12px;
}

.inline-error-detail summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.inline-error-detail summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

.inline-error-detail code {
  display: block;
  margin-top: 6px;
  max-height: 128px;
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
