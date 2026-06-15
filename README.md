# nnplayer

> 基于 Tauri v2 + Rust + Vue 3 + TypeScript 的网易云音乐桌面客户端。
> Rust 端通过本地 crate `ncm-api-rs` 调用网易云 API,前端用 `@tauri-apps/api` 通过 `invoke` 桥接。
> 主题色由当前播放的封面自动抽取(柔和米黄 / 暖橘红 accent 体系)。

![daily recommend](docs/screenshots/phase-5-daily-recommend.png)

## 特性

- **三种登录方式**:网易云 App 扫码 / 账号密码 / 手机验证码(60s 倒计时),会话双份持久化(tauri-plugin-store + session.toml)
- **音频播放**:单例 `<audio>` 元素,MediaSession 同步,系统媒体键可控制
- **歌词**:LRC 解析 + YRC 逐字卡拉OK + 弹簧物理滚动(Verlet 积分)+ 行间距离模糊 + 桌面歌词独立窗口(透明背景、always-on-top)
- **主题**:封面主色自动提取(0 依赖 HSL 桶分频次),改写 6 个 `--color-*` CSS 变量
- **浮层播放器**:720px 居中浮层 64px 高,`bg-card/85 backdrop-blur-xl` 玻璃感
- **桌面集成**:托盘菜单 + 全局快捷键(`Ctrl+Alt+P/←/→/L`)+ 窗口位置/大小自动持久化
- **歌单/搜索/每日推荐**:鉴权接口 + 骨架屏加载 + 搜索建议 500ms 防抖

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri v2 (`default-features = false`, `wry` + `tray-icon` + `image-png`) |
| 后端 | Rust 2021 edition,`tokio` 异步,`serde_json` 抽 NCM 响应 |
| NCM API | 本地 crate `../ncm-api-rs`(处理 weapi/eapi 加密 + Set-Cookie 捕获) |
| 前端 | Vue 3.5 + TypeScript 5.6 + Pinia 2 + Vue Router 4 + Vite 5 |
| 样式 | Tailwind 3.4(CSS 变量驱动主题色,`tailwind.config.js` 不写 hex) |
| 图标 | lucide-vue-next |
| 构建 | `vue-tsc` 类型检查 + `vite build` 前端,`cargo build --release` Rust |

## 开发

### 环境

- Node.js ≥ 18
- Rust stable(2021 edition)
- Windows 11 + WebView2(其他平台未测试,代码里 tray 用了 `tauri::tray`)

### 安装与运行

```bash
npm install                # 安装前端依赖
npm run tauri dev          # 一条命令起: Vite dev server + Cargo 编译 + Tauri 窗口
                           # 前端 HMR 在 1420/1421,Rust 改动自动重编译
```

只跑前端不开窗口(便于快速改 UI):

```bash
npm run dev                # 监听 http://localhost:1420
```

只检查 Rust 类型(不重链接):

```bash
cd src-tauri
cargo check
cargo clippy               # 推荐:写完逻辑跑一次
```

### 构建发布

```bash
npm run build              # vue-tsc 类型检查 + vite 打到 dist/
npm run tauri build        # 全套: 前端构建 + cargo build --release + NSIS 安装包
                           # 产物在 src-tauri/target/release/bundle/nsis/
```

> **NSIS 跨盘问题**: NSIS bundler 把文件解压到 `%TEMP%` 再 MoveFile 到 D 盘,Win11
> 偶尔会报 `os error 17`。**绕过办法**: 复制 `src-tauri/target/release/nnplayer.exe` 单文件分发,免安装。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  Webview (Chromium / WebView2)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ Vue 视图层   │  │ Pinia Store │  │ Composables      │  │
│  │ views/      │  │ user/player │  │ useNcmApi (invoke│  │
│  │ components/ │  │ /theme/...  │  │ useAudioPlayer   │  │
│  └─────────────┘  └─────────────┘  │ useLyric         │  │
│                                    │ useSpringScroll  │  │
│                                    └────────┬─────────┘  │
└─────────────────────────────────────────────┬────────────┘
                       invoke('xxx') / listen('yyy')
┌─────────────────────────────────────────────┴────────────┐
│  Rust (tauri::Builder)                                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ commands/* (auth, music, user, lyric)               │ │
│  │  - 抽 ApiResponse.body → 精简 DTO (camelCase)       │ │
│  │  - 全 #[tauri::command] 返回 AppResult<T>           │ │
│  └────────────────────────────┬────────────────────────┘ │
│  ┌────────────────────────────┴────────────────────────┐ │
│  │ AppState (Arc<Mutex>): ApiClient + AuthState        │ │
│  └────────────────────────────┬────────────────────────┘ │
│  ┌────────────────────────────┴────────────────────────┐ │
│  │ ncm-api-rs (本地 crate, ../ncm-api-rs)              │ │
│  │  weapi/eapi 加密 · 设备指纹 · Set-Cookie 合并       │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 关键模块对应

| 想做的事 | 改这里 |
| --- | --- |
| 新增 Tauri command | `src-tauri/src/commands/*.rs` + `lib.rs` 全路径注册 + `composables/useNcmApi.ts::Commands` + `types/music.d.ts` |
| 新增页面 | `src/views/*.vue`,在 `router/index.ts` 加路由 |
| 新增 UI 组件 | `src/components/*.vue`,`<script setup>` 风格 |
| 改主题色规则 | `utils/colorExtractor.ts` + `stores/theme.ts` |
| 改歌词解析 | `utils/lrcParser.ts`(纯函数),展示改 `components/LyricPanel.vue` |
| 改 NCM 响应字段 | `src-tauri/src/models.rs`(DTO) + `types/music.d.ts` |

## 目录

```
nnplayer/
├── src/                  # 前端
│   ├── views/            # 路由级页面
│   ├── components/       # 通用 UI 组件
│   ├── stores/           # Pinia (user/player/theme/desktopLyrics)
│   ├── composables/      # useNcmApi / useAudioPlayer / useLyric / useSpringScroll
│   ├── utils/            # crypto / lrcParser / colorExtractor
│   ├── types/music.d.ts  # Rust→前端的 DTO 契约
│   └── router/           # hash 路由 + 登录守卫
├── src-tauri/            # Rust 后端
│   ├── src/commands/     # auth / music / user / lyric
│   ├── src/models.rs     # 精简 DTO
│   └── capabilities/     # 窗口权限
├── ncm-api-rs/           # 网易云 API 本地 crate
├── docs/                 # 设计文档(本地,gitignored)
└── app-icon.svg          # 应用图标源文件
```

## 数据持久化位置

- 会话: `%APPDATA%\nnplayer\auth\session.toml` (Windows)
- 音量/侧栏折叠: `localStorage` (`nnplayer.volume` / `nnplayer.sidebarCollapsed`)
- 窗口位置/大小/最大化: `tauri-plugin-window-state` 自动管理

## 调试

- Rust 日志通过 `env_logger`,前缀 `[startup]` / `[login_qr_key]` / `[login]`
- 前端没有日志库,关键警告走 `console.warn`
- 类型检查: `vue-tsc --noEmit`(零警告通过,`npm run build` 会自动跑)

## 已知限制

- **平台**: 仅在 Windows 11 + WebView2 测试,macOS / Linux 理论上可跑但托盘/快捷键/打包需适配
- **会员内容**: `get_song_url` 走 320kbps 优先,VIP 灰歌曲能拿到 URL 但部分专辑需登录态,本项目三种登录都支持
- **打包**: NSIS 在跨盘 `%TEMP%` 时会失败,生产建议用单 exe 模式或修 `tauri.conf.json` 改 `bundle.targets` / 自定义 NSIS 路径

## 致谢

- 网易云音乐 (NCM) — 唯一 API 源
- [ncm-api-rs](./ncm-api-rs) — 本仓库同级的 Rust NCM 客户端
- [Tauri](https://tauri.app) / [Vue](https://vuejs.org) / [Pinia](https://pinia.vuejs.org) / [Tailwind CSS](https://tailwindcss.com) / [lucide](https://lucide.dev)

## License

本仓库未声明开源协议,**默认保留所有权利**。NCM API 的使用需遵守 [网易云音乐服务条款](https://music.163.com/)。
