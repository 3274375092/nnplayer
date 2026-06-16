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

  if (!userStore.loggedIn && userStore.loginMethod === "unknown") {
    await userStore.refresh();
  }

  if (to.meta.public) return true;

  if (!userStore.loggedIn) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }

  if (to.name === "Login") {
    const redirect = (to.query.redirect as string) || "/daily";
    return { path: redirect };
  }

  return true;
});

router.afterEach((to) => {
  const title = (to.meta?.title as string) || "nnplayer";
  document.title = `${title} · nnplayer`;
});