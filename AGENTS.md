# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概览

`nnplayer` 是一个使用 **Tauri v2 + Rust + Vue 3 + TypeScript** 构建的网易云音乐桌面客户端。前端通过 `@tauri-apps/api` 的 `invoke` 调用 Rust 端 `#[tauri::command]` 函数；Rust 端通过本地 crate `ncm-api-rs`（`ncm-api`）访问网易云 API，通过本地 crate `qq-music` 访问 QQ 音乐 API。

`ncm-api-rs` 是同仓库 `../ncm-api-rs` 下的本地依赖（自 ncm-api-rs 0.1.0 抽出），提供登录、加密、Cookie 管理、Set-Cookie 捕获等能力。
`qq-music` 是同仓库 `../qq-music` 下的本地依赖（自 netease-qq-music-api 0.1.0 精简 fork），覆盖 6 个常用端点（搜索 / 播放 / 歌词 / 推荐 / 歌单详情 / 我的歌单）+ cookie 粘贴登录。

UI 风格：柔和米黄体系 `bg #FAFCE4` / `card #F5F7E1` / `hover #EEF0D8` / `accent #E85D3A`、12px 大圆角、轻阴影、**720px 居中浮层播放栏 + 64px 高**（阶段 2 升级）。主题色已 CSS 变量驱动，封面可触发主题切换（阶段 1）。

## 常用命令

> 仓库根是 Vite + Tauri 双工程：`src/`（前端）、`src-tauri/`（Rust 端）、`ncm-api-rs/`（本地网易云 API crate）。

```bash
# 安装依赖
npm install

# 开发：Tauri 的 beforeDevCommand 自动跑 npm run dev
npm run tauri dev

# 仅前端开发（不开 Rust 窗口，端口 1420）
npm run dev

# 类型检查 + 生产前端构建（产物落到 dist/）
npm run build

# 预览前端产物
npm run preview

# Tauri 桌面打包（产物在 src-tauri/target/release/bundle/）
npm run tauri build
```

Rust 端单独构建（在 `src-tauri/` 下）：

```bash
cd src-tauri
cargo check            # 仅类型检查
cargo build            # 编译
cargo clippy           # lint
```

> **注意事项**：
> - 端口 1420 / HMR 1421 在 `vite.config.ts` 写死且 `strictPort: true`，**不要改**。
> - `Cargo.toml` 用 `[patch.crates-io] brotli = { path = "../vendor/brotli" }` 绕开 `brotli 8.0.3` 的 nightly 编译错误（详见 `Cargo.toml` 注释）。删掉 patch 后若 tauri 仍能编过，可去掉。
> - `tauri = { default-features = false, features = ["wry"] }` + `tauri-macros = { default-features = false }` 同样是为了不拉入 brotli。

## 架构与目录结构

### 前端 `src/`

```
src/
├── main.ts              # 应用入口：Pinia → 异步 refresh 会话 → Router → mount
├── App.vue              # 骨架：根据 getCurrentWindow().label 区分主窗/桌面歌词窗
│                        # 主窗 = Sidebar + router-view + PlayerBarFloating
│                        # 桌面歌词窗 = 极简 <router-view>（无 Sidebar/PlayerBar/bg）
│                        # 阶段5：onMounted → useTauriBridge().setup()（监听逻辑已抽出）
├── styles.css           # Tailwind base + @layer components（btn/card/input）+ :root CSS 变量
├── router/index.ts      # hash 路由 + 全局登录守卫 + /now-playing + /desktop-lyrics
├── types/music.d.ts     # 全局 TS 类型（Song/Playlist/AuthState/AppErrorPayload/SearchSuggestion/LyricResult…）
├── stores/
│   ├── user.ts          # 登录态 Pinia（refresh / 三种登录 / logout）
│   ├── player.ts        # 播放队列 + 模式 + 上下首 + 卡拉OK metadata；转发 useAudioPlayer
│   ├── theme.ts         # 阶段1：封面驱动主题色（debounce 200ms，CSS 变量改写）
│   └── desktopLyrics.ts # 阶段3：桌面歌词窗口 WebviewWindow 生命周期管理
├── composables/
│   ├── useNcmApi.ts           # 全部 invoke 命令的薄包装 + 错误归一（命令名集中在 Commands）
│   ├── useAudioPlayer.ts      # 单例 <audio> 元素 + reactive 状态 + 命令式方法 + MediaSession 同步
│   ├── useLyric.ts            # 拉取并解析歌词 + karaokeTokens + progressMs + emit 桌面歌词
│   ├── useSpringScroll.ts     # 阶段3：弹簧物理滚动（Verlet 积分，dt clamp 64ms）
│   ├── useTauriBridge.ts      # 阶段5+：集中 listen Rust emit 事件（player:*/desktop-lics:*）+ 当前歌曲→主题色 watch
│   ├── useDesktopLyricsBridge.ts # 桌面歌词窗订阅：listen update + emit request-snapshot
│   ├── useWindowGeometry.ts   # 桌面歌词窗位置/大小防抖持久化（emit control → 主窗写 localStorage）
│   └── useLyricWindowPrefs.ts # 桌面歌词窗本地偏好（fontSize/opacity/textColor/locked/showPrevNext）
├── components/
│   ├── Sidebar.vue      # 可折叠 64px↔240px + 路由指示器 + 搜索建议 + 队列/桌面歌词入口
│   ├── PlayerBarFloating.vue # 720px 居中浮层 + 64px + hover 显隐次要按钮
│   ├── PlayerBar.vue    # 旧 80px 固定底栏（保留备用）
│   ├── ProgressBar.vue  # 自定义进度条：拖拽 tooltip + 键盘 ←/→ ±5s + 菱形 thumb
│   ├── ScrollText.vue   # 标题跑马灯（ResizeObserver 测宽度，hover 才滚，prefers-reduced-motion 退化）
│   ├── QueueDrawer.vue  # 阶段4：380px 右侧抽屉 + 原生 HTML5 拖拽排序
│   ├── LyricPanel.vue   # 阶段3+：弹簧滚动 + 卡拉OK 逐字 + 行间距离模糊
│   │                    # 修复后：min-height + ellipsis（防长行撑高与下一行重叠）、
│   │                    # ResizeObserver 实测每行高累加 targetY、双层 span + clip-path
│   │                    # 单行渐变卡拉OK（不撑高父行）、lineHeight/panelHeight 可配置 prop
│   ├── PlayControl.vue  # 备用按钮组
│   ├── SongList.vue     # 通用列表（双击播放、当前歌曲高亮、播放全部）
│   ├── SongListItem.vue # 卡片网格视图（歌单封面 / 单曲卡）
│   └── SkeletonCard.vue # 骨架屏（list / grid 两种 variant）
├── views/
│   ├── DailyRecommend.vue   # 鉴权接口 + 歌词面板侧栏
│   ├── Search.vue           # 500ms 防抖 + 监听 route.query.q + 歌词面板侧栏
│   ├── MyPlaylists.vue      # 网格歌单卡片 + SkeletonCard 加载态
│   ├── PlaylistDetail.vue   # 动态路由 /playlist/:id，watch props.id 重新加载 + 歌词面板
│   ├── Login.vue            # 三 Tab：QR（1.5s 轮询）/ 账号 / 手机验证码（60s 倒计时）
│   ├── NowPlaying.vue       # 阶段2：半模态全屏页（Hero 旋转封面 + 歌词面板 + ESC 关闭）
│   └── DesktopLyrics.vue    # 阶段3：独立窗口页（透明背景 + 大字号当前行 + 下一行）
└── utils/
    ├── crypto.ts        # md5Password / isValidPhone / isValidEmail
    ├── lrcParser.ts     # LRC 解析（parseLrc / findActiveLineIndex / parseKaraokeLine）
    └── colorExtractor.ts# 阶段1：0 依赖封面主色提取（HSL 桶分频次 + 6 个角色色 CSS 变量）
```

### Rust 后端 `src-tauri/`

```
src-tauri/
├── tauri.conf.json      # productName / identifier / windows / build hooks
├── capabilities/default.json  # 窗口权限：core + opener + store + global-shortcut + window-state
└── src/
    ├── main.rs          # 入口：仅调 nnplayer_lib::run()
    ├── lib.rs           # 注册插件（tray / global-shortcut / window-state）+ manage(AppState)
    │                    # + invoke_handler 全路径注册 + build_tray + register_global_shortcuts
    │                    # 启动时调 restore_session 校验 NCM/QQ 双方 cookie
    ├── state.rs         # AppState { api: ApiClient, auth: AuthState, qq: QqMusicClient, qq_token: Option<QqToken> }
    │                    # NCM/QQ 完全独立锁 + token 快照接口
    ├── error.rs         # AppError 枚举 + Serialize → { kind, message } + map_ncm_err / map_qq_err
    ├── models.rs        # DTO：Song / SongUrl / Playlist / PlaylistDetail / SearchResult /
    │                    #       DailyRecommend / SearchSuggestion / LyricResult（全部 camelCase）
    │                    # Song 新增 platform: String + qq_mid: Option<String>（QQ 专用）
    └── commands/
        ├── mod.rs       # pub use 转发 NCM/QQ 双方辅助
        ├── auth.rs      # NCM 三种登录 + finalize_login + session.toml 持久化
        ├── music.rs     # NCM search_songs / search_suggest / get_daily_recommend / get_song_url
        │                # 内置 chrono_like_today（不引入 chrono 依赖）
        ├── user.rs      # NCM get_user_playlists / get_playlist_detail
        ├── lyric.rs     # NCM get_lyric
        ├── qq_auth.rs   # QQ cookie 粘贴登录 + QqSessionRecord TOML 持久化
        │                # 完全与 NCM auth 解耦：独立 QqToken、独立 session_qq.toml
        ├── qq_music.rs  # QQ 6 个端点：search_songs / get_song_url / get_lyric /
        │                #   get_daily_recommend / get_user_playlists / get_playlist_detail
        ├── shared/
        │   └── song_mapper.rs  # 平台无关 DTO 边界转换：QqSong → Song，QqPlaylist → Playlist
        │                       # 公共函数 qq_mid_to_u64() 供其他模块复用
        └── window_geom.rs # is_position_on_screen（恢复持久化位置前校验显示器边界）
```

`ncm-api-rs/` 是网易云 API Rust crate，通过 `ncm-api = { path = "../ncm-api-rs" }` 引入。
`qq-music/` 是 QQ 音乐 API Rust crate（精简 fork），通过 `qq-music = { path = "../qq-music" }` 引入。

两个 crate 都通过 path dep 引入，业务层只关心：调用对应 client 的方法、从响应中用 JSON pointer 抽取字段、转成 `models.rs` 中的统一 DTO（含 `platform: "qq"` 标识）返回前端。

## 关键设计约定

### Rust 端

1. **错误处理**：业务代码严禁 `unwrap()` / `expect()`（仅类型定义文件除外）。所有 `#[tauri::command]` 返回 `AppResult<T>`。新增错误变体时同步更新 `AppError` 和它的 `Serialize` 实现（前端 `AppErrorPayload.kind` 是字符串联合类型）。
2. **全局状态**：通过 `app.manage(AppState::new(...))` 注入；命令中用 `state: State<'_, AppState>` 提取。`AppState` 内部用 `Arc<tokio::sync::Mutex>`。
3. **模块化**：`main.rs` / `lib.rs` 极简，业务拆分到 `commands/*`。**新增命令必须在 `lib.rs::run()` 的 `tauri::generate_handler![...]` 数组里注册**——`commands/mod.rs` 的 `pub use` 是给 Rust 代码用的，`generate_handler!` 宏需要全路径（`commands::auth::xxx`），用 `pub use` 重新导出的函数宏会找不到，编译报 E0433。`lib.rs` 里的注释明确写了这一点。
4. **DTO 精简**：`models.rs` 是 Rust→前端的契约。前端 `src/types/music.d.ts` 必须与之一一对应（camelCase）。从 `ApiResponse.body` 抽取字段时直接构造精简结构，不要把 NCM 原生大 JSON 整坨返回。
5. **Tray 内置在 tauri 主 crate**：crates.io 上**没有** `tauri-plugin-tray`。`tauri::tray` 模块是主 crate feature gate 提供的，不要再加独立 plugin 依赖。

### 前端

1. **类型优先**：所有与后端交互的数据用 `src/types/music.d.ts` 里的接口，不要临时 `any`。
2. **组合式函数**：
   - 所有 `invoke` 调用都走 `composables/useNcmApi.ts`（统一错误归一、命令名常量集中在 `Commands` 对象）。
   - 任何 `<audio>` DOM 操作都走 `composables/useAudioPlayer.ts`（单例 audio 元素、`onBeforeUnmount` 清理、MediaSession 同步）。
   - 登录态走 `stores/user.ts`；队列/播放/模式走 `stores/player.ts`；主题色走 `stores/theme.ts`；桌面歌词窗口走 `stores/desktopLyrics.ts`。
   - **Rust → 前端事件统一收口**在 `composables/useTauriBridge.ts`（tray 菜单、全局快捷键、桌面歌词跨窗控制都进 `setup()`，App.vue 只负责生命周期挂载）。
   - 组件**严禁**直接 `invoke` 后端。
3. **组件粒度**：UI 组件在 `components/`，页面在 `views/`，单文件组件 `script setup` 风格。
4. **CSS 变量驱动主题色**（阶段 1 升级）：Tailwind colors 改 `var(--color-*)` 引用，`:root` 在 `styles.css` 定义默认值；切歌时 `themeStore.applyFromCover` 改写变量；fallback 米黄即默认值，`tailwind.config.js` 不要写 hex。
5. **新 Tauri command 必须 5 处同步**：
   - `commands/*.rs` 实现
   - `commands/mod.rs` 的 `pub use`（可选）
   - `lib.rs` 全路径注册
   - `useNcmApi.ts::Commands` 增条目
   - `src/types/music.d.ts` 增 DTO
6. **路径别名**：`@/*` → `src/*`（`tsconfig.json` 和 `vite.config.ts` 都声明了，改一处必须同步另一处）。

### NCM API 字段名差异（重要）

NCM 不同接口的字段名不一样，解析时容易踩坑（`music.rs` 注释里也标了）：

| 接口 | 时长字段 |
| --- | --- |
| `/search`（搜索） | `duration` |
| `/recommend/songs`（每日推荐） | `dt` |
| `/playlist/detail`（歌单详情） | `dt` |

读不到就会 fallback 到 0，前端列表里显示 `00:00`。`search_suggest` 同时兼容 `duration` 和 `dt`。改解析逻辑时三个地方一起核对。

**YRC 逐字歌词**（`/lyric` 返回的 `yLrc` 字段）：格式 `[行偏移,行时长](字偏移,字时长,音量)字`，
字偏移是**绝对时间戳**（毫秒）不是相对行偏移。解析在 `utils/lrcParser.ts::parseYrc`。
多字符 token（如英文词）内部字符共用同一时间窗。

### Tauri v2 关键陷阱（先读再做）

1. **`close()` 会被静默吞掉**：Tauri v2 一旦注册了 `tauri://close-requested` 监听器，Rust 端会自动调 `api.prevent_close()`，导致所有 `close()` 失效、窗口永远关不掉。桌面歌词窗**不能**用 `close()`，必须 `destroy()`（不走 close-requested 路径，是强制 kill）。详见 `stores/desktopLyrics.ts:96` 和 `views/DesktopLyrics.vue:162`。
2. **`tauri-plugin-tray` 不存在**：crates.io 上无此 crate。`tauri::tray` 是主 crate 的 feature gate（`features = ["tray-icon"]`），不要在 Cargo.toml 加独立 plugin 依赖。
3. **`tauri::generate_handler!` 必须全路径**：`commands/mod.rs` 的 `pub use` 是给 Rust 代码用的，宏找不到重新导出的 `__cmd__xxx` helper，会报 E0433。`lib.rs` 里要写 `commands::auth::xxx`。
4. **`Shortcut::new` 是 infallible**（`global-hotkey 0.8+`）：直接返回 `Shortcut`，不返回 `Result`；`with_shortcuts` 才是 `Result`。
5. **reqwest + rustls-no-provider** 必须在首次构造 Client 前 `rustls::crypto::ring::default_provider().install_default()`，否则 handshake panic。
6. **窗口状态插件会"恢复"所有持久化窗口**：`tauri-plugin-window-state` 默认会持久化全部 webview 窗口的位置/大小。桌面歌词窗的"位置记忆"用 localStorage 自己管，需 `.with_denylist(&["desktop-lyrics"])` 排除（见 `lib.rs:44-46`）。

## 数据流与关键流程

### 启动 / 会话恢复

```
lib.rs::run()
  └─ AppState::new(initial_cookie)   // 从 session.toml 读 cookie
  └─ tauri::Builder::default()
       ├─ .plugin(tray / global-shortcut / window-state)
       ├─ .manage(state)
       └─ .setup() → spawn restore_session()
            └─ 读 session.toml → api.set_cookie() → login_status 校验
                 ├─ OK: 写 AuthState{user_id, nickname, cookie, login_method, avatar_url}
                 └─ FAIL: 清空内存 + 删除 auth.json + 删除 session.toml
```

前端 `main.ts` 调 `userStore.refresh()` 异步拉 `get_auth_state`，期间路由守卫会先放行到 `/login`，等 refresh 完成后再跳转。

### 登录（三选一）

所有登录走 `ncm_api::ApiClient`（自动加密 + 自动 Set-Cookie 合并）→ `commands::auth::finalize_login()`：
1. 合并 cookie（prev + resp Set-Cookie 数组，HashMap 去重）
2. 调 `user_account` 拿 user_id / nickname / avatar_url（失败时回退到登录响应 body）
3. 写 `AppState.auth`
4. **双份持久化**：
   - `tauri-plugin-store` 写 `auth.json` 的 `cookie` 字段
   - `directories::BaseDirs::config_dir() + "nnplayer/auth/session.toml"`（用于启动恢复）

### 主题色（阶段 1）

```
player.currentSong 变化
  └─ themeStore.applyFromCover(song.picUrl)     [debounce 200ms]
       └─ extractPalette(imgUrl)               [112x112 缩放 + HSL 桶分频次]
            └─ applyToCssVars(seed)            [改写 :root 上 6 个 --color-* 变量]
       └─ fallback 失败 → console.warn 保持当前色
resetToDefault() → 移除所有 --color-* 变量 → :root 默认值（米黄）生效
```

### 播放

```
SongList.vue 双击行 → playerStore.playList(songs, idx)
  └─ playCurrent()
       └─ controller.playSong(song.id, song)   // useAudioPlayer
            ├─ invoke get_song_url(songId)      // Rust 优先 320kbps
            ├─ syncMediaSession(song)           // navigator.mediaSession.metadata
            └─ audio.src = url; audio.play()
  └─ audio ended → 自定义事件 'nnplayer:ended'
       └─ playerStore.bindAutoNext() 监听 → next() / playCurrent()（loop-one）
```

`useAudioPlayer` 是单例（整个应用共用一个 `<audio>`），`onBeforeUnmount` 会清掉事件监听和 DOM 节点。音量存到 `localStorage.nnplayer.volume`，键名固定。MediaSession 系统媒体键通过 `nnplayer:media:*` window 事件桥接到 store（避免 composable ↔ store 循环引用）。

### 桌面歌词（阶段 3）

```
主窗 useLyric.ts 内部 watch [currentSong, activeLineIndex, progressMs, lines]
  └─ emit('desktop-lyrics:update', { current, next, progress, songName, artists })
       └─ 桌面歌词窗口 (DesktopLyrics.vue) listen 事件
            └─ 显示大字号当前行 + 小字号下一行 + 歌曲信息
主窗 Sidebar 调 desktopLyricsStore.toggleWindow()
  └─ openWindow()   // WebviewWindow.new('desktop-lyrics', { transparent: true, decorations: false, alwaysOnTop: true })
  └─ closeWindow()  // 复用已存在窗口，不重建
```

### 桌面集成（阶段 5）

```
Rust 托盘菜单 / 全局快捷键
  └─ app.emit("player:toggle" | "player:prev" | "player:next" | "desktop-lyrics:toggle")
       └─ App.vue onMounted → useTauriBridge().setup() → 调 playerStore / desktopLyricsStore
```

全局快捷键：`Ctrl+Alt+P`（播放/暂停）、`Ctrl+Alt+←/→`（上/下首）、`Ctrl+Alt+L`（桌面歌词）。
窗口位置/大小/最大化由 `tauri-plugin-window-state` 自动持久化（桌面歌词窗在 `lib.rs` 的 `with_denylist` 中排除）。

### 跨窗事件通道（桌面歌词）

事件名集中在 `useTauriBridge.ts` 和 `useLyric.ts`，**改名字必须 Rust + TS 双端同步**：

| 事件 | 方向 | 含义 |
| --- | --- | --- |
| `desktop-lyrics:update` | 主 → 子 | 歌词状态推送（节流 250ms） |
| `desktop-lyrics:request-snapshot` | 子 → 主 | 子窗刚 mount 时请求当前快照 |
| `desktop-lyrics:control` | 子 → 主 | `{ action: "geometry" \| "lock" \| "close" }` |
| `desktop-lyrics:apply-prefs` | 主 → 子 | 主窗设置面板推 prefs 覆盖到子窗 |
| `player:toggle/prev/next` | Rust → 前端 | 托盘 / 全局快捷键桥接 |

### 路由守卫（`src/router/index.ts`）

- `createWebHashHistory`（Tauri 桌面端无服务器，必须用 hash）
- `/` → 重定向 `/daily`
- `meta.public = true` 跳过登录检查（只有 `/login`）
- 未登录访问非 public → `{ path: '/login', query: { redirect: to.fullPath } }`
- 启动时若 `userStore.loggedIn === false && loginMethod === 'unknown'`，先 `await userStore.refresh()` 再判断

## 权限（`src-tauri/capabilities/default.json`）

已开 `core:default` + `core:window:default` + `core:webview:default` + `core:event:default` + `core:app:default` + `opener:default` + `store:default` + `global-shortcut:default/allow-register/allow-unregister` + `window-state:default` + `core:window:allow-start-dragging` + `core:window:allow-close` + `core:window:allow-destroy` + `core:webview:allow-create-webview-window` + `core:webview:allow-webview-close` + `core:webview:allow-webview-show` + `core:webview:allow-set-webview-focus`。

适用窗口：`["main", "desktop-lyrics"]`（桌面歌词窗需要的 webview 权限必须显式列出）。

**注意**：tray 在主 crate 内置，无 `tray:*` 权限字符串（不要照搬其他项目模板）。

## 多平台架构（NCM + QQ 双轨）

**目标**：在不破坏现有网易云体验的前提下，可选地接入 QQ 音乐。两者**完全解耦**，互不影响。

### 后端分层

| 层级 | NCM 路径 | QQ 路径 |
|---|---|---|
| API 客户端 | `ncm-api-rs` crate（path dep） | `qq-music` crate（path dep，精简 fork） |
| 命令文件 | `commands/{auth,music,user,lyric}.rs` | `commands/{qq_auth,qq_music}.rs` |
| 错误变体 | `AppError::Ncm` / `Network` / `Unauthorized` | `AppError::Qq` |
| 状态字段 | `AppState::api` + `AppState::auth` | `AppState::qq` (QqMusicClient) + `AppState::qq_token` (Option\<QqToken\>) |
| 持久化 | `auth.json.qq_cookie` + `session.toml` | `auth.json.qq_cookie` + `session_qq.toml`（**独立 TOML**）|
| DTO 边界 | NCM 原始 JSON → 业务字段（`models.rs` 直接构造） | `QqXxx` DTO → 通用 Song/Playlist，**走 `commands/shared/song_mapper.rs` 转换** |

### DTO 标识

`Song`（前端）新增两个字段（向后兼容，缺省走 NCM）：

```ts
{
  // ... 现有字段
  platform?: "netease" | "qq";  // 缺省 "netease"
  qqMid?: string;                // 仅 platform="qq" 时存在，用于回查 QQ API
}
```

QQ song id 是字符串（mid），但现有 `Song.id: number` 保持不变。**转换层**用 FNV-1a 64 把 mid 哈希成 u64（见 `song_mapper.rs::qq_mid_to_u64`），**仅用作唯一标识**，**不**用于业务查询（业务查询用 `qqMid` 字段）。

### 前端路由

调用方按 `song.platform` 显式路由，**不**做隐式 fallback：

| 场景 | NCM | QQ |
|---|---|---|
| 播放 URL | `getSongUrl(id)` | `qqGetSongUrl(song.qqMid)` |
| 歌词 | `getLyric(id)` | `qqGetLyric(song.qqMid)` |
| 搜索 | `searchSongs(keyword)` | `qqSearchSongs(keyword)` |
| 歌单 | `getUserPlaylists()` / `getPlaylistDetail(id)` | `qqGetUserPlaylists()` / `qqGetPlaylistDetail(id)` |
| 每日推荐 | `getDailyRecommend()` | `qqGetDailyRecommend()` |

实现层在 `useAudioPlayer.ts::playSong` 和 `useLyric.ts::loadFor` 中按 `song.platform` 分发。**新增第三方平台**时按相同模式：
1. 新建 `crate-xxx` (path dep)
2. 在 `state.rs` / `error.rs` 加字段
3. 在 `commands/` 加 `xxx_auth.rs` + `xxx_music.rs`
4. 在 `shared/song_mapper.rs` 加 `xxx_song_to_dto` / `xxx_playlist_to_dto`
5. 在 `composables/useXxxApi.ts` 加 invoke 薄包装
6. 在 `Login.vue` 加 Tab
7. 在 `useAudioPlayer.ts` / `useLyric.ts` 加分发分支

### 5 处同步规则对 QQ 同样适用

任何新 QQ 命令都走 5 处同步：`commands/qq_*.rs` 实现 → `lib.rs` 全路径注册 → `useQqApi.ts::QqCommands` 增条目 → `types/music.d.ts` 增 DTO（若需要）→ `AGENTS.md` 增文档。

### QQ 端不支持的能力

QQ 音乐**不**实现（与 NCM 端语义有差异，需 UI 隐藏）：
- 私人 FM / 红心 / 收藏 / 评论 / 云盘
- 搜索建议（`searchSuggest`）
- 扫码登录（QQ 协议需 MQTT，参见 `qq-music/Cargo.toml` 注释；当前用 cookie 粘贴方案）
- 账号密码 / 手机验证码登录

## 调试与日志

- Rust：`env_logger` 默认 `info` 级，输出前缀 `[startup]` / `[login_qr_key]` / `[login]` 等。
- 启动时把 cookie 写到文件这一步，文件位于 OS 配置目录（Windows: `%APPDATA%\nnplayer\auth\session.toml`）。
- 前端日志走 `console.warn/error`，没有集成前端日志库。
- localStorage 持久化键：
  - `nnplayer.volume` — 音量（0~1）
  - `nnplayer.sidebarCollapsed` — 侧栏折叠（"1" / "0"）
  - `nnplayer.lyricWindow.geometry` — 桌面歌词窗位置/大小 JSON（主窗写，子窗通过 control 事件推）
  - `nnplayer.lyricWindow.prefs` — 桌面歌词窗本地偏好（fontSize / opacity / textColor / locked / showPrevNext）

### QQ 会话持久化（独立于 NCM）

TOML 文件：`%APPDATA%\nnplayer\auth\session_qq.toml`（与 `session.toml` 平行）
auth.json 新增字段：`qq_cookie`（与 `cookie` 平行）
启动恢复：`lib.rs::restore_session` 同时校验两边，QQ 仅做"存在性"恢复（不主动 probe QQ 后端），由前端首次调用 `qq_get_auth_state` 触发按需清理。

## 5 阶段升级成果

完整设计文档在 `docs/agent-prompt.md`（已 gitignored，本地查阅）。
每阶段 changelog 也在 `docs/changelog/phase-{1..5}.md` 下。

## 已修复 bug 备忘

避免下次相同问题重新踩坑：

- **登录后头像还是橘黄色字母占位**（commit `956ab3a` + `e361689`）：
  - 根因 1：Rust 端 `QrCheckResponse` 原本**丢弃** `finalize_login` 返回的 `avatar_url`（`avatar_url: _`），前端 `userStore` 三种登录方法也不写 `avatarUrl.value`。
  - 根因 2：启动恢复时 `lib.rs::restore_session` 只校验 cookie 是否有效，不直接喂 `AuthState` 给前端；启动期间 sidebar 渲染时 `avatarUrl` 还是空字符串。
  - 修复：5 处同步（Rust DTO → Rust 透传 → 前端类型 → 前端 store → 前端模板消费），见上"新 Tauri command 必须 5 处同步"和 commit `e361689`。
  - 启事：所有"新增/扩展登录相关字段"必须 5 处同步，**`auth.json` 不等于 `session.toml`，二者都要写**。

- **歌词一行太长时多出部分与下一行重叠**（commit `e361689`）：
  - 根因：`.lyric-line` 锁死 `height: 36px` + `line-height: 36px`；长文本自然换行后内容溢出格子边界。
  - 修复：改 `min-height: 36px; line-height: 1.6;` + `white-space: nowrap; text-overflow: ellipsis` 单行截断；`ResizeObserver` 实测每行 `offsetHeight` 累加 `targetY`，不再依赖固定公式；当前行卡拉OK 改双层 span + 双向 `clip-path`（已唱/未唱），字符始终单行 inline-block。
  - 启事：任何"假设每行等高"的滚动/定位逻辑都是定时炸弹；行高必须用 `ResizeObserver` 测实际值。

- **桌面歌词窗关不掉 / 工具栏无反应 / 仍有"框"感**（`plan.md` PR）：
  - 根因 1（关不掉）：见上 "Tauri v2 关键陷阱 #1" — 一旦前端注册了 `tauri://close-requested` 监听器，Rust 自动 `prevent_close()` 让 `close()` 静默失败。修复：关窗走 `destroy()`，根本不要注册 close-requested 监听器。
  - 根因 2（工具栏滑块拖不动）：按钮 `@mousedown.stop` 误打到 range input 上阻止了原生拖拽。修复：按钮 `.stop` 即可，滑块容器**不** `.stop`。
  - 根因 3（"框"感）：Windows 给无边框窗口默认加投影；容器 `opacity: 0.95` + `text-shadow` 组合让矩形边界凸显。修复：构造时 `shadow: false` + 容器 `background: transparent` + 内容层 `background: transparent !important`。
  - 根因 4（高度浪费）：窗高 300px 上下行间距过大。改 120px + 4 行紧凑布局。
  - 启事：所有"独立 webview 窗口"都要把这一组陷阱（destroy / shadow / background / range stop）当成 checklist。

- **QQ song id 类型转换**：
  - 根因：QQ song id 是字符串（mid），但 `Song.id: number` 已固定。直接用数字会导致 QQ API 收到 hash 折叠后的 u64 而找不到歌。
  - 修复：在 `Song` DTO 加 `qq_mid?: string` 字段（`qq_song_to_dto` 自动填充），`useAudioPlayer.playSong` / `useLyric.loadFor` 按 `song.platform === "qq"` 分发时读 `song.qqMid` 而非 `String(songId)`。
  - 启事：所有"跨平台 id 类型不一致"问题都应通过 DTO 新增原 id 字段解决，**不要**在后端做有损哈希后再试图还原。

- **新 Tauri command 必须 5 处同步** 对 QQ 同样适用（见"多平台架构 / 5 处同步规则"）。

## 给后续开发者的注意事项

- 新增 Tauri command → 5 处同步（见"关键设计约定 / 前端 / 第 5 条"）。
- 新增 QQ 平台 command → 5 处同步（见"多平台架构 / 5 处同步规则对 QQ 同样适用"）。
- 改 NCM 解析逻辑时核对上表里的字段名差异。
- 不要把 `ncm-api-rs` / `qq-music` 当成"会用就行"的黑盒；它们就在同仓库 `../ncm-api-rs/` 和 `../qq-music/`，必要时可以直接阅读其源码。
- 没有专门的测试目录（`__tests__` / `tests/`）；新增功能建议从 Rust 端开始加单元测试（ncm-api-rs / qq-music 内部已有 clippy / rustfmt 配置 `rustfmt.toml` `clippy.toml`）。
- 新增歌词相关能力 → 改 `commands/lyric.rs` + `composables/useLyric.ts` + `components/LyricPanel.vue` + `stores/desktopLyrics.ts` 四件套；解析逻辑集中在 `utils/lrcParser.ts`。
- 新增桌面歌词窗口能力 → 还要改 `composables/useDesktopLyricsBridge.ts`（子窗订阅）+ `composables/useWindowGeometry.ts`（位置持久化）+ `composables/useLyricWindowPrefs.ts`（本地偏好）；事件通道见上文表格。
- 新增 QQ 音乐能力 → 改 `commands/qq_*.rs` + `composables/useQqApi.ts` + `types/music.d.ts`（必要时）+ `commands/shared/song_mapper.rs`（DTO 边界）；4 件套。`useAudioPlayer.ts` / `useLyric.ts` 的 platform 分发是单点修改。
- 新增 skeleton 加载态 → 用 `components/SkeletonCard.vue`（list / grid 两种 variant），不要在每个页面里重复写 shimmer CSS。
- 主题色相关的工具组件（如浮层、桌面歌词）应考虑是否消费 `themeStore`；但 `DesktopLyrics.vue` 故意不消费，保持黑底白字以避免阅读疲劳。
- 全局快捷键改键时需同步修改 `lib.rs::register_global_shortcuts` 和 emit 名称；前端 `useTauriBridge.ts` listen 用同一事件名。
- 浮层播放器背景 `bg-card/85 backdrop-blur-xl` 依赖 WebView2 模糊支持，Windows 11 默认开启。
- 桌面歌词窗是"独立 webview 窗口"，新增类似窗口（如悬浮搜索）请先把"destroy / shadow / background / range stop / 权限"五项 checklist 跑一遍。
- 桌面歌词窗是"独立 webview 窗口"，新增类似窗口（如悬浮搜索）请先把"destroy / shadow / background / range stop / 权限"五项 checklist 跑一遍。
