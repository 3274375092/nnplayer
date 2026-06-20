// 应用入口。
// 顺序：
//   1. 安装 Pinia
//   2. 异步拉取 Rust 后端已恢复的会话（lib.rs::restore_session 已经从 session.toml
//      读取并调 login_status 校验过，前端只要 get_auth_state 把数据搬到 store）
//   3. 安装 Router
//   4. 挂载根组件

import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import { router } from "./router";
import { useUserStore } from "./stores/user";
import "./styles.css";

const app = createApp(App);
app.use(createPinia());

// 必须在 use(router) 之前初始化 store，以便路由守卫能读取登录态
const userStore = useUserStore();
// 不 await：让 UI 先挂载，同时后台异步获取登录态。
// 路由守卫会因为 loggedIn=false 把用户先跳到 /login，
// 等 refresh() 完成后再自动跳转回目标页。
void userStore.refresh();

app.use(router);
app.mount("#app");