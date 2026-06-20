// 桌面歌词独立窗口 Pinia Store。
// 使用 Tauri WebviewWindow API 创建/关闭子窗口。
// 错误处理：已存在窗口时复用；权限不足时 throw 由 UI 决定降级。
//
// 位置持久化策略：
//   1. 子窗 useWindowGeometry 在 move/resize 时 emit 'desktop-lyrics:control'
//      { action: "geometry", value: {x,y,w,h} }
//   2. App.vue 在主窗 localStorage 写入 nnplayer.lyricWindow.geometry
//   3. 本 store 在 openWindow() 前读取同一 key，用 is_position_on_screen 校验后
//      传给 WebviewWindow 构造参数

import { defineStore } from "pinia";
import { ref } from "vue";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { isPositionOnScreen } from "@/composables/useNcmApi";

/** 主窗 localStorage 中存储的几何信息 key。子窗通过 control 事件写到同一 key。*/
export const GEOM_KEY = "nnplayer.lyricWindow.geometry";

export const useDesktopLyricsStore = defineStore("desktopLyrics", () => {
  const isOpen = ref<boolean>(false);
  const label = "desktop-lyrics";

  async function resolveInitialPosition(): Promise<
    { x: number; y: number } | undefined
  > {
    try {
      const raw = localStorage.getItem(GEOM_KEY);
      if (!raw) return undefined;
      const g = JSON.parse(raw) as { x: number; y: number };
      const onScreen = await isPositionOnScreen(g.x, g.y);
      return onScreen ? { x: g.x, y: g.y } : undefined;
    } catch {
      return undefined;
    }
  }

  async function openWindow() {
    // 已存在则激活
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      isOpen.value = true;
      return;
    }

    // 优先恢复持久化位置，校验屏幕边界
    const pos = await resolveInitialPosition();
    const win = new WebviewWindow(label, {
      url: "#/desktop-lyrics",
      title: "桌面歌词",
      width: 800,
      height: 120,
      decorations: false,
      transparent: true,
      shadow: false, // 去掉 Windows 无边框窗口的默认投影，避免"框"感
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focus: false,
      x: pos?.x,
      y: pos?.y,
    });

    // 窗口真正创建成功后才标记打开；
    // 创建失败（IPC 拒绝、权限缺失等）经 error 事件回退状态。
    win.once("tauri://created", async () => {
      isOpen.value = true;
      // 强制设置正确尺寸，覆盖 window-state 插件可能恢复的旧值
      try {
        await win.setSize(new LogicalSize(800, 120));
      } catch {
        // setSize 失败不阻塞（权限不足等边缘情况）
      }
      // 仅监听 destroyed 同步状态。
      // 故意不监听 tauri://close-requested：
      // Tauri v2 中只要注册了 close-requested 监听器，
      // Rust 端就会自动调 api.prevent_close()（见 tauri/src/manager/window.rs），
      // 导致所有 close() 调用被静默吞掉，窗口永远关不掉。
      win.once("tauri://destroyed", () => {
        isOpen.value = false;
      });
    });
    win.once("tauri://error", (e) => {
      isOpen.value = false;
      console.warn("[desktop-lyrics] create failed:", e);
    });
  }

  /** 关闭桌面歌词窗口（从主窗调用）。
   * 直接 destroy 绕过 close-requested 路径——Tauri v2 在有 close-requested 监听器
   * 时会自动调 api.prevent_close()，让 close() 静默失败。destroy() 直接走
   * plugin:window|destroy，不触发 close-requested。失败时再退回到 close 兜底。 */
  async function closeWindow() {
    try {
      const w = await WebviewWindow.getByLabel(label);
      if (!w) {
        // 窗口已不存在，仅同步状态
        return;
      }
      try {
        await w.destroy();
      } catch (e2) {
        // destroy 失败（理论上不应该发生）退回到 close。
        // 此时本 store 已不再注册 close-requested 监听器，
        // 不会再被自动 prevent_close 阻断。
        console.warn("[desktop-lyrics] destroy 失败，尝试 close:", e2);
        try {
          await w.close();
        } catch (e3) {
          console.warn("[desktop-lyrics] close 也失败:", e3);
        }
      }
    } catch (err) {
      console.warn("[desktop-lyrics] 关闭窗口失败:", err);
    } finally {
      isOpen.value = false;
    }
  }

  /** 切换桌面歌词窗口开关。
   * 不信任 isOpen 缓存，直接查实际窗口状态决定开/关。 */
  async function toggleWindow() {
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        // 窗口确实存在 → 关闭。委托给 closeWindow（走 destroy 路径）。
        await closeWindow();
      } else {
        // 窗口不存在 → 打开
        isOpen.value = false;
        await openWindow();
      }
    } catch {
      // getByLabel 异常时退化到 isOpen 判断
      if (isOpen.value) {
        await closeWindow();
      } else {
        await openWindow();
      }
    }
  }

  /**
   * 启动时若桌面歌词窗口已存在（例如上次未正常关闭），
   * 恢复 isOpen 状态。
   */
  async function syncFromSystem() {
    try {
      const w = await WebviewWindow.getByLabel(label);
      isOpen.value = !!w;
    } catch {
      isOpen.value = false;
    }
  }

  return {
    isOpen,
    openWindow,
    closeWindow,
    toggleWindow,
    syncFromSystem,
  };
});
