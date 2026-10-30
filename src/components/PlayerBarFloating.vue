<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowDown,
  AudioLines,
  Check,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "@lucide/vue";
import ProgressBar from "@/components/ProgressBar.vue";
import { fmtDuration } from "@/utils/format";
import ScrollText from "@/components/ScrollText.vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";
import {
  AUDIO_QUALITY_OPTIONS,
  actualQualityShortLabel,
  audioQualityOption,
  formatActualQuality,
  isQualityDowngraded,
} from "@/utils/audioQuality";
import type { AudioQuality } from "@/types/music";

const player = usePlayerStore();
const router = useRouter();

const cur = computed(() => fmtDuration(player.audioState.currentTime));
const dur = computed(() => fmtDuration(player.audioState.duration));
const currentCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 48),
);

function onSeek(v: number) {
  player.seek(v);
}

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  player.setVolume(v);
}

const modeIcon = computed(() => {
  switch (player.playMode) {
    case "loop-one":
      return Repeat1;
    case "shuffle":
      return Shuffle;
    default:
      return Repeat;
  }
});

const modeLabel = computed(() => {
  switch (player.playMode) {
    case "loop-one":
      return "单曲循环";
    case "shuffle":
      return "随机播放";
    default:
      return "列表循环";
  }
});

// =============== 音质选择 ===============

const QUALITY_MENU_WIDTH = 240;

const qualityMenuOpen = ref(false);
const qualityButtonRef = ref<HTMLButtonElement | null>(null);
const qualityMenuRef = ref<HTMLElement | null>(null);
const qualityMenuStyle = ref<{
  width: string;
  bottom: string;
  left: string;
} | null>(null);

// quality 是用户所选的请求档位；activeQuality/activeBitrate 是服务端
// 实际下发的档位与码率。徽标与菜单的“当前”标记一律显示实际值。

const requestedQuality = computed(() => audioQualityOption(player.quality));

/** 已装载媒体（引擎已开始装载当前曲）才存在“当前实际音质”。 */
const mediaLoaded = computed(() => player.audioState.currentSongId !== null);

/** 实际音质短标签：优先档位短标签，档位未知时退化为实际码率。 */
const activeQualityShort = computed(() =>
  actualQualityShortLabel(player.activeQuality, player.activeBitrate),
);

/** 实际音质完整描述，如 "极高 · 320 kbps"。 */
const activeQualitySummary = computed(() =>
  formatActualQuality(player.activeQuality, player.activeBitrate),
);

/** 实际下发档位低于所选档位（仅在实际档位已知时判定）。 */
const qualityDowngraded = computed(() =>
  isQualityDowngraded(player.activeQuality, player.quality),
);

/** 当前媒体已装载、仍在加载且尚未拿到解析结果（显示解析中而不是旧值/所选值）。 */
const qualityPending = computed(
  () =>
    mediaLoaded.value &&
    !player.activeAudioResolved &&
    player.audioState.loading,
);

/** 徽标只显示当前实际音质；未播放时显示所选档位作为待用选择。 */
const qualityBadgeLabel = computed(() => {
  if (!mediaLoaded.value) return requestedQuality.value.shortLabel;
  if (activeQualityShort.value !== null) return activeQualityShort.value;
  return qualityPending.value ? "…" : "—";
});

/** 按钮 title / aria-label：同时说明实际值与所选值，降级必须明说。 */
const qualityButtonTitle = computed(() => {
  const requested = requestedQuality.value;
  if (!mediaLoaded.value) {
    return `音质：所选 ${requested.label}（${requested.hint}），点击选择`;
  }
  if (!player.activeAudioResolved) {
    return qualityPending.value
      ? `音质：正在获取实际音质（所选 ${requested.label}）`
      : `音质：当前实际音质未知（所选 ${requested.label}）`;
  }
  const summary = activeQualitySummary.value ?? "未知";
  if (qualityDowngraded.value) {
    return `音质：当前实际 ${summary}；所选 ${requested.label} 未生效，服务端下发较低档位`;
  }
  if (player.activeQuality === null) {
    return `音质：当前实际 ${summary}（档位未知，所选 ${requested.label}）`;
  }
  return `音质：当前实际 ${summary}（所选 ${requested.label}）`;
});

/** 菜单底部实际状态行；所选档位由勾选表示，实际档位由这里说明。 */
const qualityFooter = computed(() => {
  const requested = requestedQuality.value;
  if (!mediaLoaded.value) {
    return `未播放；所选 ${requested.label}。`;
  }
  if (!player.activeAudioResolved) {
    return qualityPending.value
      ? "正在获取实际音质…"
      : `当前实际音质未知（所选 ${requested.label}）。`;
  }
  const summary = activeQualitySummary.value;
  if (summary === null) {
    return "当前实际音质未知；上游未返回档位与码率。";
  }
  if (qualityDowngraded.value) {
    return `当前实际：${summary}。所选 ${requested.label} 未生效，服务端按账号权益下发较低档位。`;
  }
  return `当前实际：${summary}。`;
});

function positionQualityMenu() {
  const rect = qualityButtonRef.value?.getBoundingClientRect();
  if (!rect) {
    // 触发按钮不在 DOM 中（如组件卸载竞态）时直接收起，避免悬空坐标。
    qualityMenuOpen.value = false;
    return;
  }
  // footer 自带 overflow:hidden + transform，会裁剪子浮层，
  // 菜单 Teleport 到 body 后按按钮位置向上弹出、右缘对齐。
  qualityMenuStyle.value = {
    // 宽度与定位使用同一常量，避免样式类与实际宽度漂移。
    width: `${QUALITY_MENU_WIDTH}px`,
    bottom: `${window.innerHeight - rect.top + 10}px`,
    left: `${Math.max(8, rect.right - QUALITY_MENU_WIDTH)}px`,
  };
}

function qualityMenuItems(): HTMLButtonElement[] {
  const menu = qualityMenuRef.value;
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
}

function focusQualityMenuItem(index: number) {
  const items = qualityMenuItems();
  if (items.length === 0) return;
  items[(index + items.length) % items.length].focus();
}

/** 菜单打开时挂在 document 上：焦点可能因点击非交互区域而离开菜单，
 *  统一用 document 级 Escape 关闭并回到触发按钮（与 QueueDrawer 的约定一致）。 */
function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  dismissQualityMenu();
}

/** ARIA menu 模式：方向键在菜单项间移动焦点（循环）；Escape 由 onDocumentKeydown 统一处理。 */
function onQualityMenuKeydown(e: KeyboardEvent) {
  const items = qualityMenuItems();
  const currentIndex = items.findIndex((el) => el === document.activeElement);
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      focusQualityMenuItem(currentIndex + 1);
      break;
    case "ArrowUp":
      e.preventDefault();
      focusQualityMenuItem(currentIndex - 1);
      break;
    case "Home":
      e.preventDefault();
      focusQualityMenuItem(0);
      break;
    case "End":
      e.preventDefault();
      focusQualityMenuItem(items.length - 1);
      break;
    case "Tab":
      // 先显式把焦点还给触发按钮，默认 Tab 才能从触发按钮继续按文档顺序移动。
      dismissQualityMenu();
      break;
  }
}

watch(qualityMenuOpen, (open) => {
  if (open) {
    // 窗口缩放时按钮随布局移动，fixed 定位的菜单需重新取坐标。
    window.addEventListener("resize", positionQualityMenu);
    document.addEventListener("keydown", onDocumentKeydown);
    void nextTick().then(() => {
      // 打开时按 menu 模式把焦点移入菜单，初始定位到当前档位。
      const items = qualityMenuItems();
      const selected = items.findIndex(
        (el) => el.getAttribute("aria-checked") === "true",
      );
      (selected >= 0 ? items[selected] : items[0])?.focus();
    });
  } else {
    window.removeEventListener("resize", positionQualityMenu);
    document.removeEventListener("keydown", onDocumentKeydown);
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", positionQualityMenu);
  document.removeEventListener("keydown", onDocumentKeydown);
});

function toggleQualityMenu() {
  if (qualityMenuOpen.value) {
    dismissQualityMenu();
    return;
  }
  positionQualityMenu();
  qualityMenuOpen.value = true;
}

function closeQualityMenu() {
  qualityMenuOpen.value = false;
}

/** 关闭菜单并把焦点还给触发按钮：backdrop 点击、Escape、Tab、选中共用，
 *  否则菜单项卸载后焦点会落回 <body>。 */
function dismissQualityMenu() {
  closeQualityMenu();
  qualityButtonRef.value?.focus();
}

function selectQuality(value: AudioQuality) {
  // menu 模式：选中后菜单关闭，焦点回到触发按钮。
  dismissQualityMenu();
  if (value !== player.quality) player.setQuality(value);
}

function openNowPlaying() {
  void router.push("/now-playing");
}
</script>

<template>
  <footer
    class="player-bar-grid mobile-player-bar"
    role="region"
    aria-label="播放控制"
  >
    <!-- 左：cover + info -->
    <div class="mobile-song-section flex items-center gap-4 w-full min-w-0">
      <button
        type="button"
        class="player-cover-button mobile-player-cover relative w-12 h-12 shrink-0"
        :title="player.currentSong ? '进入正在播放' : '尚未播放'"
        @click="openNowPlaying"
      >
        <img
          v-if="player.currentSong?.picUrl"
          :src="currentCover"
          alt=""
          class="w-full h-full object-cover"
          loading="eager"
          decoding="async"
          fetchpriority="high"
        />
        <Music2
          v-else
          :size="20"
          :stroke-width="1.5"
          class="text-text-tertiary"
        />
      </button>
      <div class="mobile-song-info min-w-0 flex-1">
        <ScrollText
          :text="player.currentSong?.name ?? '尚未播放'"
          class="text-sm font-medium text-text-primary"
        />
        <ScrollText
          :text="player.currentSong?.artists ?? '—'"
          class="text-xs text-text-secondary"
        />
      </div>
    </div>

    <!-- 中：control + progress -->
    <div class="w-full flex flex-col items-center gap-1.5 min-w-0">
      <div class="player-transport flex items-center">
        <button
          type="button"
          class="player-icon-button"
          :title="`播放模式：${modeLabel}`"
          :aria-label="`播放模式：${modeLabel}`"
          @click="player.togglePlayMode"
        >
          <component :is="modeIcon" :size="16" :stroke-width="1.6" />
        </button>
        <button
          type="button"
          class="player-icon-button"
          :disabled="!player.hasPrev"
          aria-label="上一首"
          @click="player.prev"
        >
          <SkipBack :size="17" :stroke-width="1.6" />
        </button>
        <button
          type="button"
          class="player-play-button relative bg-accent text-on-accent flex items-center justify-center"
          :class="{ 'animate-play-pulse': player.audioState.playing && !player.audioState.loading }"
          :disabled="!player.currentSong"
          :aria-label="player.audioState.playing ? '暂停' : '播放'"
          @click="player.togglePlay"
        >
          <LoaderCircle
            v-if="player.audioState.loading"
            :size="17"
            :stroke-width="1.7"
            class="animate-spin"
          />
          <Pause v-else-if="player.audioState.playing" :size="17" :stroke-width="1.7" />
          <Play v-else :size="17" :stroke-width="1.7" class="ml-0.5" />
        </button>
        <button
          type="button"
          class="player-icon-button"
          :disabled="!player.hasNext"
          aria-label="下一首"
          @click="player.next"
        >
          <SkipForward :size="17" :stroke-width="1.6" />
        </button>
      </div>
      <div class="w-full flex items-center gap-2">
        <span class="player-time text-[11px] tabular-nums w-9 text-right font-medium">
          {{ cur }}
        </span>
        <ProgressBar
          :value="player.audioState.currentTime"
          :max="player.audioState.duration || 0"
          @change="onSeek"
          class="flex-1 min-w-0"
        />
        <span class="player-time text-[11px] tabular-nums w-9 font-medium">
          {{ dur }}
        </span>
      </div>
    </div>

    <!-- 右：quality + volume -->
    <div
      class="player-volume w-full max-w-[180px] min-w-0 justify-self-end flex items-center gap-1.5 mobile-hide-on-small"
    >
      <button
        ref="qualityButtonRef"
        type="button"
        class="player-quality-button"
        :class="{
          'is-open': qualityMenuOpen,
          'is-downgraded': mediaLoaded && qualityDowngraded,
          'is-unknown': mediaLoaded && activeQualityShort === null,
        }"
        :title="qualityButtonTitle"
        :aria-label="qualityButtonTitle"
        :aria-expanded="qualityMenuOpen"
        aria-haspopup="menu"
        @click="toggleQualityMenu"
      >
        <AudioLines :size="13" :stroke-width="1.75" aria-hidden="true" />
        <span class="text-[11px] font-medium leading-none">
          {{ qualityBadgeLabel }}
        </span>
        <ArrowDown
          v-if="mediaLoaded && qualityDowngraded"
          :size="10"
          :stroke-width="2"
          class="player-quality-downgraded"
          aria-hidden="true"
        />
      </button>
      <Volume2
        :size="15"
        :stroke-width="1.5"
        class="player-volume-icon shrink-0"
        aria-hidden="true"
      />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.audioState.volume"
        class="player-volume-range flex-1 min-w-0 appearance-none cursor-pointer"
        :aria-label="`音量 ${Math.round(player.audioState.volume * 100)}%`"
        @input="onVolume"
        style="accent-color: var(--color-accent);"
      />
    </div>
  </footer>

  <!-- 音质菜单：Teleport 到 body，避免被 footer 的 overflow:hidden 裁剪。 -->
  <Teleport to="body">
    <div v-if="qualityMenuOpen">
      <div
        class="fixed inset-0 z-40"
        aria-hidden="true"
        @click="dismissQualityMenu"
      ></div>
      <div
        ref="qualityMenuRef"
        class="glass fixed z-50 rounded-xl py-1.5 box-border"
        :style="qualityMenuStyle"
      >
        <div
          role="menu"
          aria-label="播放音质"
          @keydown="onQualityMenuKeydown"
        >
          <button
            v-for="opt in AUDIO_QUALITY_OPTIONS"
            :key="opt.value"
            type="button"
            role="menuitemradio"
            :aria-checked="opt.value === player.quality"
            class="quality-menu-item"
            @click="selectQuality(opt.value)"
          >
            <span class="w-4 shrink-0 flex items-center justify-center">
              <Check
                v-if="opt.value === player.quality"
                :size="14"
                :stroke-width="2"
                class="text-accent"
              />
            </span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block text-sm truncate">{{ opt.label }}</span>
              <span class="block text-[11px] text-text-tertiary truncate">
                {{ opt.hint }}
              </span>
            </span>
            <span
              v-if="mediaLoaded && opt.value === player.activeQuality"
              class="quality-menu-current"
            >
              当前
            </span>
          </button>
        </div>
        <div class="quality-menu-footer">
          <div>{{ qualityFooter }}</div>
          <div>勾选为所选档位；高档位需 VIP/SVIP，当前实际以服务端下发为准。</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.player-bar-grid {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 30;
  display: grid;
  align-items: center;
  grid-template-columns:
    minmax(0, 1fr)
    clamp(236px, 44%, 320px)
    minmax(0, 1fr);
  width: min(780px, calc(100% - 24px));
  height: 76px;
  padding: 0 18px;
  gap: 16px;
  overflow: hidden;
  transform: translateX(-50%);
  border: 0;
  border-radius: 8px;
  background: var(--color-raised);
  box-shadow: var(--shadow-floating);
}

.player-cover-button {
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: var(--color-surface-soft, var(--color-card-hover));
  box-shadow: none;
  transition:
    transform 0.2s cubic-bezier(0.32, 0.72, 0, 1),
    box-shadow 0.2s ease;
}

.player-cover-button:hover {
  transform: translateY(-1px);
  box-shadow: none;
}

.player-cover-button:active {
  transform: scale(0.97);
}

.player-transport {
  gap: 3px;
}

.player-icon-button,
.player-play-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  outline: none;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    transform 0.18s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.18s ease,
    box-shadow 0.18s ease;
}

.player-icon-button {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  color: var(--color-text-secondary);
  background: transparent;
}

.player-icon-button:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: var(--color-surface-soft, var(--color-card-hover));
  transform: translateY(-1px);
}

.player-icon-button:active:not(:disabled) {
  transform: scale(0.95);
}

.player-play-button {
  width: 40px;
  height: 40px;
  margin: 0 2px;
  border-radius: 50%;
  box-shadow: 0 3px 10px var(--color-glow);
}

.player-play-button:hover:not(:disabled) {
  transform: scale(1.045);
  box-shadow: 0 4px 14px var(--color-glow);
}

.player-play-button:active:not(:disabled) {
  transform: scale(0.94);
}

.player-icon-button:disabled,
.player-play-button:disabled {
  cursor: default;
  opacity: 0.28;
}

.player-cover-button:focus-visible,
.player-icon-button:focus-visible,
.player-play-button:focus-visible,
.player-volume-range:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.player-time {
  color: var(--color-text-tertiary);
}

.player-volume {
  opacity: 0.72;
  transition: opacity 0.2s ease;
}

.player-bar-grid:hover .player-volume,
.player-volume:focus-within {
  opacity: 1;
}

.player-volume-icon {
  color: var(--color-text-secondary);
}

.player-quality-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft, var(--color-card-hover));
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    transform 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}

.player-quality-button:hover {
  color: var(--color-text-primary);
  transform: translateY(-1px);
}

.player-quality-button.is-open {
  color: var(--color-accent);
}

.player-quality-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* 实际档位低于所选：徽标仍显示实际值，用向下的箭头与更深的文字提示降级。 */
.player-quality-button.is-downgraded {
  color: var(--color-text-primary);
}

.player-quality-downgraded {
  color: var(--color-accent-secondary);
}

.player-quality-button.is-unknown {
  color: var(--color-text-tertiary);
}

.quality-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  outline: none;
  cursor: pointer;
  color: var(--color-text-primary);
  background: transparent;
  transition: background-color 0.15s ease;
}

.quality-menu-item:hover,
.quality-menu-item:focus-visible {
  background: var(--color-card-hover);
}

/* 焦点指示不能只靠背景色：forced-colors 模式会覆盖背景色。 */
.quality-menu-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* 菜单勾选表示“所选请求档位”；当前实际下发档位用独立胶囊标记。 */
.quality-menu-current {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--color-accent);
  background: var(--color-accent-subtle, var(--color-surface-soft));
}

.quality-menu-footer {
  margin-top: 4px;
  padding: 6px 12px 4px;
  border-top: 1px solid var(--color-border, var(--color-border-strong));
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.player-volume-range {
  height: 24px;
  margin: 0;
  background: transparent;
}

.player-volume-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: var(--color-track, var(--color-border-strong));
}

.player-volume-range::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  margin-top: -4.5px;
  appearance: none;
  border: 0;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: none;
}

.player-volume-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--color-track, var(--color-border-strong));
}

.player-volume-range::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border: 0;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: none;
}

/* 极窄窗口只保留封面，左右各占同样宽度，中间控制区仍严格居中。 */
@media (max-width: 520px) {
  .player-bar-grid {
    grid-template-columns: 40px minmax(0, 1fr) 40px;
  }

  .mobile-song-section {
    gap: 0;
  }

  .mobile-song-info {
    display: none;
  }

  .mobile-player-cover {
    width: 40px;
    height: 40px;
    border-radius: 6px;
  }

  .player-icon-button {
    width: 32px;
    height: 32px;
  }

  .player-play-button {
    width: 38px;
    height: 38px;
    margin-inline: 0;
  }

  .player-transport {
    gap: 1px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-cover-button,
  .player-icon-button,
  .player-play-button,
  .player-volume,
  .player-quality-button {
    transition: none;
  }

  .player-play-button {
    animation: none !important;
  }
}
</style>
