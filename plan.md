## Plan: 修复桌面歌词窗口五个问题

**问题 1 — 按钮无反应**：根因是 Tauri v2 权限缺失——`capabilities/default.json` 未授予 `core:webview:allow-create-webview-window`。

**问题 2 — 背景不透明**：根因是 `App.vue` 根元素 `<div class="bg-bg">` 在主窗和桌面歌词窗都渲染。

**问题 3 — X 按钮无法关闭**：根因是关闭流程依赖跨窗口 emit→listen→closeWindow 通信链，且 `w.close()` 缺少权限。

**问题 4 — 仍有「框」感**：
- OS：缺 `shadow: false`，Windows 对无边框窗口默认加投影
- CSS：`.lyric-root { opacity: 0.95 }` 让容器微透，配合 `text-shadow` 勾勒矩形边界

**问题 5 — 透明度滑块拖不动 + 窗口太高不够扁**：
- 滑块：工具栏 `@mousedown.stop` 阻止了 range input 的原生拖拽事件冒泡，导致滑块值无法更新
- 高度：窗口 300px 太高，上下行间距过大，显示区域浪费

---

**Steps**

### Phase 1: 修复权限配置

1. 编辑 `src-tauri/capabilities/default.json`，在 `permissions` 数组中添加：
   - `"core:webview:allow-create-webview-window"` — 允许前端创建新 webview 窗口
   - `"core:webview:allow-destroy-webview-window"` — 允许 `w.close()` 销毁窗口
   - `"core:webview:allow-set-webview-focus"` — 允许 `existing.setFocus()`

### Phase 2: 修复前端错误处理与状态同步

2. 编辑 `src/stores/desktopLyrics.ts` 的 `openWindow()`：
   - `new WebviewWindow(...)` 之后立即 `.once("tauri://created", () => { isOpen.value = true; })`
   - `.once("tauri://error", (e) => { isOpen.value = false; console.warn("[desktop-lyrics] 创建失败", e); })`
   - **删除**构造函数后紧邻的 `isOpen.value = true` 赋值（移到 created 回调内）

### Phase 3: 简化关闭机制（修复 X 按钮无反应）

3. 编辑 `src/views/DesktopLyrics.vue`：
   - `onClose()` 改为直接调用 `getCurrentWindow().close()`，不再 emit 跨窗口事件

   变更前：
   ```ts
   async function onClose() {
     await emit("desktop-lyrics:control", { action: "close" });
   }
   ```
   变更后：
   ```ts
   async function onClose() {
     await getCurrentWindow().close();
   }
   ```

### Phase 4: App.vue 按窗口类型条件渲染（解决背景透明 + 不复用主界面）

4. 编辑 `src/App.vue`：
   - `<script setup>` 中通过 `getCurrentWindow().label` 判断当前窗口
   - 桌面歌词窗只渲染 `<router-view />`，主窗保留完整布局

   变更后模板：
   ```html
   <template v-if="isDesktopLyrics">
     <router-view v-slot="{ Component }">
       <transition name="fade-slide" mode="out-in">
         <component :is="Component" />
       </transition>
     </router-view>
   </template>
   <template v-else>
     <div class="h-full flex bg-bg">
       <Sidebar class="shrink-0" />
       <router-view v-slot="{ Component }">
         <transition name="fade-slide" mode="out-in">
           <component :is="Component" />
         </transition>
       </router-view>
       <PlayerBarFloating />
     </div>
   </template>
   ```

### Phase 5: 消除框感 + 修复透明度滑块 + 紧凑化布局

5. 编辑 `src/views/DesktopLyrics.vue`，三处改动：

   **5a. 去除 OS 投影**（`src/stores/desktopLyrics.ts`）：
   `openWindow()` 窗口选项中添加 `shadow: false,`

   **5b. 修复透明度滑块（根因）**：
   工具栏 `@mousedown.stop` 阻止了 `<input type="range">` 的原生 mousedown 冒泡，导致滑块拖拽行为不触发。改为给每个按钮单独加 `.stop`，滑块不加。

   变更前：
   ```html
   <div data-toolbar class="toolbar ..." @mousedown.stop>
   ```
   变更后：
   ```html
   <div data-toolbar class="toolbar ...">
   ```
   按钮上分别加：`@mousedown.stop`（字号+/-、锁定、关闭），滑块不加。

   **5c. 去除容器 opacity + 背景**：
   `.lyric-root { opacity: 1; background: transparent; border: none; box-shadow: none; }`
   文字颜色本身已通过 `color: rgba(255,255,255,0.95)` 控制半透明，不需要容器级 opacity。

   **5d. 紧凑化布局（窗口更扁）**：
   - 窗口高度 `300` → `180`
   - `.prev-line` 的 `margin-bottom: 0.5rem` → `0.15rem`
   - `.next-line` 的 `margin-top: 0.5rem` → `0.15rem`
   - `.song-info` 的 `margin-top: 1rem` → `0.3rem`
   - `.current-wrap` 的 `min-height` 改为 `calc(var(--lyric-font-size) * 1.1)`

### Phase 6: 验证与测试

6. `cd src-tauri && cargo build`
7. `npm run tauri dev`，点击侧栏"桌面歌词"按钮
8. 确认：窗口弹出、背景完全透明、仅见歌词文字、无框感
9. 拖动透明度滑块 → 歌词整体可见度实时变化
10. 点击 X 按钮 → 窗口关闭
11. 再次点击按钮 → 窗口重新打开
12. 窗口呈扁平长条状（180px 高），上下行间距紧凑
13. 托盘菜单 / `Ctrl+Alt+L` 正常
14. 主窗不受影响

---

**Relevant files**
- `src-tauri/capabilities/default.json` — 添加 3 个权限
- `src/stores/desktopLyrics.ts` — 错误处理 + `shadow: false` + 窗口高度 180
- `src/views/DesktopLyrics.vue` — `onClose()` 直接关闭 + `.lyric-root` 透明化 + 工具栏 `@mousedown.stop` 改为按钮级 + 紧凑间距
- `src/App.vue` — 按窗口条件渲染

---

**Verification**
1. `cargo build` 编译通过
2. 桌面歌词窗口弹出，背景完全透明，无矩形框感
3. 仅见歌词文字，无 Sidebar、无播放栏
4. **透明度滑块可拖动**，歌词可见度实时变化
5. 点击 X 按钮 → 窗口关闭
6. 再次点击 → 窗口重新打开
7. 窗口呈扁平长条状，上下行间距紧凑不浪费空间
8. 托盘菜单 / `Ctrl+Alt+L` 正常
9. 主窗不受影响

---

**Decisions**
- `getCurrentWindow().close()` 取代跨窗口 emit 链路
- `shadow: false` + 容器 opacity=1 + 文字 rgba 控制 → 文字悬浮桌面
- 工具栏 `@mousedown.stop` 从容器级改为按钮级，滑块不加 `.stop` 以恢复原生拖拽
- 窗口高度 300→180，间距收紧，以当前行+上下各一行+歌名为最紧凑布局

---

**Further Considerations**
1. 若生产构建后窗口空白，`url` 改为 `"/#/desktop-lyrics"`
2. 若仍有微弱框感，检查 WebView2 版本
3. 不透明度滑块未来可改为控制文字 `color` alpha 而非容器 `opacity`（当前计划已去除容器 opacity，滑块暂保留兼容）