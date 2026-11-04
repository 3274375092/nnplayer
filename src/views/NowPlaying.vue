<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Music2, X } from "@lucide/vue";
import LyricPanel from "@/components/LyricPanel.vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";

const player = usePlayerStore();
const router = useRouter();
const currentCover = computed(() =>
  coverImageUrl(player.currentSong?.picUrl, 400),
);

function close() {
  // 播放条监听该事件，把焦点还给封面入口（关闭后焦点不应掉到 body）。
  window.dispatchEvent(new Event("nnplayer:now-playing-closed"));
  void router.back();
}

function goDaily() {
  void router.push({ name: "DailyRecommend" });
}

function goSearch() {
  void router.push({ name: "Search" });
}

// =============== 歌词面板高度 ===============
// 512 CSS 高的验收基线里固定 360 会把整页顶出视口（约 135px 滚动才能读到歌词
// 尾声）。这里改为实测：可见视口 − 页头 − 内容区内边距 − 元信息 − 列间距 −
// 歌词面板自身的渲染余量，结果夹在 180–360 之间；960×640 仍解析为 360，保持
// DESIGN 几何。
const LYRIC_PANEL_MAX_HEIGHT = 360;
const LYRIC_PANEL_MIN_HEIGHT = 180;
// LyricPanel 把 panelHeight 当 min-height 与内部视口基准，但根节点还有 p-4
// （上下共 32px 内边距）、32px 标题行（24px 标题 + mb-2 8px），而内部视口只
// 扣掉 LYRIC_CHROME_HEIGHT 40px ⇒ 实际渲染高度 = panelHeight + 24px。预留时
// 必须把这个余量算进去，否则 768×512 下页面会多出约 24px 的滚动（审计 #18
// 的残余）。用常量而不是渲染后再测一次：避免「测高度 → 改 prop → 再测」的
// 抖动循环。
const LYRIC_PANEL_RENDER_OVERHEAD = 24;

const rootRef = ref<HTMLElement | null>(null);
const headerRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const detailsRef = ref<HTMLElement | null>(null);
const metadataRef = ref<HTMLElement | null>(null);
const lyricPanelHeight = ref(LYRIC_PANEL_MAX_HEIGHT);
let layoutObserver: ResizeObserver | null = null;

function measureLyricPanelHeight() {
  const root = rootRef.value;
  const header = headerRef.value;
  const content = contentRef.value;
  const details = detailsRef.value;
  if (!root || !header || !content || !details || root.clientHeight === 0) return;
  // 这个页面本身由骨架的 .app-main 承担滚动：.now-playing 是 flex:1 项，
  // 内容超过窗口时它的 height 会被内容撑开，clientHeight 不再等于可见视口。
  // 可用高度取「可见滚动视口」与根容器中较小者，两种布局下都成立。
  const scrollPort = root.closest(".app-main") as HTMLElement | null;
  const viewportHeight = Math.min(
    root.clientHeight,
    scrollPort?.clientHeight || window.innerHeight,
  );
  const contentStyle = getComputedStyle(content);
  const detailsStyle = getComputedStyle(details);
  const reserved =
    header.offsetHeight +
    (Number.parseFloat(contentStyle.paddingTop) || 0) +
    (Number.parseFloat(contentStyle.paddingBottom) || 0) +
    (metadataRef.value?.offsetHeight ?? 0) +
    (Number.parseFloat(detailsStyle.rowGap) || 0) +
    LYRIC_PANEL_RENDER_OVERHEAD;
  const available = viewportHeight - reserved;
  const next = Math.round(
    Math.min(
      LYRIC_PANEL_MAX_HEIGHT,
      Math.max(LYRIC_PANEL_MIN_HEIGHT, available),
    ),
  );
  if (next !== lyricPanelHeight.value) lyricPanelHeight.value = next;
}

function observeLayoutTargets() {
  if (!layoutObserver) return;
  const scrollPort = rootRef.value?.closest(".app-main");
  for (const el of [
    rootRef.value,
    headerRef.value,
    contentRef.value,
    detailsRef.value,
    metadataRef.value,
    scrollPort,
  ]) {
    if (el) layoutObserver.observe(el);
  }
}

async function refreshLyricPanelHeight() {
  await nextTick();
  measureLyricPanelHeight();
  observeLayoutTargets();
}

// 曲目切换会新建元信息节点（标题换行高度不同），重新测量并观察。
watch(
  () => player.currentSong?.id,
  () => {
    void refreshLyricPanelHeight();
  },
);

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", measureLyricPanelHeight);
  // 首次测量等布局完成；之后由 ResizeObserver 跟踪窗口尺寸、页头与元信息变化。
  await refreshLyricPanelHeight();
  if (typeof ResizeObserver === "undefined") return;
  layoutObserver = new ResizeObserver(() => measureLyricPanelHeight());
  observeLayoutTargets();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", measureLyricPanelHeight);
  layoutObserver?.disconnect();
  layoutObserver = null;
});
</script>

<template>
  <section
    ref="rootRef"
    class="now-playing"
    :aria-label="player.currentSong ? '正在播放' : '播放器'"
  >
    <header ref="headerRef" class="now-playing__header">
      <div class="now-playing__eyebrow">
        <span v-if="player.currentSong">正在播放</span>
      </div>
      <button
        type="button"
        class="now-playing__close"
        title="关闭正在播放"
        aria-label="关闭正在播放"
        @click="close"
      >
        <X :size="18" :stroke-width="1.75" />
      </button>
    </header>

    <section
      ref="contentRef"
      class="now-playing__content"
      :aria-label="player.currentSong ? '当前歌曲' : '播放器'"
    >
      <div class="now-playing__artwork-wrap">
        <div class="now-playing__artwork">
          <img
            v-if="player.currentSong?.picUrl"
            :src="currentCover"
            class="now-playing__cover"
            :alt="`${player.currentSong.name} 专辑封面`"
            loading="eager"
            decoding="async"
            fetchpriority="high"
          />
          <Music2
            v-else
            :size="72"
            :stroke-width="1.25"
            class="now-playing__placeholder"
            aria-hidden="true"
          />
        </div>
      </div>

      <div ref="detailsRef" class="now-playing__details">
        <template v-if="player.currentSong">
          <div ref="metadataRef" class="now-playing__metadata">
            <h1 class="now-playing__title">
              {{ player.currentSong.name }}
            </h1>
            <p class="now-playing__artist">
              {{ player.currentSong.artists || "—" }}
              <span v-if="player.currentSong.album" class="now-playing__separator">·</span>
              <span v-if="player.currentSong.album">{{ player.currentSong.album }}</span>
            </p>
          </div>

          <!-- 歌词区用 section 承载 h2 语义：歌词卡内部的 h3「歌词」作为它的小节
               标题，标题层级变成 h1（歌曲名）→ h2（当前歌词）→ h3，不再跳级。 -->
          <section
            class="now-playing__lyrics"
            aria-labelledby="now-playing-lyrics-heading"
          >
            <h2 id="now-playing-lyrics-heading" class="sr-only">当前歌词</h2>
            <LyricPanel
              :panel-height="lyricPanelHeight"
              :line-height="40"
            />
          </section>
        </template>

        <!-- 空态：说明为什么没有内容，并给出下一步可做的事。 -->
        <div v-else class="now-playing__empty">
          <h1 class="now-playing__title">还没有播放歌曲</h1>
          <p class="now-playing__empty-hint">
            从每日推荐或搜索里选一首歌，开始播放。
          </p>
          <div class="now-playing__empty-actions">
            <button type="button" class="btn btn-primary" @click="goDaily">
              浏览每日推荐
            </button>
            <button type="button" class="btn btn-ghost" @click="goSearch">
              搜索歌曲
            </button>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.now-playing {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  container-name: now-playing;
  container-type: inline-size;
  background: var(--color-bg);
}

.now-playing__header {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 1.35rem clamp(1.25rem, 3vw, 2.25rem) 0.75rem;
}

.now-playing__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--color-text-secondary);
  /* Micro 11px 是 DESIGN 声明的最小可读字号；0.72rem（11.52px）不在阶梯上。 */
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
}

.now-playing__close {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border: 0;
  border-radius: 0.35rem;
  color: var(--color-text-secondary);
  background: var(--color-raised);
  box-shadow: var(--shadow-raised);
  transition:
    color 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

.now-playing__close:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-strong, var(--color-card-hover));
}

.now-playing__close:active {
  transform: scale(0.96);
}

.now-playing__close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}

.now-playing__content {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(14rem, 0.92fr) minmax(20rem, 1.08fr);
  align-items: center;
  flex: 1;
  min-height: 0;
  width: min(100%, 74rem);
  margin: 0 auto;
  padding: clamp(0.5rem, 2vh, 1.25rem) clamp(1.4rem, 5vw, 4rem) 5.75rem;
  gap: clamp(3rem, 8vw, 7rem);
}

.now-playing__artwork-wrap {
  position: relative;
  justify-self: end;
  width: clamp(15rem, min(36vw, 52vh), 24rem);
  max-width: 100%;
  aspect-ratio: 1;
}

.now-playing__artwork {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  background: var(--color-surface-soft, var(--color-card));
  box-shadow: var(--shadow-floating);
}

.now-playing__cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-playing__placeholder {
  color: var(--color-text-tertiary);
}

.now-playing__details {
  display: flex;
  min-width: 0;
  max-width: 33rem;
  flex-direction: column;
  gap: 1.25rem;
}

.now-playing__metadata {
  min-width: 0;
  padding-left: 0.2rem;
}

.now-playing__title {
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 0.45rem;
  /* Windows WebView 在紧行高 + line-clamp 下会裁掉 g/y 等字形的下伸部。 */
  padding-bottom: 0.1em;
  color: var(--color-text-primary);
  font-size: 2.5rem;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.12;
  text-wrap: balance;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.now-playing__artist {
  overflow: hidden;
  margin: 0;
  color: var(--color-text-secondary);
  /* Weight-Not-Size Rule：正文上限 14px，层级靠字重/文字色区分。 */
  font-size: 0.875rem;
  font-weight: 450;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-playing__empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}

.now-playing__empty-hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 450;
  line-height: 1.5;
}

.now-playing__empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.now-playing__separator {
  margin: 0 0.5rem;
  color: var(--color-text-secondary);
}

.now-playing__lyrics :deep(.lyric-panel) {
  border: 0;
  padding-inline: 0;
  background: transparent;
  box-shadow: none;
}

/* 高度缓解不按宽度设门：512 CSS 高的验收基线正好是 768 宽，旧门
   `and (min-width: 821px)` 让它永远不触发。所有宽度在矮窗下都压缩。 */
@media (max-height: 700px) {
  .now-playing__header {
    padding-top: 1rem;
  }

  .now-playing__content {
    padding-top: 0.25rem;
    gap: clamp(2rem, 6vw, 4.5rem);
  }

  .now-playing__artwork-wrap {
    width: clamp(14rem, min(34vw, 47vh), 19rem);
  }

  .now-playing__details {
    gap: 0.85rem;
  }
}

@container now-playing (max-width: 52rem) {
  .now-playing__content {
    grid-template-columns: minmax(11rem, 0.8fr) minmax(17rem, 1.2fr);
    padding-inline: 1.5rem;
    gap: 2rem;
  }

  .now-playing__artwork-wrap {
    width: clamp(11rem, 28cqw, 14rem);
  }

  .now-playing__details {
    gap: 0.85rem;
  }

  .now-playing__title {
    font-size: 2rem;
  }
}

@container now-playing (max-width: 38rem) {
  .now-playing__content {
    grid-template-columns: 1fr;
    align-content: start;
    justify-items: center;
    padding-top: 1rem;
    gap: 2rem;
  }

  .now-playing__artwork-wrap {
    justify-self: center;
    width: min(65vw, 17rem);
  }

  .now-playing__details {
    width: min(100%, 34rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .now-playing__close {
    transition: none;
  }
}
</style>
