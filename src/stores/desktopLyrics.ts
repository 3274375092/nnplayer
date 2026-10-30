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

/**
 * 桌面歌词窗口的客户区尺寸口径（三处统一：本 store、DESIGN.md、运行实拍）。
 *
 * 两轮评审的实拍证据（xwininfo，800×200，125% 缩放下仍为 800×200：
 * 窗口物理尺寸与逻辑尺寸一致，WebView 内部按 1.25 渲染，故 CSS 视口约
 * 640×160）都显示实际客户区高度是 200，而旧代码创建/强制 120；GTK 在
 * 不可缩放窗口上按内容最小高度把窗口撑到 200，形成「请求 120、实拍 200」
 * 的第三方口径。这里显式请求 800×200，让请求值 = 实拍值 = DESIGN。
 *
 * 长行/垂直布局以窗口实测 CSS 视口为准（DesktopLyrics.vue 内 ResizeObserver
 * 测量），不依赖这个常量；常量只决定窗口创建后的客户区大小。
 */
export const DESKTOP_LYRICS_WIDTH = 800;
export const DESKTOP_LYRICS_HEIGHT = 200;

export const useDesktopLyricsStore = defineStore("desktopLyrics", () => {
  const isOpen = ref<boolean>(false);
  const label = "desktop-lyrics";
  // 进行中的开/关切换。查询窗口 + 创建窗口是 TOCTOU：两次快速切换会同时
  // 观察到"窗口不存在"并各自 new WebviewWindow，第二次会以重复 label 失败。
  let pending: Promise<void> | null = null;

  /**
   * 读取并校验持久化几何。损坏的条目就地清除，否则每次启动都会重新踩同一条
   * 静默失败路径；localStorage 不可用（隐私模式）与内容损坏要区分开，
   * 后者可以自愈。
   */
  function readStoredGeometry(): { x: number; y: number } | undefined {
    let raw: string | null;
    try {
      raw = localStorage.getItem(GEOM_KEY);
    } catch (e) {
      console.warn("[desktop-lyrics] 读取几何信息失败", e);
      return undefined;
    }
    if (!raw) return undefined;

    try {
      const g = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (
        typeof g.x !== "number" ||
        typeof g.y !== "number" ||
        !Number.isFinite(g.x) ||
        !Number.isFinite(g.y)
      ) {
        throw new Error("几何信息字段不合法");
      }
      return { x: g.x, y: g.y };
    } catch (e) {
      console.warn("[desktop-lyrics] 几何信息损坏，已清除", e);
      try {
        localStorage.removeItem(GEOM_KEY);
      } catch {
        // 清除失败不影响本次恢复流程；下次启动会再次走到这里并留下 warn。
      }
      return undefined;
    }
  }

  async function resolveInitialPosition(): Promise<
    { x: number; y: number } | undefined
  > {
    const stored = readStoredGeometry();
    if (!stored) return undefined;
    try {
      // 屏幕边界校验是一次 IPC：查询失败时宁可不恢复位置，也不赌一个可能落在
      // 屏幕外的坐标，但必须留痕——否则用户只会看到"窗口位置记不住"。
      const onScreen = await isPositionOnScreen(stored.x, stored.y);
      return onScreen ? stored : undefined;
    } catch (e) {
      console.warn("[desktop-lyrics] 屏幕边界校验失败，跳过位置恢复", e);
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
      width: DESKTOP_LYRICS_WIDTH,
      height: DESKTOP_LYRICS_HEIGHT,
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
      // 强制设置正确尺寸，覆盖 window-state 插件可能恢复的旧值。
      // 800×200 = DESIGN/实拍/本 store 的统一口径（见上方常量注释）。
      try {
        await win.setSize(
          new LogicalSize(DESKTOP_LYRICS_WIDTH, DESKTOP_LYRICS_HEIGHT),
        );
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
   * 不信任 isOpen 缓存，直接查实际窗口状态决定开/关。
   * 查询失败时直接抛出，不依据 isOpen 猜测降级：catch 分支走的
   * openWindow/closeWindow 内部同样依赖 WebviewWindow IPC，拿不到窗口时
   * 只会再失败一次，却可能把 isOpen 落成与真实窗口状态相反的值。
   * 调用方（useTauriBridge、Sidebar.openDesktopLyrics）负责记录错误。 */
  async function toggleWindow() {
    if (pending) return pending;
    pending = (async () => {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        // 窗口确实存在 → 关闭。委托给 closeWindow（走 destroy 路径）。
        await closeWindow();
      } else {
        // 窗口不存在 → 打开
        isOpen.value = false;
        await openWindow();
      }
    })();
    try {
      await pending;
    } finally {
      pending = null;
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
    } catch (e) {
      // 查询失败不等于窗口不存在，但 UI 只能先按"未打开"展示；
      // 留痕以便区分 IPC 故障与窗口确实已关闭。
      console.warn("[desktop-lyrics] 同步窗口状态失败，按未打开处理", e);
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
