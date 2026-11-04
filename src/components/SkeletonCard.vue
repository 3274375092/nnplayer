<script setup lang="ts">
// 骨架屏卡片。
//   - 列表型 / 网格型两种 variant
//   - 微光用 ::after 上的 transform 扫光实现（合成器属性，不动 background-position）
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
  <!-- 网格型：镜像 SongListItem 的歌单卡片（整幅 18px 圆角封面 + 标题/元信息）。
       标题占位沿用 .playlist-title 的 min-height: 2.7em：真实卡片即使只有一行标题
       也会预留两行高度，否则加载完成时整行卡片会突然长高。 -->
  <div v-if="variant === 'grid'" aria-hidden="true">
    <div class="skeleton aspect-square w-full rounded-[18px]" />
    <div class="mt-3 min-h-[2.7em]">
      <div class="skeleton h-3.5 w-3/4 rounded" />
    </div>
    <div class="skeleton mt-1 h-3 w-1/2 rounded" />
  </div>

  <!-- 列表型：镜像 SongList（小节头 + 列头 + 60px 行），加载完成后不跳位 -->
  <div v-else class="skeleton-list min-w-0" aria-hidden="true">
    <div class="flex items-center justify-between gap-3 px-0 mb-4">
      <div class="skeleton h-4 w-24 rounded" />
      <div class="skeleton h-9 w-[108px] rounded-md" />
    </div>

    <div
      class="skeleton-list__header grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 py-2 h-[34px] items-center"
    >
      <div class="skeleton h-3 w-8 rounded" />
      <div></div>
      <div class="skeleton h-3 w-10 rounded" />
      <div class="skeleton song-skeleton-album h-3 w-10 rounded" />
      <div class="skeleton h-3 w-6 justify-self-end rounded" />
    </div>

    <div
      v-for="i in rows"
      :key="i"
      class="skeleton-list__row grid grid-cols-[40px_44px_1fr_160px_72px] gap-3 px-3 h-[60px] items-center"
    >
      <div class="skeleton mx-auto h-3 w-4 rounded" />
      <div class="skeleton h-10 w-10 rounded-md" />
      <div class="min-w-0">
        <div class="skeleton h-3.5 w-2/3 rounded" />
        <div class="skeleton mt-1.5 h-2.5 w-1/3 rounded" />
      </div>
      <div class="skeleton song-skeleton-album h-3 w-16 rounded" />
      <div class="skeleton justify-self-end h-3 w-8 rounded" />
    </div>
  </div>
</template>

<style scoped>
/* 骨架底色 + 一条用 transform 扫过的微光带。
   旧实现动画 background-position（纯 paint，48 个格子会每秒重新栅格化上千次）；
   现在高光放在 ::after 上只动 transform，交给合成器。 */
.skeleton {
  position: relative;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
}

.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--color-text-primary) 6%, transparent) 50%,
    transparent 100%
  );
  animation: skeleton-sweep 1.6s linear infinite;
}

@keyframes skeleton-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}

/* 列表骨架以自身容器宽度为准镜像 SongList 的列策略：窄于 34rem 时隐藏专辑列
   并把宽度让给标题/时长，加载完成时列集合不会翻转。容器查询与 SongList.vue
   的 `@container song-list (max-width: 34rem)` 同阈值、同列值。 */
.skeleton-list {
  container-name: skeleton-song-list;
  container-type: inline-size;
}

@container skeleton-song-list (max-width: 34rem) {
  .skeleton-list__header,
  .skeleton-list__row {
    grid-template-columns: 36px 40px minmax(0, 1fr) 52px;
  }

  .song-skeleton-album {
    display: none;
  }
}
</style>
