<script setup lang="ts">
// 骨架屏卡片。
//   - 列表型 / 网格型两种 variant
//   - 使用 tailwind 的 animate-shimmer 配合渐变背景实现"微光闪烁"效果
//
// 用法：
//   <SkeletonCard v-for="i in 8" :key="i" variant="grid" />
//   <SkeletonCard variant="list" :rows="6" />

interface Props {
  /** 列表型（一行一卡片模拟）或 网格型（封面 + 标题两行） */
  variant?: "list" | "grid";
  /** 列表型行数（仅 list 生效） */
  rows?: number;
}
withDefaults(defineProps<Props>(), {
  variant: "list",
  rows: 6,
});
</script>

<template>
  <!-- 网格型：歌单封面 / 单曲卡 -->
  <div
    v-if="variant === 'grid'"
    class="card p-3"
    aria-hidden="true"
  >
    <div class="skeleton aspect-square rounded-btn mb-3" />
    <div class="skeleton h-3.5 w-3/4 rounded mb-2" />
    <div class="skeleton h-3 w-1/2 rounded" />
  </div>

  <!-- 列表型：模拟歌单列表行 -->
  <div v-else class="card p-4" aria-hidden="true">
    <div class="flex items-center justify-between mb-4">
      <div class="skeleton h-4 w-24 rounded" />
      <div class="skeleton h-7 w-20 rounded-btn" />
    </div>
    <div class="skeleton h-3 w-full rounded mb-2" />
    <div v-for="i in rows" :key="i" class="flex items-center gap-3 py-2">
      <div class="skeleton h-3 w-6 rounded" />
      <div class="flex-1">
        <div class="skeleton h-3.5 w-2/3 rounded mb-1.5" />
        <div class="skeleton h-2.5 w-1/3 rounded" />
      </div>
      <div class="skeleton h-3 w-12 rounded" />
      <div class="skeleton h-4 w-4 rounded-full" />
    </div>
  </div>
</template>

<style scoped>
/* 微光闪烁背景：浅米黄 → 浅灰 → 浅米黄 */
.skeleton {
  background: linear-gradient(
    90deg,
    #eeefde 0%,
    #f4f5e3 50%,
    #eeefde 100%
  );
  background-size: 800px 100%;
  animation: shimmer 1.6s linear infinite;
}

/* 单独定义动画（避免被 Tailwind purge） */
@keyframes shimmer {
  0% {
    background-position: -400px 0;
  }
  100% {
    background-position: 400px 0;
  }
}
</style>
