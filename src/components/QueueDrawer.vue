<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Music2, Play, Trash, X } from "@lucide/vue";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";
import { fmtDurationMs, fmtLongDuration } from "@/utils/format";
import type { Song } from "@/types/music";

/** 一次最多渲染多少行待播歌曲；避免超长队列（数千首）一次铺满 DOM。 */
const QUEUE_WINDOW_LIMIT = 100;

const open = ref(false);
const player = usePlayerStore();
const dialogRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
/** 打开前的焦点位置，关闭时归还（队列由侧栏按钮通过 open() 触发）。 */
let lastActiveElement: HTMLElement | null = null;

/** 当前曲在队列中的绝对索引；没有当前曲时从队列头部开始展示。 */
const baseIndex = computed(() =>
  player.index >= 0 && player.index < player.queue.length ? player.index : 0,
);

/**
 * 展示从当前曲开始的队列。当前曲本身也要在列表里，否则“正在播放”无处标记，
 * 而且 33 首的队列会只显示 32 首。行内保存绝对索引，点播/删除/拖拽都用它，
 * 不能用相对位置。
 */
const displayItems = computed(() => {
  const start = baseIndex.value;
  const end = Math.min(
    player.queue.length,
    start + QUEUE_WINDOW_LIMIT + 1,
  );
  return player.queue.slice(start, end).map((song, offset) => ({
    song,
    absIndex: start + offset,
  }));
});

/** 从当前曲算起、尚未显示出来的剩余歌曲数。 */
const hiddenCount = computed(() =>
  Math.max(
    0,
    player.queue.length - baseIndex.value - displayItems.value.length,
  ),
);

/** 从当前曲（含）到队尾的歌曲数。 */
const remainingCount = computed(() =>
  Math.max(0, player.queue.length - baseIndex.value),
);

/** 当前曲之后真正“待播”的歌曲数；决定清空按钮是否还有意义。 */
const upcomingCount = computed(() => {
  if (player.index < 0) return player.queue.length;
  return Math.max(0, player.queue.length - player.index - 1);
});

const totalDuration = computed(() => {
  const ms = player.queue
    .slice(baseIndex.value)
    .reduce((sum, s) => sum + (s.duration ?? 0), 0);
  return fmtLongDuration(ms);
});

function isCurrent(absIdx: number) {
  return player.index >= 0 && absIdx === player.index;
}

function currentStatusLabel() {
  if (player.audioState.loading) return "缓冲中";
  return player.audioState.playing ? "播放中" : "已暂停";
}

function rowLabel(song: Song) {
  return `播放歌曲 ${song.name}，艺人 ${song.artists}`;
}

/**
 * 按绝对索引点播。不能走 playSong(song)：它按 id findIndex 找队列里的第一首，
 * 队列含重复 songId 时会播错行、当前行标记也会错位。
 */
function playRow(absIdx: number) {
  if (absIdx < 0 || absIdx >= player.queue.length) return;
  // 用同一队列内容重建队列并定位到 absIdx（playList 会按索引装载并播放）。
  void player.playList([...player.queue], absIdx);
}

function onRowKeydown(e: KeyboardEvent, absIdx: number) {
  // 行内删除按钮的键盘事件不要被当成“播放整行”。
  if (e.target !== e.currentTarget) return;
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
  e.preventDefault();
  playRow(absIdx);
}

function onDragStart(e: DragEvent, absIdx: number) {
  e.dataTransfer?.setData("text/plain", String(absIdx));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDrop(e: DragEvent, targetAbsIdx: number) {
  e.preventDefault();
  const raw = e.dataTransfer?.getData("text/plain");
  const from = Number(raw);
  if (!Number.isFinite(from)) return;
  if (from === targetAbsIdx) return;
  if (from < 0 || from >= player.queue.length) return;
  if (targetAbsIdx < 0 || targetAbsIdx > player.queue.length) return;
  player.reorderQueue(from, targetAbsIdx);
}

function remove(absIdx: number) {
  player.removeFromQueue(absIdx);
  // 被删除的行（含焦点所在的删除按钮）会从 DOM 移除，焦点会掉到 body；
  // 把焦点交还对话框，避免后续 Tab 落到遮罩后的页面上。
  void nextTick().then(() => {
    if (open.value && !dialogRef.value?.contains(document.activeElement)) {
      (closeButtonRef.value ?? dialogRef.value)?.focus();
    }
  });
}

function clear() {
  if (window.confirm("清空接下来要播放的歌曲？当前歌曲会继续播放。")) {
    player.clearQueue();
  }
}

function playAll() {
  const songs = [...player.queue.slice(baseIndex.value)];
  if (songs.length === 0) return;
  void player.playList(songs, 0);
}

/**
 * 对话框内的键盘管理：Esc 关闭；Tab/Shift+Tab 在对话框内循环，
 * 遮罩后的页面不会被意外聚焦（焦点从行内按钮移除后由本处理器拉回）。
 * 监听挂到 document 上：行被删除后焦点会落到 body，此时只有 document
 * 还能收到 keydown 并把焦点带回对话框。
 */
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    open.value = false;
    return;
  }
  if (e.key !== "Tab") return;
  const focusable = getFocusableElements();
  if (focusable.length === 0) {
    e.preventDefault();
    dialogRef.value?.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  const insideDialog = dialogRef.value?.contains(active) ?? false;
  if (!insideDialog) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === dialogRef.value)) {
    e.preventDefault();
    last.focus();
  }
}

function getFocusableElements(): HTMLElement[] {
  const root = dialogRef.value;
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

watch(
  open,
  async (v) => {
    if (v) {
      lastActiveElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      document.addEventListener("keydown", onGlobalKeydown);
      await nextTick();
      (closeButtonRef.value ?? dialogRef.value)?.focus();
    } else {
      document.removeEventListener("keydown", onGlobalKeydown);
      const target = lastActiveElement;
      lastActiveElement = null;
      target?.focus();
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onGlobalKeydown);
});

defineExpose({
  open: () => (open.value = true),
  close: () => (open.value = false),
});
</script>

<template>
  <Teleport to="body">
    <Transition name="queue-fade">
      <div
        v-if="open"
        class="fixed inset-0 bg-black/20 z-40"
        @click="open = false"
      />
    </Transition>

    <Transition name="queue-slide">
      <aside
        v-if="open"
        ref="dialogRef"
        class="glass fixed top-4 right-4 bottom-4 w-[380px] max-w-[calc(100vw-32px)] z-50 flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="播放队列"
        tabindex="-1"
      >
        <header class="flex items-center justify-between px-5 py-4">
          <h2 class="text-base font-semibold text-text-primary">播放队列</h2>
          <button
            ref="closeButtonRef"
            type="button"
            class="queue-icon-button w-8 h-8 rounded-full bg-surface-soft hover:bg-surface-strong flex items-center justify-center transition-all duration-200 active:scale-95"
            aria-label="关闭队列"
            @click="open = false"
          >
            <X :size="14" :stroke-width="1.5" class="text-text-secondary" aria-hidden="true" />
          </button>
        </header>

        <div
          v-if="remainingCount > 0"
          class="px-5 py-3 text-xs text-text-secondary flex gap-4"
        >
          <span>剩余 {{ remainingCount }} 首</span>
          <span>剩余时长 {{ totalDuration }}</span>
        </div>

        <div
          v-if="remainingCount === 0"
          class="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3 px-8 text-center"
        >
          <Music2 :size="40" :stroke-width="1.25" aria-hidden="true" />
          <span>队列为空，播放一首歌后，这里会显示当前和接下来的歌曲</span>
        </div>

        <ul v-else class="flex-1 overflow-y-auto py-1">
          <li
            v-for="(item, i) in displayItems"
            :key="`${item.song.id}:${item.absIndex}`"
            class="queue-row group relative flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors duration-150 text-text-primary"
            :class="{
              'bg-accent-subtle': isCurrent(item.absIndex),
              'hover:bg-surface-soft': !isCurrent(item.absIndex),
            }"
            tabindex="0"
            role="button"
            draggable="true"
            :aria-current="isCurrent(item.absIndex) ? 'true' : undefined"
            :aria-label="rowLabel(item.song)"
            @click="playRow(item.absIndex)"
            @keydown="onRowKeydown($event, item.absIndex)"
            @dragstart="onDragStart($event, item.absIndex)"
            @dragover="onDragOver"
            @drop="onDrop($event, item.absIndex)"
          >
            <span
              class="text-text-tertiary text-xs w-5 tabular-nums text-right font-medium shrink-0"
              aria-hidden="true"
            >
              <Play
                v-if="isCurrent(item.absIndex)"
                :size="12"
                :stroke-width="2"
                class="text-accent mx-auto"
                :class="{ 'animate-play-pulse': player.audioState.playing }"
              />
              <span v-else>{{ player.index >= 0 ? i : i + 1 }}</span>
            </span>
            <div class="w-9 h-9 rounded-md overflow-hidden shrink-0 relative">
              <img
                v-if="item.song.picUrl"
                :src="coverImageUrl(item.song.picUrl, 36)"
                class="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
                alt=""
              />
              <div v-else class="w-full h-full bg-surface-soft flex items-center justify-center">
                <Music2 :size="14" :stroke-width="1.25" class="text-text-tertiary" aria-hidden="true" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div
                class="text-sm truncate text-text-primary"
                :class="{ 'font-medium': isCurrent(item.absIndex) }"
              >
                {{ item.song.name }}
              </div>
              <div class="text-xs text-text-secondary truncate">
                {{ item.song.artists }}
              </div>
            </div>
            <!-- 当前行把时长位让给状态标记，标题区不被徽标挤占。 -->
            <span
              v-if="isCurrent(item.absIndex)"
              class="queue-current-badge shrink-0"
            >
              {{ currentStatusLabel() }}
            </span>
            <span
              v-else
              class="text-xs text-text-tertiary tabular-nums font-medium shrink-0"
            >
              {{ fmtDurationMs(item.song.duration) }}
            </span>
            <button
              type="button"
              class="queue-remove w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-text-tertiary hover:text-accent transition-colors duration-150"
              :aria-label="`从队列移除 ${item.song.name}`"
              @click.stop="remove(item.absIndex)"
            >
              <X :size="14" :stroke-width="1.5" aria-hidden="true" />
            </button>
          </li>
          <li
            v-if="hiddenCount > 0"
            class="px-5 py-2 text-xs text-text-tertiary"
          >
            已显示 {{ displayItems.length }} 首，还有 {{ hiddenCount }} 首未显示
          </li>
          <li
            v-else-if="upcomingCount === 0 && remainingCount > 0"
            class="px-5 py-2 text-xs text-text-tertiary"
          >
            没有更多待播歌曲
          </li>
        </ul>

        <footer
          v-if="remainingCount > 0 && (displayItems.length > 1 || upcomingCount > 0)"
          class="px-5 py-3 flex gap-2"
        >
          <button
            v-if="displayItems.length > 1"
            type="button"
            class="btn btn-ghost queue-footer-button text-xs rounded-xl"
            @click="playAll"
          >
            <Play :size="14" :stroke-width="1.5" class="mr-1" aria-hidden="true" />
            {{ player.index >= 0 ? "从当前播放" : "播放全部" }}
          </button>
          <button
            v-if="upcomingCount > 0"
            type="button"
            class="btn btn-ghost queue-footer-button text-xs text-text-tertiary hover:text-accent rounded-xl ml-auto"
            @click="clear"
          >
            <Trash :size="14" :stroke-width="1.5" class="mr-1" aria-hidden="true" />清空待播
          </button>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.queue-row {
  outline: none;
}

.queue-row:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
  border-radius: 6px;
}

.queue-remove {
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease;
}

.queue-row:hover .queue-remove,
.queue-row:focus-within .queue-remove {
  opacity: 1;
}

.queue-remove:focus-visible {
  opacity: 1;
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.queue-current-badge {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-accent-on-subtle);
  background: var(--color-accent-subtle);
}

.queue-icon-button:focus-visible,
.queue-footer-button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.queue-fade-enter-active,
.queue-fade-leave-active {
  transition: opacity 0.18s ease;
}
.queue-fade-enter-from,
.queue-fade-leave-to {
  opacity: 0;
}

.queue-slide-enter-active,
.queue-slide-leave-active {
  transition: transform 0.22s ease;
}
.queue-slide-enter-from,
.queue-slide-leave-to {
  transform: translateX(calc(100% + 16px));
}
</style>
