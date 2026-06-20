import { watch } from "vue";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { usePlayerStore } from "@/stores/player";
import { useDesktopLyricsStore, GEOM_KEY } from "@/stores/desktopLyrics";
import { useThemeStore } from "@/stores/theme";
import { triggerDesktopLyricsPush } from "@/composables/useLyric";

export function useTauriBridge() {
  const playerStore = usePlayerStore();
  const desktopLyricsStore = useDesktopLyricsStore();
  const themeStore = useThemeStore();
  const unlistens: UnlistenFn[] = [];
  let tornDown = false;

  watch(
    () => playerStore.currentSong,
    (song) => {
      if (song?.picUrl) {
        themeStore.applyFromCover(song.picUrl);
      } else {
        themeStore.resetToDefault();
      }
    },
    { immediate: true },
  );

  async function setup() {
    playerStore.bindAutoNext();
    await desktopLyricsStore.syncFromSystem();

    const register = async <T>(event: string, handler: EventCallback<T>) => {
      if (tornDown) return;
      const un = await listen<T>(event, handler);
      if (tornDown) {
        un();
        return;
      }
      unlistens.push(un);
    };

    await Promise.all([
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
      register("desktop-lyrics:request-snapshot", () => {
        triggerDesktopLyricsPush();
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
  }

  function teardown() {
    tornDown = true;
    unlistens.forEach((u) => u());
    unlistens.length = 0;
  }

  return { setup, teardown };
}
