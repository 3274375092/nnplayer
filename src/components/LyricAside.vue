<script setup lang="ts">
// 歌词列共享容器：每日推荐 / 歌单详情 / 搜索三处统一成同一张 raised 纸卡。
// 之前三页各写一份位置样式，只有每日推荐戴了纸面，另外两页是裸列、空态一句灰字
// 直接浮在页面底色上（实测 #F5F0E0 页面底 vs #FCFBEE raised 卡）。
//
// 视觉契约（DESIGN「Lyrics panel（歌词卡）」+「Cards / Containers」）：
//   --color-raised 纸面 + 8px 圆角 + Raised 阴影 + 16px 内边距 + width:100%；
//   宽容器下卡宽由所在网格轨道 clamp(280px, 34%, 320px) 决定（320 是理想值，
//   280 是 DESIGN 的歌词卡下限）；两栏时 sticky top:1rem。
//   单列态的居中 / 限宽 34rem 属于各页自己的布局，不在卡内声明：三页阈值本来就
//   不同（每日列表 32 首 → 44rem；歌单详情/搜索列表可达数百首 → 38rem，保住
//   最小窗里「列表旁仍能看到歌词卡」）。
// 内边距由卡片承担，卡内的 LyricPanel 清零自带内边距（它在正在播放页仍是裸面板，
// 保留自己的 p-4），避免 16px 叠成 32px。
import LyricPanel from "@/components/LyricPanel.vue";

withDefaults(
  defineProps<{
    /** 传递给 LyricPanel 的容器高度（px）；卡片高度随面板高度走 */
    panelHeight?: number;
  }>(),
  { panelHeight: 400 },
);
</script>

<template>
  <aside class="lyric-aside" aria-label="当前歌词">
    <LyricPanel :panel-height="panelHeight" />
  </aside>
</template>

<style scoped>
.lyric-aside {
  /* sticky 只在这里声明一次：三页原先各写了一份 top-4 / top-1rem。 */
  position: sticky;
  top: 1rem;
  align-self: start;
  box-sizing: border-box;
  /* 宽度跟随网格轨道；max-width:100% + min-width:0 保证轨道变窄时卡片只收缩、
     不推出网格。单列态的 width / justify-self 由各页布局覆盖。 */
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 1rem;
  /* 无边框：No-Line Rule，分区靠纸面明度与 Raised 阴影。 */
  border: 0;
  border-radius: 8px;
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
}

/* 卡内面板不再自带内边距（Now Playing 里 LyricPanel 仍是裸面板，不受影响）。 */
.lyric-aside :deep(.lyric-panel) {
  padding: 0;
}

/* 窄窗（≤768 CSS，与 DESIGN / styles.css 的 .mobile-stack 同断点）不再渲染歌词卡：
   这一档内容壳单列堆叠，歌词卡会被排到数百首列表之后、等于看不到；歌词由
   正在播放页与桌面歌词窗承担，列表因此独占整行，也不留下空轨或额外间距。
   display:none 让元素完全退出网格布局，单列网格只有列表一个轨道。 */
@media (max-width: 768px) {
  .lyric-aside {
    display: none;
  }
}

/* 详情/搜索：页面容器一进入单列（与各自 @container 38rem 同一判据）就不渲染歌词卡，
   否则它照样会被排到数百首列表末尾。每日推荐不在此列：它单列时卡在 32 首之后
   仍可达，且阈值是 44rem，只由上面的 768 窗口规则覆盖。 */
@container detail-content (max-width: 38rem) {
  .lyric-aside {
    display: none;
  }
}

@container search-content (max-width: 38rem) {
  .lyric-aside {
    display: none;
  }
}
</style>
