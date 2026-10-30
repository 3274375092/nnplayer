<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRoute, useRouter } from "vue-router";
import Sidebar from "@/components/Sidebar.vue";
import PlayerBarFloating from "@/components/PlayerBarFloating.vue";
import GlobalNotice from "@/components/GlobalNotice.vue";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import { usePlayerStore } from "@/stores/player";
import { useNoticeStore, type NoticeAction } from "@/stores/notice";
import { useUserStore } from "@/stores/user";
import { subscribeAuthEpoch } from "@/services/authEpoch";
import { useLyric } from "@/composables/useLyric";
import { useTauriBridge } from "@/composables/useTauriBridge";
import { useCoverTheme } from "@/composables/useCoverTheme";
import { describePlaybackFailure } from "@/utils/appErrors";
import {
  audioQualityOption,
  formatActualQuality,
  isQualityDowngraded,
} from "@/utils/audioQuality";
import type { AudioQuality } from "@/types/music";

const desktopLyricsStore = useDesktopLyricsStore();
const route = useRoute();
const router = useRouter();
const noticeStore = useNoticeStore();

const isLoginRoute = computed(() => route.name === "Login");
const isNowPlayingRoute = computed(() => route.name === "NowPlaying");

const isDesktopLyrics = computed(() => {
  // Vite 浏览器预览没有 Tauri runtime，这里只可能是主窗。
  if (!isTauri()) return false;
  try {
    return getCurrentWindow().label === "desktop-lyrics";
  } catch (e) {
    // label 读不到时按受限的桌面歌词窗处理：主窗退化成极简界面只是不好看，
    // 而桌面歌词窗一旦被当成主窗，会在透明置顶窗里装载第二套 player/audio/
    // MediaSession，那才是真危害。降级方向必须偏安全侧。
    console.warn("[app] 无法读取当前窗口 label，按桌面歌词窗处理", e);
    return true;
  }
});

// 桌面歌词窗只渲染 DesktopLyrics.vue，不能实例化主窗的 player/audio runtime；
// 主窗的 player store 由这里显式持有，用于把播放失败与音质降级转成全局提示。
const playerStore = isDesktopLyrics.value ? null : usePlayerStore();
const userStore = playerStore ? useUserStore() : null;
/** auth epoch 订阅的注销函数（主窗才订阅）。 */
let stopAuthEpochSubscription: (() => void) | null = null;

/** 全局播放失败提示固定用一个 id：连续失败时原地更新而不是堆叠成列。 */
const PLAYBACK_NOTICE_ID = "playback-failure";

/** 音质降级「同一组合只播报一次」的记录；登出/切号/进登录页后重置。 */
const announcedQualityDowngrades = new Set<string>();

/** 首次驻留托盘提示的 id：应用级、只出现一次，会话清理不应把它吞掉。 */
const TRAY_HINT_NOTICE_ID = "tray-residence-hint";

/** 会话切换或进入登录页时，旧会话的全局提示与降级播报记录都不再适用。 */
function resetSessionNotices() {
  announcedQualityDowngrades.clear();
  // 驻留托盘提示与账号无关，且由用户手动关闭；会话清理只清其余提示。
  for (const notice of [...noticeStore.notices]) {
    if (notice.id !== TRAY_HINT_NOTICE_ID) noticeStore.dismiss(notice.id);
  }
}

/** 重新登录：先清本地登录态再进登录页，否则路由守卫会把已登录用户弹回原页。 */
function reloginFromNotice() {
  if (!userStore) return;
  void userStore.logout().then(() => {
    void router.push({
      name: "Login",
      query: { redirect: route.fullPath },
    });
  });
}

if (playerStore) {
  // 播放失败 → 全局状态条（人话标题 + 恢复动作 + 可折叠技术详情）。
  watch(
    () => playerStore.lastPlaybackFailure,
    (failure) => {
      if (!failure) {
        noticeStore.dismiss(PLAYBACK_NOTICE_ID);
        return;
      }
      const described = describePlaybackFailure(failure);
      let action: NoticeAction | undefined;
      if (described.relogin) {
        action = { label: "重新登录", run: reloginFromNotice };
      } else if (described.retryable) {
        action = {
          label: "重试",
          run: () => {
            void playerStore.retryFailedPlayback();
          },
        };
      }
      noticeStore.push({
        id: PLAYBACK_NOTICE_ID,
        tone: "error",
        title: described.title,
        hint: described.hint,
        detail: described.detail,
        action,
        onDismiss: () => playerStore.dismissPlaybackFailure(),
      });
    },
  );

  // 音质降级：服务端实际档位低于所选时播报一次（状态诚实原则）。
  // 同一「所选 → 实际」组合只提示一次，避免每首歌重复打扰。
  const qualityDowngrade = computed<{
    requested: AudioQuality;
    actual: AudioQuality;
  } | null>(() => {
    const actual = playerStore.activeQuality;
    if (actual === null || !playerStore.activeAudioResolved) return null;
    if (!isQualityDowngraded(actual, playerStore.quality)) return null;
    return { requested: playerStore.quality, actual };
  });

  watch(qualityDowngrade, (downgrade) => {
    if (!downgrade) return;
    const key = `${downgrade.requested}>${downgrade.actual}`;
    if (announcedQualityDowngrades.has(key)) return;
    announcedQualityDowngrades.add(key);
    const requestedLabel = audioQualityOption(downgrade.requested).label;
    const actualSummary =
      formatActualQuality(downgrade.actual, playerStore.activeBitrate) ??
      audioQualityOption(downgrade.actual).label;
    noticeStore.push({
      id: "quality-downgrade",
      tone: "info",
      title: `音质已降级：所选 ${requestedLabel}，实际 ${actualSummary}`,
      hint: "服务端按账号权益与歌曲版权下发较低档位；可在播放条的音质菜单重新选择。",
    });
  });

  // 登出/切号会整体换会话：旧账号的音质降级提示与去重记录不能带到新账号。
  stopAuthEpochSubscription = subscribeAuthEpoch(resetSessionNotices);
}

// 进入登录页（未登录/会话过期）时清掉上一会话残留的全局提示。
watch(isLoginRoute, (login) => {
  if (login) resetSessionNotices();
});

// 桌面歌词 WebView 不能实例化主窗口 player/audio/MediaSession runtime。
const tauriBridge = isDesktopLyrics.value ? null : useTauriBridge();
// 桌面歌词是透明独立窗口，只接收主窗口发送的高明度 accent。
if (!isDesktopLyrics.value) useCoverTheme();

onMounted(async () => {
  if (isDesktopLyrics.value) return;

  // 歌词时钟属于主窗口全局播放能力，不能依赖当前路由是否渲染 LyricPanel。
  const lyric = useLyric();

  // Vite 浏览器预览没有 Tauri runtime。歌词/播放器本身仍可正常挂载，
  // 仅跳过原生窗口生命周期与跨窗口事件桥接。
  if (!isTauri()) return;

  getCurrentWindow().once("tauri://destroyed", () => {
    void desktopLyricsStore.closeWindow();
  });

  await tauriBridge?.setup(lyric.activateDesktopLyricsPublisher);
});

onBeforeUnmount(() => {
  stopAuthEpochSubscription?.();
  stopAuthEpochSubscription = null;
  tauriBridge?.teardown();
});
</script>

<template>
  <!-- 桌面歌词窗：极简，无 Sidebar/PlayerBarFloating/bg-bg -->
  <router-view v-if="isDesktopLyrics" v-slot="{ Component }">
    <transition name="fade-slide" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>

  <!-- 主窗：完整布局 -->
  <div v-else class="theme-root h-full flex bg-bg overflow-hidden">
    <Sidebar class="shrink-0 mobile-sidebar-hidden" />

    <!-- 播放栏和页面共用同一个内容壳，因此始终相对侧栏之外的区域居中。 -->
    <div
      class="app-content-shell relative flex-1 min-w-0 h-full overflow-hidden"
      :class="{
        'app-content-shell--overlay': isNowPlayingRoute,
        'app-content-shell--no-player': isLoginRoute,
      }"
    >
      <main class="app-main overflow-y-auto" tabindex="-1">
        <div class="route-stage">
          <router-view v-slot="{ Component }">
            <transition name="fade-slide">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>

      <PlayerBarFloating v-if="!isLoginRoute" />

      <!-- 全局非阻塞状态条：内容区底部、播放条上方；登录页无播放条时贴底。 -->
      <GlobalNotice :above-player-bar="!isLoginRoute" />
    </div>
  </div>
</template>

<style scoped>
.theme-root {
  color: var(--color-text-primary);
  background: var(--color-canvas);
  transition:
    color 0.45s ease,
    background-color 0.6s ease;
}

.app-content-shell {
  --player-reserved-space: 100px;
}

/* 普通页面的滚动视口止于播放栏上方，内容不会从控件背后穿过。 */
.app-main {
  height: calc(100% - var(--player-reserved-space));
  scroll-padding-bottom: 1rem;
}

/* 全局提示关闭后的焦点兜底目标是内容区（tabindex=-1）：不显示焦点环，
   但读屏与键盘用户不会掉回 <body>。 */
.app-main:focus {
  outline: none;
}

/* 正在播放页自行保留悬浮栏安全区；登录页不显示播放栏。 */
.app-content-shell--overlay .app-main,
.app-content-shell--no-player .app-main {
  height: 100%;
}

.route-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.route-stage > * {
  flex: 1 0 auto;
  min-width: 0;
}

/* 新旧页面交叉淡入；离场页脱离文档流，避免 out-in 造成整页空白帧。 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.route-stage > .fade-slide-enter-active {
  position: relative;
  z-index: 1;
}

.route-stage > .fade-slide-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
  pointer-events: none;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .app-content-shell {
    --player-reserved-space: 76px;
  }

  /* 旧的逐页移动端留白由 app-main 统一接管，避免叠加成双倍空白。 */
  .app-main :deep(.mobile-content-padding) {
    padding-bottom: 0 !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-root {
    transition: none;
  }

  .fade-slide-enter-active,
  .fade-slide-leave-active {
    transition: opacity 0.01ms linear;
  }

  .fade-slide-enter-from,
  .fade-slide-leave-to {
    transform: none;
  }
}
</style>
