# AGENTS.md

`nnplayer` — Tauri v2 + Rust + Vue 3 + TypeScript 网易云音乐桌面客户端。Rust 端通过本地 crate `../ncm-api-rs` 调用 NCM API，前端通过 `@tauri-apps/api` `invoke` 桥接。

> 本文件是 agent 的权威指引。根目录 `CLAUDE.md` 已**过时**（停留在 MVP 阶段，缺本地音乐库 / 双后端音频引擎 / 桌面歌词窗 IPC 三大块），如冲突以本文件为准。

## 命令

```bash
npm run dev                  # 仅前端 Vite（端口 1420，HMR 1421，strictPort）
npm run build                # vue-tsc --noEmit + vite build（产物 dist/）
npm run tauri dev            # beforeDevCommand 自动起 Vite + Cargo 编译 + Tauri 窗口
npm run tauri build          # 前端构建 + cargo build --release + NSIS 安装包
cd src-tauri && cargo check  # Rust 类型检查（不链接）
cd src-tauri && cargo clippy # Rust lint
```

**改 Rust 后必须重跑** `cargo build`（或 `cargo check` 仅类型），前端 HMR 不会自动重编 Rust。

## 架构要点

```
src/                          # Vue 3 + TypeScript 前端
  main.ts                     # Pinia → userStore.refresh()（异步）→ Router → mount
  router/index.ts             # createWebHashHistory, 登录守卫, /desktop-lyrics 跳过登录
                              # 公共路由: /local-music, /local-album/:name, /local-artist/:name
  stores/                     # user / player / theme / desktopLyrics / localLibrary
  composables/
    useNcmApi.ts              # 所有 invoke 入口（命令名 + 包装函数）
    useAudioPlayer.ts         # 单例：双后端路由（NCM <audio> vs Rust 引擎）
    useAudioBridge.ts         # 单例：bridge.state + 200ms poll（独立于 watch 的兜底）
    useLocalCover.ts          # path → blob URL 全局缓存（多歌共享，同专辑走同一 entry）
    useCoverLoader.ts         # 并发 8 封面懒加载 worker pool（三个本地视图共用）
    useLyric.ts               # 模块级单例：state + watches + 推桌面歌词（不在实例里）
    useSpringScroll.ts        # 歌词弹簧滚动
    useTauriBridge.ts         # 主窗 ↔ 桌面歌词窗 IPC 监听
    useDesktopLyricsBridge.ts # 桌面歌词窗订阅：listen 后 emit request-snapshot 握手拿首帧
    useLyricWindowPrefs.ts    # 桌面歌词窗本地偏好（字号/不透明度/锁定，键 nnplayer.lyricWindow.prefs）
    useWindowGeometry.ts      # 桌面歌词窗几何持久化（子窗→主窗 IPC，子窗不能跨窗读写主窗 localStorage）
  components/                 # UI 组件
  views/                      # 路由级页面（含 LocalMusic/LocalAlbum/LocalArtist 三个本地页面）
  types/music.d.ts            # 与 Rust models.rs camelCase 严格对齐的 DTO 契约
src-tauri/                    # Rust 后端
  src/lib.rs                  # 插件注册 + AppState manage + generate_handler! 全路径注册
  src/state.rs                # AppState { api: Arc<Mutex<ApiClient>>, auth: Arc<Mutex<AuthState>> }
  src/error.rs                # AppError 枚举 + Serialize → { kind, message }，map_ncm_err 在此
  src/models.rs               # 精简 DTO（仅返回前端需要字段）
  src/commands/               # auth / user / music / lyric / window_geom / audio / local_music
  src/audio/                  # ★ 本地音频引擎：symphonia 解码 + rodio 播放
    mod.rs                    # 公共接口
    engine.rs                 # AudioEngine（symphonia Source + rodio Player + eof_monitor）
    state.rs                  # InternalState（path/playing/current_time/duration/play_offset/play_started_at）
ncm-api-rs/                   # 本地 crate（weapi/eapi 加密、设备指纹、Set-Cookie 捕获）
vendor/brotli/                # 绕开 brotli 8.0.3 nightly 编译错误（Cargo.toml [patch.crates-io]）
```

## 关键约定

### 新增 Tauri command → 5 处同步
1. `commands/<domain>.rs` 实现
2. `commands/mod.rs` 加 `pub mod <domain>;`
3. `lib.rs` `generate_handler!` **全路径**注册（不能用 `pub use` 转发，宏会找不到 `__cmd__xxx` helper，报 E0433）
4. `composables/useNcmApi.ts` `Commands` 常量 + 函数
5. `src/types/music.d.ts` DTO（camelCase 严格对齐）

### Rust
- 业务代码严禁 `unwrap()`/`expect()`。所有 `#[tauri::command]` 返回 `AppResult<T>`。新增错误变体同步更新 `AppError::Serialize`。
- `tauri = { default-features = false, features = ["wry", "tray-icon", "image-png"] }` — tray 在主 crate 内置，**没有** `tauri-plugin-tray`。
- `reqwest` 用 `rustls-no-provider` + `ring`：`lib.rs::run()` 开头**必须** `rustls::crypto::ring::default_provider().install_default()`（首次构造 Client 前），否则 NCM HTTPS 请求 panic。换 crypto provider 要同步改这里。
- `AudioEngine` 由 `app.manage(Mutex<AudioEngine>)` **独立**管理（不在 `AppState` 内）。audio 命令用 `State<'_, Mutex<AudioEngine>>` 提取，与 `State<'_, AppState>` 分开两个参数。
- `map_ncm_err` 在 `error.rs`（各 command 子模块用 `crate::error::map_ncm_err`），不在 `commands/auth.rs`。
- 从 `ApiResponse.body` 用 JSON pointer 抽字段构造精简 DTO，不要返回 NCM 原生 JSON。
- `restore_session` 在 `lib.rs`，启动时校验 session.toml 有效性。

### 前端
- 所有 `invoke` 走 `composables/useNcmApi.ts`，组件**严禁直接** `invoke`。
- `<audio>` 操作走 `composables/useAudioPlayer.ts`（单例，`onBeforeUnmount` 清理）。
- CSS 变量驱动主题色：`tailwind.config.js` 的 colors 引用 `var(--color-*)`，默认值在 `styles.css` `:root`，切歌时 `themeStore.applyFromCover` 改写。
- 路径别名 `@/*` → `src/*`（`tsconfig.json` + `vite.config.ts` 各自声明，改一处必须同步另一处）。

### NCM API 字段名差异（重要）

| 接口 | 时长字段 |
|---|---|
| `/search`（`search_songs` 调 `cloudsearch`） | `duration` |
| `/recommend/songs`（`get_daily_recommend`） | `dt` |
| `/playlist/detail`（`get_playlist_detail`） | `dt` |

`parse_ncm_song(s, duration_field)` 在 `models.rs`，先取传入字段 → fallback `dt` → fallback `duration` → `0`。改解析逻辑时三处一起核对。

### YRC 逐字歌词
`yLrc` 格式：`[行偏移,行时长](字偏移,字时长,音量)字`，字偏移是**绝对时间戳**（毫秒）不是相对行偏移。解析在 `utils/lrcParser.ts::parseYrc`。

## 双后端音频架构

**核心**：NCM 在线歌曲用 HTML5 `<audio>`，本地 FLAC/MP3/M4A 等用 Rust symphonia+rodio 引擎。组件层不感知差异。

```
playSong(songId, song)
  ├─ song.localPath ?
  │   ├─ 是 → Rust 引擎（playLocal invoke）
  │   └─ 否 → <audio>（audio.src = ncmUrl）
```

### Rust 音频引擎关键点
- `src-tauri/src/audio/engine.rs::AudioEngine`
- **位置跟踪用 `Instant` 时钟**：`play_offset + (Instant::now() - play_started_at)`，**不要**用 `Player::get_pos()`（rodio 0.22 会被 audio buffer 拖累不准）
- `play/pause/resume` 都要更新 `play_started_at` 和 `play_offset` 保持时钟连贯
- `seek` 走 `play(path, time)` 重建 source（rodio 0.22 的 `try_seek` 对自定义 source 返回 NotSupported）
- `stop_inner` 必须 `join` 旧 eof_monitor 后再启新的（防止 monitor 计数/状态泄漏）
- eof_monitor 用 `mpsc::channel` + `recv_timeout(200ms)` 双用：EOF 信号 + 周期性 tick emit `audio:tick`

### 前端桥梁三层兜底
1. `useAudioBridge.audio:tick` 事件监听（更新 `bridge.state`）
2. `useAudioBridge` 200ms poll 直接 `getAudioState()` invoke（事件丢失兜底）
3. `useAudioPlayer` 200ms local poll 把 `bridge.state` 复制到 `controller.state`（Vue watch 失效兜底）

### 关键：`seekingInProgress` 标志
- `seek()` 调用时设 true，**local poll 跳过 state 覆盖**（避免 Rust 端重建 source 期间 bridge.state 暂存旧值拉回 UI 闪烁）
- 5s 超时兜底（Rust seek 失败时强制解除冻结）
- 检测 `Math.abs(bridge.state.currentTime - state.currentTime) < 0.5` 表示已追上，自动解除

## 本地歌曲完整链路

### 扫描
- `commands/local_music.rs::scan_local_folder` 递归 `walkdir`，按 `SUPPORTED_EXTENSIONS` 过滤
- lofty 读 tag 拿 title/artist/album/duration/bitrate/sample_rate + has_cover 标志
- 写入 `lib.songs`（Pinia `useLocalLibraryStore`）

### 播放
- 走 `playLocal` invoke → Rust `play_local` 命令
- 前端 `useAudioPlayer.playSong` 本地分支：持久化到 `localStorage["nnplayer.currentLocalSong"]` 用于 WebView 刷新后恢复

### 封面
- 调 `getLocalCover(path)` invoke → lofty 读 tag → `image` crate 缩放 512×512 JPEG → 返回 bytes
- 前端 `useLocalCover` 缓存 path → blob URL（多歌共享，同专辑所有歌的封面走同一 cache entry）
- 三个本地页面通过 `useCoverLoader.loadCoversInto` 限流并发 8 懒加载（脚手架抽自三视图，复用 `useLocalCover` 全局缓存）

### 歌词
- 优先级：内嵌 USLT/©lyr/LYRICS → 同目录 `.lrc/.yrc/.qrc/.krc` → NCM 在线兜底
- `get_local_lyric` Rust 命令按上述顺序查
- `fetch_online_lyric` 用 title+artist 走 NCM cloudsearch，未登录静默返回 None
- **本地歌用了 NCM 在线歌词时，LyricPanel 显示提示**（"时间轴可能与本地歌曲不完全同步，可放置同名 .lrc 文件覆盖"）—— 用 `_source` 模块级 ref 跟踪

### WebView 刷新恢复
- Tauri WebView 刷新 = Vue/Pinia/`<audio>` 全销毁重建，但 Rust 引擎是独立进程级不会被销毁
- `useAudioPlayer.restoreIfPlaying()`：调 `getAudioState()` 拿 Rust 真实状态，对齐 `isLocal/currentPath/state.*`，**不调 `playLocal`**（避免重置位置）
- `playerStore.setCurrentSongOnly(song)`：塞队列但**不**调 `playCurrent`（同样避免重启）
- 触发时机：`App.vue onMounted` 早于任何 LyricPanel 挂载

## 本地音乐库数据模型

`useLocalLibraryStore` 暴露：
- `songs: LocalSongMetadata[]`（拍平）
- `albums: AlbumGroup[]` —— **复合 key** `${name}||${artist}` 避免"不同艺人同名专辑"合并
- `artists: ArtistGroup[]`
- `findAlbum(name, artist)` / `findArtist(name)`：详情页按 URL 解析时用

三个本地页面：
- `LocalMusic.vue` — 主页，3 tab（列表 / 按专辑 / 按艺人），专辑/艺人为网格
- `LocalAlbum.vue` — `/local-album/:name?artist=<artist>`，query artist 用于消歧
- `LocalArtist.vue` — `/local-artist/:name`

## 桌面歌词关键点

- `useLyric.ts` **state 全部模块级单例**（不要每个组件 `useLyric()` 都有自己的 ref）
- `initGlobalLyricBridge()` 由 `App.vue onMounted` 显式调一次，**早于**任何 LyricPanel 挂载
- 否则在 LocalMusic/PlaylistDetail 等无 LyricPanel 路由下，桌面歌词窗拿不到推送
- 桌面歌词窗是独立 WebView（独立 Pinia store），只能通过 IPC 拿主窗数据

## 运行时特性

### 持久化
- 会话**双份持久化**：`tauri-plugin-store` 写 `auth.json` + `directories` 写 `session.toml`（`%APPDATA%\nnplayer\auth\`）。修改登录字段必须两处都写。
- 音量 / 侧栏折叠：`localStorage` 键 `nnplayer.volume` / `nnplayer.sidebarCollapsed`
- 本地音乐扫描目录：`localStorage["nnplayer.localFolders"]`（JSON 数组）
- 当前本地歌曲（用于刷新恢复）：`localStorage["nnplayer.currentLocalSong"]`（JSON，含 id/name/artists/album/localPath）

### 全局快捷键
`Ctrl+Alt+P`（播放/暂停）、`Ctrl+Alt+←/→`（上下首）、`Ctrl+Alt+L`（桌面歌词）。改键需同步 `lib.rs::register_global_shortcuts` 和前端 `App.vue` listen 的事件名。

### 窗口
- 桌面歌词独立窗口透明背景、always-on-top，**不消费** `themeStore`（黑底白字防阅读疲劳）
- 窗口位置/大小由 `tauri-plugin-window-state` 自动持久化（排除 `desktop-lyrics`）
- `window_geom::is_position_on_screen`：桌面歌词窗口恢复位置前做边界校验（防拔副屏后窗口消失）
- 浮层播放器 `bg-card/85 backdrop-blur-xl` 依赖 WebView2 模糊支持（Win11 默认开启）

### 打包绕过
NSIS 跨盘 `%TEMP%` 打包有时报 `os error 17`：绕过 — 直接分发 `src-tauri/target/release/nnplayer.exe`。
