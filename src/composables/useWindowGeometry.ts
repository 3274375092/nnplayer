// 桌面歌词窗口几何信息持久化 composable。
//
// 监听窗口 move/resize 事件，防抖保存到主窗 localStorage。
// 通过 'desktop-lyrics:control' 事件（action: "geometry"）将位置发回主窗，
// 主窗 App.vue 收到后写到自己的 localStorage（子窗不能跨窗读写主窗 localStorage）。
//
// 主窗打开桌面歌词前读取同一 key，校验屏幕边界后传给 WebviewWindow 构造参数 x/y。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted } from "vue";

const SAVE_DEBOUNCE_MS = 300;

export function useWindowGeometry() {
  const current = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unlisteners: (() => void)[] = [];

  async function save() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const pos = await current.outerPosition();
        const size = await current.outerSize();
        void emit("desktop-lyrics:control", {
          action: "geometry",
          value: { x: pos.x, y: pos.y, w: size.width, h: size.height },
        }).catch(() => {});
      } catch {
        // 窗口已销毁等
      }
    }, SAVE_DEBOUNCE_MS);
  }

  onMounted(async () => {
    unlisteners.push(await current.onMoved(save));
    unlisteners.push(await current.onResized(save));
  });

  onBeforeUnmount(() => {
    unlisteners.forEach((fn) => fn());
    if (timer) clearTimeout(timer);
  });
}
