# nnplayer 学习资源

## Knowledge

- [项目 README](./README.md)
  项目定位、功能、开发命令和官方架构概览。用途：第一次建立全局背景。
- [前端启动入口](./src/main.ts) 与 [根布局](./src/App.vue)
  Vue、Pinia、Router 的安装顺序，以及主窗口和桌面歌词窗口如何分流。用途：理解应用启动与全局能力放在哪里。
- [路由表与登录守卫](./src/router/index.ts)
  页面清单、公开路由和登录恢复时的导航决策。用途：定位“为什么进了某个页面”。
- [播放器状态仓库](./src/stores/player.ts) 与 [播放引擎](./src/playback/playbackEngine.ts)
  薄 Pinia adapter 与无框架 Playback Engine（队列/模式/媒体副作用）的明确分工。用途：理解播放主链路。
- [前端 Tauri API 门面](./src/composables/useNcmApi.ts)
  所有前端到 Rust 的命令名、参数和结构化错误边界。用途：查找前后端接缝。
- [Tauri 启动与命令注册](./src-tauri/src/lib.rs)、[应用状态](./src-tauri/src/state.rs) 与 [音乐命令](./src-tauri/src/commands/music.rs)
  原生生命周期、会话恢复、共享状态及 DTO 转换。用途：理解 Rust 后端的职责。
- [`ncm-api-rs` 请求核心](./ncm-api-rs/src/request.rs) 与 [播放地址接口](./ncm-api-rs/src/api/song_url_v1.rs)
  Cookie、设备信息、加密和远端 API 请求的最终落点。用途：需要追到网络协议层时阅读。
- [歌词同步排障文档](./docs/lyric-sync-troubleshooting.md)
  仓库内针对歌词时钟、跨窗口同步和常见故障的专题说明。用途：进入歌词子系统前阅读。
- [Tauri 官方文档：Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)
  `invoke` 与 `#[tauri::command]` 的权威说明。用途：理解本项目的前后端调用机制。
- [Pinia 官方文档：Core Concepts](https://pinia.vuejs.org/core-concepts/)
  Store、state、getter 和 action 的权威说明。用途：补齐 `src/stores/` 所用模式。
- [Vue 官方文档：Composables](https://vuejs.org/guide/reusability/composables.html)
  组合式逻辑的边界与生命周期。用途：理解 `src/composables/` 为什么不是普通工具函数目录。

## Wisdom (Communities)

- [nnplayer Issues](https://github.com/3274375092/nnplayer/issues)
  项目真实缺陷和使用反馈。用途：检验对行为与影响面的判断。
- [Tauri GitHub Discussions](https://github.com/tauri-apps/tauri/discussions)
  Tauri 原生窗口、事件和平台差异的实践经验。用途：遇到仅桌面环境出现的问题时交叉验证。
- [上游 `imsyy/ncm-api-rs`](https://github.com/imsyy/ncm-api-rs)
  内置 API crate 的上游背景。用途：判断接口行为来自本项目适配还是上游实现。

## Gaps

- 尚未记录学习者的具体用途（接手维护、准备贡献、排错或单纯阅读）和 TypeScript/Rust 熟悉度；后续课程深度需据此校准。
