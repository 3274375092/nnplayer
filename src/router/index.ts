// Vue Router 配置。
// 注意：createWebHashHistory 用于 Tauri 桌面端更稳妥（无服务器路由）。

import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
} from "vue-router";

import { useUserStore } from "@/stores/user";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/daily" },
  {
    path: "/daily",
    name: "DailyRecommend",
    component: () => import("@/views/DailyRecommend.vue"),
    meta: { title: "每日推荐" },
  },
  {
    path: "/search",
    name: "Search",
    component: () => import("@/views/Search.vue"),
    meta: { title: "搜索" },
  },
  {
    path: "/playlists",
    name: "MyPlaylists",
    component: () => import("@/views/MyPlaylists.vue"),
    meta: { title: "我的歌单" },
  },
  {
    path: "/playlist/:id",
    name: "PlaylistDetail",
    component: () => import("@/views/PlaylistDetail.vue"),
    props: true,
    meta: { title: "歌单详情" },
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/Login.vue"),
    meta: { title: "登录", public: true },
  },
  {
    path: "/now-playing",
    name: "NowPlaying",
    component: () => import("@/views/NowPlaying.vue"),
    meta: { title: "正在播放" },
  },
  {
    path: "/desktop-lyrics",
    name: "DesktopLyrics",
    component: () => import("@/views/DesktopLyrics.vue"),
    meta: { title: "桌面歌词", public: true },
  },
  { path: "/:pathMatch(.*)*", redirect: "/daily" },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const userStore = useUserStore();

  // 首次访问时扫描后端获取当前登录态
  if (userStore.activePlatform === null) {
    await userStore.refresh();
  }

  if (to.meta.public) return true;

  // 未登录跳转到登录页
  if (!userStore.loggedIn) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }

  // 已登录还访问登录页 → 跳到首页
  if (to.name === "Login") {
    return { path: "/daily" };
  }

  return true;
});

router.afterEach((to) => {
  const title = (to.meta?.title as string) || "nnplayer";
  document.title = `${title} · nnplayer`;
});