# 歌词同步与闪回问题排查记录

> 本文档记录 nnplayer 在做"桌面歌词 + 卡拉OK 逐字染色"过程中遇到的一系列同步/闪回问题，以及逐层排查得到的根因与解决方案。这些问题层层递进，每修一个就暴露下一个，最终归结到一个关于"插值锚点同步不变量"的核心教训，值得留存。

## 架构背景

- **Tauri v2 + Vue 3** 桌面播放器。
- **主窗**持有唯一 `<audio>` 元素（由 Playback Engine `src/playback/playbackEngine.ts` 经 `src/playback/htmlAudioRuntime.ts` 创建，`src/stores/player.ts` 装配为全局单例）。
- **桌面歌词**是独立 webview 窗口（`src/views/DesktopLyrics.vue`），**没有 audio 元素**，100% 靠 IPC 事件接收主窗推送（`src/composables/useDesktopLyricsBridge.ts`）。
- 主窗 `useLyric.ts` 监听 `audioState.currentTime`，计算 `activeLineIndex` / `progressMs`，节流 250ms 后 `emit("desktop-lyrics:update", payload)` 推给子窗。
- 卡拉OK 染色：双层 span + `clip-path` 从左往右擦除，靠 CSS 变量 `--lyric-pct` / `--char-pct` 控制已唱百分比。

关键时间基准差异：

| 来源 | 频率 | 性质 |
|------|------|------|
| `<audio>` timeupdate 事件 | ~4Hz | 离散、**滞后实时约 100~250ms**、**非单调（±几十 ms 抖动）** |
| `performance.now()` 墙钟 | 60fps (rAF) | 连续、实时、单调 |

这两个基准不同步是后面几乎所有闪回问题的总根源。

---

## 问题 1：关闭主窗音乐停止（缺"关闭到托盘"）

### 现象
点窗口 X → 音乐立刻停，托盘"显示主窗"再也点不回来。

### 根因
项目已建好托盘（`src-tauri/src/lib.rs` `build_tray`），但**主窗没有拦截关闭请求**——全项目搜不到 `on_window_event` / `CloseRequested` / `prevent_close`。`<audio>` 在主窗 webview 里，主窗 destroy → audio 连带销毁 → 音乐停。托盘 show 分支拿到 `None` 再也点不回。

### 解决
`src-tauri/src/lib.rs` Builder 上加 `on_window_event`，只对 `"main"` 生效：

```rust
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
            api.prevent_close();
            let _ = window.hide();
        }
    }
})
```

点 X = 隐藏（audio 不销毁、音乐继续）；托盘"退出" = `app.exit(0)` 真退出；左键托盘 = 还原窗口（已有逻辑）。

> 注：代码里"Tauri v2 只要注册 close-requested 监听器就自动 prevent_close"的注释指的是**前端 JS 的 `onCloseRequested`**；Rust 端 `on_window_event` 是显式调 `api.prevent_close()`，行为可控。

---

## 问题 2：桌面歌词卡顿、"两个字两个字变色"、"完全没对上"

### 现象
桌面歌词颜色跳着变、两个字一组变色、颜色进度和人声对不上。

### 根因（三个叠加）
1. **推送节流 250ms（4Hz）**：`useLyric.ts` `pushUpdateToDesktop` 用 `setTimeout(250ms)`。子窗 100% 靠推送，`--lyric-pct` 每 250ms 才跳一次。
2. **渲染是整行线性擦除，忽略逐字时间戳**：`DesktopLyrics.vue` 算 `pct = progressMs / span`（span = 整行时长），从左往右匀速擦。模板虽 `v-for` 渲染了 `karaokeTokens`，但**只取了 `t.char`，没用 `startMs/endMs`**。即使网易云给了 YRC 逐字时间戳也被忽略。
3. **250ms 一跳 + `transition: clip-path 0.1s linear`**：每 250ms 跳一格，CSS 只补 100ms、剩 150ms 停住 → "跳-停-跳-停"观感 = "两个字两个字变色"。

### 解决（双层架构 + 逐字三态）
- **payload 加 `playing` 字段**：子窗据此决定本地时钟是否前进。
- **行切换立即推**（`flushPush`）：绕过 250ms 节流，避免新行首字延迟。
- **子窗 rAF 60fps 本地时钟**：收到推送记锚点 `(progressMs, playing, now)`，rAF 用 `performance.now()` 累加 `localProgressMs`，每帧更新 `--char-pct`。
- **逐字三态渲染**：每个 token 用 `startMs/endMs` 算字内已唱百分比，每字独立双层 span 字内擦除。无 YRC 时回退整行线性擦（同样走 rAF 插值）。
- 去掉 `transition: clip-path`——rAF 每帧更新，CSS 补间反而让逐字失同步。

---

## 问题 3：桌面歌词换行后一秒内变色闪回

### 现象
每次换行后约一秒内，颜色会闪回到开头重新擦。

### 根因
主窗推送的 `progressMs` **滞后于实时播放**（来自 4Hz timeupdate）。子窗 rAF 用墙钟累加 `localProgressMs` 是实时的。旧 `syncAnchor` **每次推送都无条件**把 `anchorMs` 设成主窗滞后值 → 下一帧 `localProgressMs = anchorMs + delta` 比上一帧**倒退** → 颜色闪回。

换行后最明显：snap 把 `localProgressMs` 重置为小值，rAF 快速往前跑，紧接着的滞后推送把 anchor 往回拉。

### 解决
`DesktopLyrics.vue` `syncAnchor` 同一行内 anchor 不允许回退：
- 行变化 / seek 大跳（`|delta| > 800ms`）→ snap 到主窗权威值
- 主窗领先 → 追赶
- 主窗滞后 / 暂停 → 保持子窗当前位置继续往前

---

## 问题 4：主窗歌词行切换滞后（"歌到下一行了还停上一行末尾"）

### 现象
歌曲已经唱到下一行，但卡拉OK 和行高亮还停在上一行末尾。

### 根因
`activeLineIndex` 和 `progressMs` 都由 `watch(() => player.audioState.currentTime)` 计算，而 `currentTime` 来自 timeupdate（4Hz、滞后实时 100~250ms）。行边界处：audio 实际已到 5050ms，上次 timeupdate 在 4900ms → `idx` 还在行A，直到下次 timeupdate(~5150ms) 才切行B。这 100~250ms 就是"行切换晚"。

### 解决
`useLyric.ts` 加 **rAF 播放时钟 `clockMs`**：用 `audio.currentTime` 做 snap 锚点，rAF 60fps 用 `performance.now()` 墙钟插值。`activeLineIndex`/`progressMs` 改由 `clockMs` 驱动 → 行切换精度从 ~250ms 提到 ~16ms。顺带推给子窗的 `progressMs` 也更实时。

---

## 问题 5：主窗闪回（timeupdate 抖动被放大）

### 现象
加了 `clockMs` 后主窗也出现闪回。

### 根因
旧 `snapClock` 的 `delta > 0` 分支**无条件追赶**。`timeupdate` 报告的 `currentTime` **非单调（±几十 ms 抖动）**，每次抖到偏大值就把 `clockAnchorMs` 往前推，rAF 跟着冲到那个偏大值，下一个偏小 `timeupdate` 又走"保持"分支不回拉 → `clockMs` 累积偏离 + 周期性"冲过头-被稳住-再冲" = 闪回。

### 解决
加 `TOLERANCE_MS = 120` 抖动容忍带 + 平滑追赶：
- `|delta| > SEEK_MS` → seek/切歌，强制对齐
- `delta > TOLERANCE_MS` → anchor 取 `clock` 与 `audio` **中点**平滑追赶（约 1 帧追上），不直接 snap
- `|delta| ≤ TOLERANCE_MS` → 抖动带内，anchor 不动，rAF 按墙钟自走
- `delta < -TOLERANCE_MS` → audio 滞后，保持 clock 继续往前

---

## 问题 6：换行时上一行/下一行些许闪回（弹簧与卡拉OK 不同步）

### 现象
换行时仍有微小闪回。

### 根因
`LyricPanel.vue` 两个动画系统节奏不同步：
- **卡拉OK 擦除是 60fps 即时**（`progressMs` 由 rAF `clockMs` 驱动），行一变 `--lyric-pct` 立刻归零。
- **滚动是弹簧物理**（`useSpringValue(targetY)`），`activeLineIndex` 变后 `targetY` 变，弹簧花几百 ms 才追到新位置。

结果：新行歌词**先在偏下位置出现并开始擦除**，弹簧再把它滚到中心 → "上一行还在、下一行冒出来又挪位"的闪回。

叠加 `lineHeights` 由 `ResizeObserver` 异步测量，换行后当前行高度更新会让 `targetY` 跳一下，弹簧再追这个跳变 → 微小抖动。

### 解决
- `useSpringScroll.ts` 给 `useSpringValue` 加 `snap(to)` 方法（清零速度+停 rAF+直接设值，不走弹簧）。
- `LyricPanel.vue`：
  - `watch(activeLineIndex)` → `snapSpringY(targetY)`：行切换瞬间滚动直接到位，和卡拉OK 归零同步。
  - `watch(lineHeights)` → `snapSpringY(targetY)`：吸收 ResizeObserver 异步测量导致的 targetY 跳变。

---

## 问题 7：经常性 4Hz 周期闪回（核心教训：anchor 同步不变量）

### 现象
上面都修完，主窗仍"经常闪回"，呈 4Hz 周期性。

### 根因（最关键）
`snapClock` / `syncAnchor` 开头**无条件**执行 `anchorTs = performance.now()`，但"保持 anchor"分支**不更新 `anchorMs`**。

`clockTick` 每帧算 `clockMs = anchorMs + (now - anchorTs)`。一个 timeupdate 周期（~250ms）内：

1. 上次设 `anchorMs=X`、`anchorTs=T0`，rAF 跑 250ms → `clockMs = X + 250`
2. timeupdate 来了，`delta` 在容忍带 → 走"保持"分支，`anchorMs` 不变（仍 = X）
3. **但 `anchorTs` 被重置成 now(T1)** → 下一帧 `clockMs = X + (T1 - T1) = X + 0`

`clockMs` 瞬间从 `X+250` **跳回 `X`**！rAF 再往前跑，下个 timeupdate 又跳回 → **4Hz 周期性闪回**。

### 解决（核心不变量）
**`anchorMs` 和 `anchorTs` 要么一起更新，要么都不动。**

主窗 `snapClock` 和子窗 `syncAnchor` 统一改成：
- seek / 切歌 / 首帧 → 两个一起更新（对齐权威值）
- playing 状态变化 → 两个一起更新（以当前值为新锚点，不跳值）
- 明显领先（`delta > TOLERANCE`）→ 两个一起更新（中点平滑追赶）
- 抖动带内 / 滞后 → **两个都不动**，rAF 按墙钟自走，不被打断

```ts
function snapClock(force: boolean) {
  const audioMs = player.audioState.currentTime * 1000;
  const delta = audioMs - clockMs.value;
  const now = performance.now();
  const playing = player.audioState.playing;

  if (force || Math.abs(delta) > SEEK_MS) {
    clockAnchorMs = audioMs;       // 一起更新
    clockAnchorTs = now;
    clockMs.value = audioMs;
  } else if (playing !== clockPlaying) {
    clockAnchorMs = clockMs.value;  // 一起更新
    clockAnchorTs = now;
  } else if (delta > TOLERANCE_MS) {
    clockAnchorMs = (clockMs.value + audioMs) / 2;  // 一起更新
    clockAnchorTs = now;
  }
  // 否则两个都不动！
  clockPlaying = playing;
}
```

---

## 核心教训总结

### 1. anchor 同步不变量（最重要）
做墙钟插值时，"锚点值"和"锚点时间戳"是**一对**。更新其中一个就必须更新另一个；保持其中一个就必须保持另一个。只更新一个会导致插值结果瞬间跳回旧锚点 → 周期性闪回。

这个错误极易写出来，因为把 `anchorTs = now` 放在函数开头看起来"无害"——但它会在不该重置时重置时间基准。

### 2. timeupdate 不可单独信赖
`<audio>` 的 `timeupdate` 三个缺陷：低频（4Hz）、滞后实时、非单调抖动。任何直接用它驱动渲染的方案都会卡/闪。必须用 rAF 墙钟插值，timeupdate 只做 snap 锚点。

### 3. 抖动用容忍带吸收，不用条件追赶
面对非单调的采样值，"领先就追赶"会放大抖动（偏大值被追、偏小值不回拉 → 累积偏离）。正确做法是设容忍带：带内视为噪声不动 anchor，明显偏离才平滑追赶（取中点而非直接 snap）。

### 4. 跨窗口时间基准要统一
主窗和子窗都用 `performance.now()` 墙钟 + rAF 插值，主窗推送只做"锚点纠正"。子窗不能盲从主窗推送值（它本身滞后），要按"行变化/seek 才 snap，领先才追赶，滞后则保持"策略。

### 5. 多动画系统要在关键事件同步
当一个状态变化同时触发多个动画（如行切换 → 卡拉OK 归零 + 滚动到新行），若它们节奏不同（即时 vs 弹簧），要在关键事件点让快的那个 snap 到位，避免一个已切换、另一个还在过渡的"错位闪回"。

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/lib.rs` | `on_window_event` 拦截主窗 CloseRequested |
| `src/composables/useLyric.ts` | rAF 播放时钟 `clockMs`、`snapClock`、`flushPush`、payload 加 `playing` |
| `src/composables/useSpringScroll.ts` | `useSpringValue` 加 `snap(to)` 方法 |
| `src/composables/useDesktopLyricsBridge.ts` | `BridgeState` 加 `playing`、`lines` 元素加 `translation` |
| `src/views/DesktopLyrics.vue` | rAF 本地时钟、逐字三态渲染、`syncAnchor` anchor 不变量 |
| `src/components/LyricPanel.vue` | 行切换/行高变化时 `snapSpringY` |

## 验证

每步改动后均跑 `node_modules\.bin\vue-tsc --noEmit` + `cargo check` 确保类型与编译通过。
