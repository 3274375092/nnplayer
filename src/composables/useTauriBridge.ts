import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { usePlayerStore } from "@/stores/player";
import { useDesktopLyricsStore, GEOM_KEY } from "@/stores/desktopLyrics";

export function useTauriBridge() {
  const playerStore = usePlayerStore();
  const desktopLyricsStore = useDesktopLyricsStore();
  const unlistens: UnlistenFn[] = [];
  let tornDown = false;

  async function setup(activateDesktopLyricsPublisher: () => void) {
    const register = async <T>(event: string, handler: EventCallback<T>) => {
      if (tornDown) return;
      const un = await listen<T>(event, handler);
      if (tornDown) {
        un();
        return;
      }
      unlistens.push(un);
    };

    // 快照请求必须最先注册；窗口状态同步可能包含 IPC，不能让子窗在此期间
    // 发出的唯一请求落空。
    await register("desktop-lyrics:request-snapshot", () => {
      activateDesktopLyricsPublisher();
    });

    await Promise.all([
      desktopLyricsStore.syncFromSystem(),
      register("player:toggle", () => playerStore.togglePlay()),
      register("player:prev", () => void playerStore.prev()),
      register("player:next", () => void playerStore.next()),
      register("desktop-lyrics:toggle", async () => {
        try {
          await desktopLyricsStore.toggleWindow();
        } catch (e) {
          console.warn("[desktop-lyrics] toggle 失败", e);
        }
      }),
      register<{ action: string; value?: unknown }>("desktop-lyrics:control", async (e) => {
        switch (e.payload.action) {
          case "close":
            await desktopLyricsStore.closeWindow();
            break;
          case "lock":
            break;
          case "geometry":
            if (e.payload.value) {
              try {
                localStorage.setItem(
                  GEOM_KEY,
                  JSON.stringify(e.payload.value),
                );
              } catch {
                /* localStorage 不可用静默 */
              }
            }
            break;
        }
      }),
    ]);

    // 主窗口重载而桌面歌词窗口仍存活时，子窗不会重新 mounted 请求快照；
    // setup 完成后主动广播新 session 的首包。
    if (!tornDown) activateDesktopLyricsPublisher();
  }

  function teardown() {
    tornDown = true;
    unlistens.forEach((u) => u());
    unlistens.length = 0;
  }

  return { setup, teardown };
}
