<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
  VolumeX,
} from "@lucide/vue";
import ProgressBar from "@/components/ProgressBar.vue";
import { fmtDuration } from "@/utils/format";
import ScrollText from "@/components/ScrollText.vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";
import {
  AUDIO_QUALITY_OPTIONS,
  audioQualityOption,
  audioQualityRank,
  formatActualQuality,
  formatBitrate,
  isQualityDowngraded,
  type AudioQualityOption,
} from "@/utils/audioQuality";
import type { AudioQuality } from "@/types/music";

const player = usePlayerStore();
const router = useRouter();

const cur = computed(() =>
  player.currentSong ? fmtDuration(player.audioState.currentTime) : "--:--",
);
const dur = computed(() =>
  player.currentSong && player.audioState.duration > 0
    ? fmtDuration(player.audioState.duration)
    : "--:--",
);
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

/** 下一档是确定的（列表循环 → 单曲循环 → 随机播放），标题直接说出来。 */
const nextModeLabel = computed(() => {
  switch (player.playMode) {
    case "loop-list":
      return "单曲循环";
    case "loop-one":
      return "随机播放";
    default:
      return "列表循环";
  }
});

/** 播放键的无障碍名称/悬停提示：加载中说明正在等待，而不是仍报「播放」。 */
const playButtonLabel = computed(() =>
  player.audioState.loading
    ? "正在加载歌曲"
    : player.audioState.playing
      ? "暂停"
      : "播放",
);

// =============== 音质选择 ===============

const QUALITY_MENU_WIDTH = 240;

const qualityMenuOpen = ref(false);
const qualityButtonRef = ref<HTMLButtonElement | null>(null);
const qualityMenuRef = ref<HTMLElement | null>(null);
const coverButtonRef = ref<HTMLButtonElement | null>(null);
const qualityMenuStyle = ref<{
  width: string;
  bottom: string;
  left: string;
} | null>(null);

// quality 是用户所选的请求档位；activeQuality/activeBitrate 是服务端
// 实际下发的档位与码率。徽标与菜单的“实际”标记一律显示实际值。

const requestedQuality = computed(() => audioQualityOption(player.quality));

/** 已装载媒体（引擎已开始装载当前曲）才存在“当前实际音质”。 */
const mediaLoaded = computed(() => player.audioState.currentSongId !== null);

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

/** 徽标只显示服务端实际下发的档位；尚未播放/未解析时一律写「未知」。
 *  所选档位只出现在 title/aria-label 与菜单的「所选」标记里——胶囊不能把
 *  用户的请求当成事实（PRODUCT/DESIGN 的状态诚实：实际未知写「未知」）。
 *  也不把裸码率（如 3338K）当成档位短标签。 */
const qualityBadgeLabel = computed(() => {
  if (!mediaLoaded.value) return "未知";
  if (player.activeQuality !== null) {
    return audioQualityOption(player.activeQuality).shortLabel;
  }
  return qualityPending.value ? "…" : "未知";
});

/** 按钮 title / aria-label：同时说明实际值与所选值，降级必须明说。 */
const qualityButtonTitle = computed(() => {
  const requested = requestedQuality.value;
  if (!mediaLoaded.value) {
    return `音质：实际档位未知（尚未播放）；所选 ${requested.label}（${requested.hint}），打开音质菜单`;
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
    // formatActualQuality 已带「（档位未知）」时不要再拼一次，否则读屏会听到两遍。
    const rate = formatBitrate(player.activeBitrate);
    return rate
      ? `音质：当前实际 ${rate}，档位未知（所选 ${requested.label}）`
      : `音质：当前实际音质未知（所选 ${requested.label}）`;
  }
  return `音质：当前实际 ${summary}（所选 ${requested.label}）`;
});

/** 菜单项的可访问说明：勾选与「实际」徽标只是视觉线索，读屏需要从
 *  title/aria-label 听到「所选 / 实际」；降级时明说所选未生效。
 *  无损及以上的权益说明从脚注移到这里，菜单不再堆三段小字。 */
function qualityItemLabel(opt: AudioQualityOption): string {
  const parts = [`${opt.label}（${opt.hint}）`];
  if (opt.value === player.quality) parts.push("所选档位");
  if (mediaLoaded.value && opt.value === player.activeQuality) {
    parts.push("服务端实际下发");
  }
  if (opt.value === player.quality && qualityDowngraded.value) {
    parts.push("所选未生效，服务端下发了较低档位");
  }
  if (audioQualityRank(opt.value) >= audioQualityRank("lossless")) {
    parts.push("需要网易云 VIP/SVIP 权益");
  }
  return parts.join("；");
}

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
  window.removeEventListener("nnplayer:now-playing-closed", focusCoverEntry);
});

/** 正在播放页关闭后把焦点还给封面入口：X 只是视觉出口，焦点不应掉到 body。 */
function focusCoverEntry() {
  void nextTick(() => coverButtonRef.value?.focus());
}

onMounted(() => {
  window.addEventListener("nnplayer:now-playing-closed", focusCoverEntry);
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
        ref="coverButtonRef"
        type="button"
        class="player-cover-button mobile-player-cover relative w-12 h-12 shrink-0"
        :title="player.currentSong ? '打开正在播放页' : '打开正在播放页（尚未播放）'"
        :aria-label="
          player.currentSong ? '打开正在播放页' : '打开正在播放页（尚未播放）'
        "
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

    <!-- 中：control + progress。
         中央列高度窄窗固定 40 + gap(8) + 12 = 60px，居中于 74px 条；
         间距 8px 是为了让 24px 进度命中框完整落在条内同时不侵入播放键的目标区。 -->
    <div class="player-center-column w-full flex flex-col items-center min-w-0">
      <div class="player-transport flex items-center">
        <button
          type="button"
          class="player-icon-button"
          :title="`播放模式：${modeLabel}，点击切换为${nextModeLabel}`"
          :aria-label="`播放模式：${modeLabel}，点击切换为${nextModeLabel}`"
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
          :disabled="!player.currentSong"
          :aria-label="playButtonLabel"
          :aria-busy="player.audioState.loading"
          :title="playButtonLabel"
          @click="player.togglePlay"
        >
          <!-- 播放中的 2s 陶土脉冲光环（DESIGN Player bar → States）。
               装饰层：只动 transform/opacity（合成器属性），同色描边在按钮内
               不可见，scale 扩出按钮后形成光环；keyframes 缺失时保持静止不可见。 -->
          <span
            v-if="player.audioState.playing && !player.audioState.loading"
            class="player-play-ring animate-play-ring"
            aria-hidden="true"
          />
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
        <!-- 与左侧「播放模式」等宽的不可见占位：让 40px 播放键保持在内容壳中线。 -->
        <span class="player-icon-spacer" aria-hidden="true"></span>
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
      class="player-extras w-full max-w-[180px] min-w-0 justify-self-end flex items-center gap-1.5"
    >
      <!-- 音质入口在窄窗必须保留：≤768px 只隐藏音量，胶囊始终可达。 -->
      <button
        ref="qualityButtonRef"
        type="button"
        class="player-quality-button"
        :class="{
          'is-open': qualityMenuOpen,
          'is-downgraded': mediaLoaded && qualityDowngraded,
          'is-unknown': !mediaLoaded || player.activeQuality === null,
        }"
        :title="qualityButtonTitle"
        :aria-label="qualityButtonTitle"
        :aria-expanded="qualityMenuOpen"
        aria-haspopup="menu"
        @click="toggleQualityMenu"
      >
        <AudioLines :size="13" :stroke-width="1.75" aria-hidden="true" />
        <span class="player-quality-label text-[11px] font-medium leading-none">
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
      <div class="player-volume min-w-0 flex-1 flex items-center gap-1.5 mobile-hide-on-small">
        <button
          type="button"
          class="player-mute-button"
          :title="player.audioState.muted ? '取消静音' : '静音'"
          :aria-label="player.audioState.muted ? '取消静音' : '静音'"
          :aria-pressed="player.audioState.muted"
          @click="player.toggleMute"
        >
          <VolumeX
            v-if="player.audioState.muted"
            :size="15"
            :stroke-width="1.6"
            aria-hidden="true"
          />
          <Volume2 v-else :size="15" :stroke-width="1.5" aria-hidden="true" />
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="player.audioState.volume"
          class="player-volume-range flex-1 min-w-0 appearance-none cursor-pointer"
          aria-label="音量"
          :aria-valuetext="
            player.audioState.muted
              ? `已静音（音量 ${Math.round(player.audioState.volume * 100)}%）`
              : `${Math.round(player.audioState.volume * 100)}%`
          "
          @input="onVolume"
          style="accent-color: var(--color-accent);"
        />
      </div>
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
          <!-- 选中档位铺陶土洗色；本组件 scoped 样式重置了按钮背景，
               Tailwind utility 需带 ! 才能压过它。 -->
          <button
            v-for="opt in AUDIO_QUALITY_OPTIONS"
            :key="opt.value"
            type="button"
            role="menuitemradio"
            :aria-checked="opt.value === player.quality"
            :aria-label="qualityItemLabel(opt)"
            :title="qualityItemLabel(opt)"
            class="quality-menu-item"
            :class="{ '!bg-accent-subtle': opt.value === player.quality }"
            @click="selectQuality(opt.value)"
          >
            <span class="w-4 shrink-0 flex items-center justify-center">
              <Check
                v-if="opt.value === player.quality"
                :size="14"
                :stroke-width="2"
                class="text-accent-on-subtle"
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
              实际
            </span>
          </button>
        </div>
        <div class="quality-menu-footer">
          勾选=所选；实际以服务端下发为准。
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

/* 中央列：桌面 40 + 6 + 12 = 58px（76px 条内）；窄窗 40 + 8 + 12 = 60px
   （74px 条内，上下各 7px）。窄窗 8px 间距是 #9 的几何契约：播放键圆心 27
   ↔ 24px 进度命中框圆心 61 = 34px ≥ 20 + 12 = 32px（WCAG 2.5.8 目标尺寸），
   同时命中框 49–73 完整落在条内。改这里要同步 tests/playerBarGeometry.test.mjs。 */
.player-center-column {
  gap: 6px;
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

/* 脉冲光环：绝对定位的装饰层，只在播放中出现；和按钮同色，
   所以按钮内不可见、scale 到 1.6 后成为一圈陶土光晕。 */
.player-play-ring {
  position: absolute;
  inset: 0;
  border: 2px solid var(--color-accent);
  border-radius: 9999px;
  pointer-events: none;
}

.player-play-button:hover:not(:disabled) {
  transform: scale(1.045);
  box-shadow: 0 4px 14px var(--color-glow);
}

.player-play-button:active:not(:disabled) {
  transform: scale(0.94);
}

/* 与左侧模式键同宽的空占位，保持播放键几何居中；不可见、不参与交互。 */
.player-icon-spacer {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
}

.player-icon-button:disabled,
.player-play-button:disabled {
  cursor: default;
  opacity: 0.28;
}

.player-cover-button:focus-visible,
.player-icon-button:focus-visible,
.player-play-button:focus-visible,
.player-mute-button:focus-visible,
.player-volume-range:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.player-time {
  /* 11px 时间标签默认继承 1.5 行高（16.5px），会把进度行撑到 16.5px，
     破坏 #9 的窄窗几何（进度行必须是 12px，24px 命中框才能落在 49–73）。
     行高收到 1 后：桌面中央列 40+6+12 = 58px（76px 条内），
     窄窗 40+8+12 = 60px（74px 条内，上下各 7px）。数字本就只占 11px，视觉不变。 */
  line-height: 1;
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

.player-mute-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.player-mute-button:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-soft, var(--color-card-hover));
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

/* 菜单勾选表示“所选请求档位”；实际下发档位用独立胶囊标记。
   字号 11px：DESIGN 的 Micro 最小可读字号，不再往下（旧 10px 与文档自相矛盾）；
   洗色上的文字用 accent-on-subtle，满足 DESIGN「洗色上的强调色文字」对比度要求。 */
.quality-menu-current {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-accent-on-subtle, var(--color-accent));
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

/* 窄窗只隐藏音量，音质胶囊必须保留：右列按胶囊实际宽度计入网格，
   避免 521–768px 区间把胶囊挤出内容盒被裁切。 */
@media (max-width: 768px) {
  .player-bar-grid {
    grid-template-columns: minmax(0, 1fr) clamp(200px, 42%, 280px) max-content;
  }

  .player-extras {
    width: auto;
    max-width: none;
  }

  /* #9 几何契约：窄窗 74px 播放条（styles.css .mobile-player-bar），
     中央列 40 + 8 + 12 = 60px，居中后上下各 7px：
       播放键圆心 = 7 + 40/2 = 27
       进度命中框圆心 = 7 + 40 + 8 + 12/2 = 61
       间距 = 34px ≥ 20（播放键半径）+ 12（命中框半径）= 32px
     24px 命中框落在 49–73，完整处于 74px 条内（1px 余量）。
     跑 tests/playerBarGeometry.test.mjs 可校验这组算术。 */
  .player-center-column {
    gap: 8px;
  }
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

  /* 胶囊图标化：文字收起，图标 + 降级箭头仍保留，点击仍展开音质菜单。 */
  .player-quality-button {
    width: 40px;
    height: 28px;
    padding: 0;
    gap: 3px;
    justify-content: center;
  }

  .player-quality-label {
    display: none;
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
