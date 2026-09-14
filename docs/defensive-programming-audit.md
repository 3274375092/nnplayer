# 防御性编程审计（前端 `src/`）

审计范围：`src/` 下 51 个 TS/Vue 文件、约 9.6k 行。方法：统计防线密度 → 逐个打开含 `catch` / `??` / clamp 的位置读上下文 → 与 `tests/` 的覆盖情况对照。

## 1. 结论

**防御性编程在这个仓库里是"边界重、内核轻"，形状是对的。** 唯一成体系的缺陷不在数量，而在**壳层（stores / composables / views）的无声降级**：纯函数层的守卫有 81 个测试覆盖（含敌意输入用例），壳层的守卫基本零覆盖，且失败时的降级动作没有任何观测出口。

| 指标 | 数量 | 位置 |
| --- | --- | --- |
| `try {}` / `catch` | 50 / 31 | 约每 190 行一处 |
| `??` | 71 | 主要是跨窗口/持久化读取的兜底 |
| `typeof` / `instanceof` | 59 / 13 | 集中在 IPC 载荷校验 |
| `Number.isFinite` | 34 | 几乎全在播放位置与歌词时间 |
| `throw new` | 4 | 内核 fail-fast，不靠层层兜底 |

防线密度（每百行）：`stores` 7.2 > `lyrics` 4.7 ≈ `composables` 4.5 > `playback` 2.9 > `utils` 2.0。

## 2. 判定标准

判断一条防线该不该留，只看它在保护什么：

1. **护信任边界**（用户输入、IPC、localStorage、Tauri API、浏览器能力探测）→ 该重就重，越多越好。
2. **护内部不变量**（上一行自己刚写下的数据）→ 出现在算法中段就是在掩盖 bug，应改为类型约束或直接 `throw`。
3. **降级不得静默改变语义** → 允许降级，但必须留下可观测痕迹（注释说明 + 至少一条 warn），且降级方向必须是安全的那一侧。

按第 3 条衡量，本仓库的问题不是"太防御"，而是**几处降级既不安全也不出声**。

## 3. 健康的部分（不建议削减）

这些空 `catch` / `.catch(() => {})` 都注明了"为什么可以忽略"，属于**有意的能力探测降级**，不是掩盖错误：

| 位置 | 模式 | 为何健康 |
| --- | --- | --- |
| `src/playback/mediaSessionAdapter.ts:67,78,93,118` | 空 catch | WebView 不支持 `MediaMetadata` / `setPositionState`；卸载时反向注销也要幂等 |
| `src/composables/useDesktopLyricsPublisher.ts:44,51,65,70` | 空 catch | 隐私模式可能同时禁用 `sessionStorage` 与 `localStorage`，下游还有 epoch floor 兜底 |
| `src/playback/playbackEngine.ts:349` | `.catch(() => {})` | 预取失败不影响当前播放，切歌时会重试 |
| `src/stores/player.ts:32,87` | 空 catch | localStorage 不可用不应中断播放控制 |
| `src/stores/desktopLyrics.ts:111-123`、`src/views/DesktopLyrics.vue:282-294` | destroy → close 双路径 | Tauri v2 注册 `close-requested` 会被 Rust 端自动 `prevent_close`，注释甚至给了 Cargo 源位置 |
| `src/lyrics/desktopLyricsSync.ts` 全套校验器 | 类型守卫 | 挡跨窗口 IPC 载荷；`tests/desktopLyricsSync.test.mjs` 有 malformed snapshot / invalid session / stale anchor 等 19 个用例 |
| `src/stores/user.ts:172-185` | 吞掉后端 logout 失败 | 意图明确：本地登出不被服务端故障阻塞 |

`desktopLyricsSync.ts` 那批校验器是本仓库防御性编程的最佳样本：**校验发生在信任边界，纯函数内核收到的是已判定合法的数据，且每条拒绝路径都有测试。**

## 4. 需要处理

### P1 — 降级方向错了，或降级本身就是坏动作

**P1-1 `src/App.vue:19-25`：`isDesktopLyrics` 失败时向"我不是桌面歌词窗"降级**

```ts
const isDesktopLyrics = computed(() => {
  try {
    return getCurrentWindow().label === "desktop-lyrics";
  } catch {
    return false;   // ← 未知 → 按主窗处理
  }
});
```

第 27-30 行的注释写明"桌面歌词 WebView 不能实例化主窗口 player/audio/MediaSession runtime"。可一旦 `getCurrentWindow()` 抛错，函数返回 `false`，桌面歌词窗就会被当作主窗：实例化完整播放器、注册 MediaSession、跑 `useCoverTheme()`。**守卫把"检测失败"和"我是主窗"合并了，失败方向不安全。** 只在 Vite 浏览器预览（无 Tauri runtime）时 `false` 才是正确默认值。

建议：区分两种失败——无 Tauri runtime（`!isTauri()`）返回 `false`；有 runtime 但取 label 失败时返回 `true`（按更受限的桌面歌词窗保守处理）并 `console.warn`。更彻底的做法是从 `__TAURI_INTERNALS__.metadata.currentWindow.label` 或 `location.hash` 取，不依赖可能抛错的 API。

**状态：已修复** —— `src/App.vue:19-31` 按上述方向改写（`!isTauri()` → `false`；label 读取失败 → `true` + warn）。

**P1-2 `src/stores/desktopLyrics.ts:133-152`：`toggleWindow` 静默 catch + 猜测式回退**

```ts
} catch {
  // getByLabel 异常时退化到 isOpen 判断
  if (isOpen.value) { await closeWindow(); } else { await openWindow(); }
}
```

两个问题：

1. 无日志。`WebviewWindow` IPC 故障是这里唯一能进 catch 的原因，而它对用户表现为"点了没反应"，零诊断线索。
2. 回退路径走的是**同一条已经失败的 IPC**：`closeWindow()`/`openWindow()` 内部同样调 `getByLabel`，几乎必然再失败；更坏的是它依据 `isOpen` 这个缓存布尔值决定动作——而第 132 行注释自己说"不信任 isOpen 缓存"。窗口不存在时若 `isOpen` 为 `true`，会走 `closeWindow()`，把 `finally { isOpen.value = false }` 落成"显示为已关闭"而实际没关，UI 与系统状态永久失配。

建议：删掉这个 catch，让错误上抛给已有处理者——调用方 `src/composables/useTauriBridge.ts:33-39` 已经包了 `try/catch` 并 `console.warn`。回退猜测在这里没有安全版本。

**状态：已修复** —— `src/stores/desktopLyrics.ts:131-147` 移除该 catch；两个调用方（`useTauriBridge.ts:33-39`、`Sidebar.vue:153-159`）都已 `try/catch` + warn，确认无遗漏调用点。

### P2 — 静默降级，可观测性为零（全部已修复）

**P2-1 `src/stores/desktopLyrics.ts:28-44`：几何持久化损坏被无声吞掉**

`JSON.parse` 失败或字段不合法 → `return undefined`，既无 warn 也不清理坏 key。用户侧的体验是"窗口位置总是记不住"，而这条路径不留任何痕迹。建议 `console.warn` 并 `localStorage.removeItem(GEOM_KEY)`，让损坏自愈。

**状态：已修复** —— 拆出 `readStoredGeometry()`：读取失败（隐私模式）与内容损坏分开处理，后者 warn + 清除坏 key；`isPositionOnScreen` 的 IPC 失败单独 warn，不清 key。

**P2-2 `src/stores/desktopLyrics.ts:158-165`：`syncFromSystem` 失败即宣告"窗口未打开"**

`catch { isOpen.value = false }` 无注释无日志。把"查询失败"等同于"不存在"，与 P1-2 同类。建议加 warn。

**状态：已修复** —— 保留降级（UI 只能先按未打开展示）但补 warn 与理由注释。

**P2-3 `src/composables/useWindowGeometry.ts:24-34,53-55`：整条几何保存链路无声**

`save()` 里外两层 —— `outerPosition()/outerSize()` 的 `catch {}` 与 `emit(...).catch(() => {})` —— 都没有日志；第 53-55 行的监听注册失败也只有一行注释。后果：位置持久化静默失效（正好和 P2-1 构成同一个用户可见症状，但两条路径互不可见）。这是低频路径（300ms 防抖后的移动/缩放），加一条 warn 不会刷屏。

**状态：已修复** —— 三处各补一条 warn（读取几何 / 发送几何 / 注册监听）。

**P2-4 `src/components/Sidebar.vue:75-79`：建议失败 == 没有建议**

搜索建议请求失败时静默清空下拉并关闭浮层。用户无法区分"没有匹配"和"网络/后端坏了"。建议保留降级但加 `console.warn`（已用 `inFlightSeq` 防止过期写入，没有刷屏风险）。

**状态：已修复** —— 补 warn，降级行为不变。

**P2-5 `src/composables/useNcmApi.ts:37-46`：第三份错误 kind 清单**

`APP_ERROR_KINDS` 是 `AppErrorPayload["kind"]` 联合类型的运行时复制品，而 `docs/ipc-surface.md:31,366` 已声明 `AppErrorPayload` 对应 Rust 的 `AppError`。同一条枚举现在有三处（Rust `error.rs` / `types/music.d.ts` / 这个 Set），且不一致的后果是**静默降级为 `"Unknown"`**——调用方按 `kind` 分支的逻辑会悄悄走错分支。

2026-02 复核：Rust `error.rs:13-36` 的 8 个变体与 `types/music.d.ts:76-87`、前端 Set 目前**完全一致**，没有现存漂移；问题在于缺一个让漂移暴露的机制，而非已经漂移。

**状态：已修复** —— 改为 `Record<AppErrorPayload["kind"], true>` 声明清单再取 `Object.keys`：新增 kind 时缺键或多键都编译失败，`satisfies` 只检查单向兼容所以不够（它不会发现"联合类型多了一个却没人加进数组"）。当前项目未安装 ESLint，这条约束由 `vue-tsc` 承担。

**P2-6 `src/composables/useQueryCache.ts:334-357`：一个返回值承载三种结局**

`execute()` 在"缓存命中"、"被更新的 revision / auth epoch 取代"、"请求失败"三种情况下都可能返回数据或 `undefined`；失败时靠写 `error.value` 传达。当前 4 个调用点（`DailyRecommend.vue:20,39`、`MyPlaylists.vue:22,30`、`PlaylistDetail.vue:28,37`、`Search.vue:24,40`）都消费了 `error`，所以现在是对的——但这条契约只存在于实现里，新调用点漏读 `error` 会得到静默空态。建议把契约写进 `execute` 的 JSDoc（"失败不抛，返回 `undefined` 且写入 `error`"），并明确 epoch 变更属有意取消、不置 `error`。

**状态：已修复** —— 契约写进 `execute` 的 JSDoc；行为未改（现在是对的）。

**P2-7 `src/composables/useLyric.ts:363-370`：丢弃原始错误对象**

`error.value = e instanceof Error ? e.message : "歌词加载失败"`，原始 error 连同 `AppError.original` 一起丢掉，与 `useNcmApi.ts:24-35` 刻意保留 `original` 的做法不一致。建议 `console.warn` 保留现场，或把 error 存进 `cause`。

**状态：已修复** —— 写 UI 消息前先 `console.warn` 原始错误对象。

### P2 二次复查 —— 同类漏网（已一并修掉）

第一次改完后按"无注释 + 无日志"重新全量扫描 `src/`，又抓到 4 处同类，处理方式不同：

| 位置 | 处理 | 理由 |
| --- | --- | --- |
| `src/composables/useLyricWindowPrefs.ts:69` | warn | 偏好读取失败回默认值，用户看到"设置自己变回去了" |
| `src/composables/useDesktopLyricsPublisher.ts:156` | warn | appearance 同步失败，低频（仅 activate 与色调变化） |
| `src/views/DesktopLyrics.vue:233` | warn | `startDragging` 失败表现为"拖不动"，是用户显式手势 |
| `src/composables/useDesktopLyricsBridge.ts:42` | **只加注释** | `snapshotRecovery` 会按 burst（500ms/1500ms）与 watchdog（每 2s）继续重试，逐次 warn 会在主窗不可用期间刷屏 |
| `src/utils/coverImage.ts:66` | 只加注释 | 非 URL 属正常输入（相对路径、data:/blob:），按 JSDoc 契约原样返回 |

复查结论：`src/` 中已不存在"既无注释又无日志"的 `catch`。剩余 18 处 `catch {` / `.catch(() => {})` 全部要么带降级理由注释，要么已加 warn —— "重试路径上的失败"用注释、"一次性/用户触发路径上的失败"用 warn，这条分界建议保持。

### P3 — 低价值防御（可留，可删，但要知道它不干活）

- `src/lyrics/lyricViewport.ts:40-41`：`prefix[range.start] ?? 0`。`prefix` 是 `Float64Array` 且长度为 `count + 1`，任何合法索引都读得出数值，`??` 只可能在 `range` 越界时触发——也就是说它不提供容错，只是把调用方的越界错误换成一个错误的 padding 值（顶部少算一段）。与 `lyricViewport.ts:16` 的夹紧是同一个模式的两次出现：**用兜底值掩盖越界，而不是让它可见。**
  （注意同一文件第 30 行的 `heights[index] ?? fallbackHeight` **是有效且被测试的契约**：`tests/lyricViewport.test.mjs:45` 明确覆盖"测量高度数组短于行数"的补齐，不要删。）
- `src/lyrics/lyricViewport.ts:16`：`Math.min(activeIndex, count - 1)` 把上越界的 `activeIndex` 静默夹紧成"渲染最后一屏"。测试只覆盖 `-1` 与界内值（`tests/lyricViewport.test.mjs:30-41`），没有覆盖 `activeIndex >= count`。渲染层容忍越界可以接受，但"越界"本身是上游 bug 的信号，建议 dev 断言或一次 warn。
- `src/playback/playbackEngine.ts:311-314`：`songUrlCache.keys().next().value as number | undefined` 的 `undefined` 分支不可达（`size > LIMIT` 保证非空）。是 TypeScript 需要而非运行时需要，可加一行注释说明。
- `src/playback/mediaSessionAdapter.ts:86`：`!Number.isFinite(s.duration) || s.duration <= 0` 校验的是引擎自己的状态。适配层自检可以接受（`setPositionState` 对坏值会抛），但要在注释里点明这个不变量来自 Playback Engine。

## 5. 建议固化的两条规则

1. **`catch` 必须二选一**：要么附注释说明为什么可以忽略，要么 `console.warn` 后降级。禁止"既无注释又无日志"的 catch —— 本次修掉的 P1-2、P2-1～P2-4 都是这一类。ESLint 的 `no-empty` 允许仅含注释的块，而本仓库当前没有 ESLint，所以这条暂时只能靠评审约束"降级不得无声"。
2. **降级方向必须是安全侧**：能力探测失败时选更受限的能力集（P1-1 的反例）；"查询失败"不得等同于"对象不存在"（P1-2、P2-2 的反例）。

## 6. 覆盖情况

纯函数与内核（`lyricFrame`、`lyricViewport`、`desktopLyricsSync`、`desktopLyricsTransport`、`lrcParser`、`themeTokens`、`playbackEngine`、`coverImage`、`format`）有 81 个测试，敌意输入路径覆盖良好。**第 4 节列出的问题全部落在没有测试的壳层**（stores / composables / views），这也是它们能长期静默存在的原因。若第 5 节规则要落地，建议同时为 `useQueryCache.execute` 与 `desktopLyrics` store 补测试。
