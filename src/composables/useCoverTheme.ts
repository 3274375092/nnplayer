import { onScopeDispose, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";

/** 仅主窗口启用的封面主题同步，桌面歌词子窗不创建重复 watcher。 */
export function useCoverTheme() {
  const player = usePlayerStore();
  const theme = useThemeStore();

  const stop = watch(
    () => player.currentSong?.picUrl ?? null,
    (coverUrl) => {
      if (coverUrl) {
        theme.applyFromCover(coverUrl);
      } else {
        theme.resetToDefault();
      }
    },
    { immediate: true },
  );

  onScopeDispose(stop);
}
