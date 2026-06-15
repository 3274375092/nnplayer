// 桌面歌词独立窗口 Pinia Store。
// 使用 Tauri WebviewWindow API 创建/关闭子窗口。
// 错误处理：已存在窗口时复用；权限不足时 throw 由 UI 决定降级。

import { defineStore } from "pinia";
import { ref } from "vue";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const useDesktopLyricsStore = defineStore("desktopLyrics", () => {
  const isOpen = ref<boolean>(false);
  const label = "desktop-lyrics";

  async function openWindow() {
    // 已存在则激活
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      isOpen.value = true;
      return;
    }
    const win = new WebviewWindow(label, {
      url: "#/desktop-lyrics",
      title: "桌面歌词",
      width: 900,
      height: 300,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focus: false,
    });
    isOpen.value = true;
    // 监听关闭
    win.once("tauri://destroyed", () => {
      isOpen.value = false;
    });
    win.once("tauri://close-requested", () => {
      isOpen.value = false;
    });
  }

  async function closeWindow() {
    const w = await WebviewWindow.getByLabel(label);
    if (w) {
      await w.close();
    }
    isOpen.value = false;
  }

  async function toggleWindow() {
    if (isOpen.value) {
      await closeWindow();
    } else {
      await openWindow();
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

  /**
   * 判断当前是否在主窗口（避免桌面歌词窗口自身初始化 store 时误触发）。
   * 当前窗口的 label 是 'main'。
   */
  function isMainWindow(): boolean {
    try {
      return getCurrentWindow().label === "main";
    } catch {
      return false;
    }
  }

  return {
    isOpen,
    openWindow,
    closeWindow,
    toggleWindow,
    syncFromSystem,
    isMainWindow,
  };
});
