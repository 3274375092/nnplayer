<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ChevronDown,
  ChevronUp,
  Music2,
  Play,
  RefreshCw,
  Trash,
  X,
} from "@lucide/vue";
import { usePlayerStore } from "@/stores/player";
import { useNoticeStore } from "@/stores/notice";
import { useBackgroundInert } from "@/composables/useBackgroundInert";
import { describePlaybackFailure } from "@/utils/appErrors";
import { coverImageUrl } from "@/utils/coverImage";
import { fmtDurationMs, fmtLongDuration } from "@/utils/format";
import { remainingQueueDurationMs } from "@/utils/queue";
import type { Song } from "@/types/music";

/** 一次最多渲染多少行待播歌曲；避免超长队列（数千首）一次铺满 DOM。 */
const QUEUE_WINDOW_LIMIT = 100;

const open = ref(false);
// 抽屉打开期间背景 inert：焦点陷阱之外，读屏浏览模式也不能走进背景页面。
// 播放条不在背景里——遮罩与面板都让开它，音质/音量/播放键在抽屉打开时仍可直接
// 操作（见组件底部样式注释与 DESIGN Queue drawer），因此把它从 inert 子树中排除。
useBackgroundInert(() => open.value, {
  keepInteractive: ["#nnplayer-player-bar"],
});
const player = usePlayerStore();
const noticeStore = useNoticeStore();

/**
 * 最近一次可撤销的队列操作。三种动作共用同一条撤销条：
 *   - remove：移除单曲（插回原位置）
 *   - clear：清空待播（按原位逐首插回）
 *   - restart：从这首歌开始重建队列（恢复上一份队列与索引）
 * 队列级操作也做撤销，避免“单曲可撤销、整段清空不可撤销”的不一致。
 */
type QueueUndo =
  | {
      kind: "remove";
      song: Song;
      absIdx: number;
      queue: Song[];
      index: number;
      wasCurrent: boolean;
    }
  | {
      kind: "clear";
      queue: Song[];
      index: number;
      removedCount: number;
    }
  | { kind: "restart"; queue: Song[]; index: number };

const undoEntry = ref<QueueUndo | null>(null);

const undoText = computed(() =>
  undoEntry.value ? undoTextFor(undoEntry.value) : "",
);

function undoTextFor(entry: QueueUndo): string {
  if (entry.kind === "remove") return `已移除《${entry.song.name}》`;
  if (entry.kind === "clear") return `已清空 ${entry.removedCount} 首待播`;
  return "队列已从这首歌重新开始";
}

/** 抽屉内「撤销」：执行后立即清掉提示，避免重复撤销。 */
function undoLastAction() {
  const entry = undoEntry.value;
  if (!entry) return;
  undoEntry.value = null;
  runUndo(entry);
}

/**
 * 抽屉关闭后撤销不应凭空消失：把仍可撤销的动作转成一条全局提示（此时没有
 * 遮罩，提示条在播放条上方可见可点）。抽屉重新打开时不再恢复旧提示。
 */
watch(open, (isOpen) => {
  if (isOpen) return;
  const entry = undoEntry.value;
  undoEntry.value = null;
  if (!entry) return;
  noticeStore.push({
    id: "queue-undo",
    tone: "info",
    title: undoTextFor(entry),
    hint: "如需恢复，请点「撤销」；关掉这条提示即放弃。",
    // 撤销是一次性动作：执行后必须自己把提示关掉，否则同一闭包可以被再次
    // 点击，把已经插回的歌曲再插一遍（round-5 代码评审 M1）。
    action: {
      label: "撤销",
      run: () => {
        noticeStore.dismiss("queue-undo");
        runUndo(entry);
      },
    },
    onDismiss: () => {
      // 用户关掉提示即放弃这次撤销，避免抽屉再次打开时复活旧动作。
      undoEntry.value = null;
    },
  });
});

/** 把撤销动作应用到播放器（抽屉内外共用同一份实现）。 */
function runUndo(entry: QueueUndo) {
  if (entry.kind === "remove") {
    if (entry.wasCurrent) {
      // 删除当前曲会立即播放下一首。撤销必须回到原位置并从该曲重新开始，
      // 否则只剩下一行“已恢复”的队列记录，播放器还在别的歌上。
      void player.playList([...entry.queue], entry.index);
    } else {
      player.insertIntoQueue(entry.absIdx, entry.song);
    }
  } else if (entry.kind === "clear") {
    // 整队列一次恢复：避免 N 次克隆与 N 次订阅通知，也不会让大歌单撤销
    // 变成 O(n²)。
    player.restoreQueueSnapshot(entry.queue, entry.index);
  } else {
    player.restoreQueueSnapshot(entry.queue, entry.index);
  }
}

/** 队列抽屉覆盖全局状态条：把同一份播放失败状态投影到抽屉内部。 */
const playbackFailure = computed(() => player.lastPlaybackFailure);
const describedPlaybackFailure = computed(() =>
  playbackFailure.value
    ? describePlaybackFailure(playbackFailure.value)
    : null,
);
const playbackDismissLabel = computed(() =>
  playbackFailure.value?.autoRetry
    ? "停止自动重试并关闭提示"
    : "关闭播放失败提示",
);

function retryPlaybackFailure() {
  void player.retryFailedPlayback();
}
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

const totalDuration = computed(() =>
  fmtLongDuration(
    remainingQueueDurationMs(
      player.queue,
      player.index,
      player.audioState.currentTime,
    ),
  ),
);

/** 已渲染窗口的末尾绝对索引（不含）。 */
const windowEndAbs = computed(() => baseIndex.value + displayItems.value.length);

/**
 * 行的上移/下移是否可用。
 * - 当前曲是窗口锚点，不能移动：把它挪下一位会让相邻的下一首落在 index 之前，
 *   之后永远不会播到；把待播曲挪到它上面同理。
 * - 上移不越过当前曲（越过等于把歌塞进「已播放」），下移不移出已渲染窗口。
 */
function canMove(absIdx: number, delta: -1 | 1) {
  if (player.index >= 0 && absIdx === player.index) return false;
  if (delta < 0) {
    // 没有当前曲时窗口就是整队列，第一首之上没有位置。
    return absIdx > baseIndex.value + (player.index >= 0 ? 1 : 0);
  }
  return absIdx < windowEndAbs.value - 1;
}

/**
 * 移动后的读屏播报：键盘 Alt+↑/↓ 与行内「上移 / 下移」按钮共用，
 * 都写入对话框内常驻的 polite live region。
 */
const reorderAnnouncement = ref("");

function announceMove(song: Song, newIndex: number, direction?: -1 | 1) {
  const action = direction === -1 ? "上移" : direction === 1 ? "下移" : "移动";
  reorderAnnouncement.value = `已将《${song.name}》${action}到第 ${newIndex + 1} 位`;
}

/**
 * 调整播放顺序。拖拽是快捷方式，键盘（Alt+↑/↓）与行内「上移/下移」按钮
 * 提供同一动作的无拖拽路径（WCAG 2.1.1 / 2.5.7）。
 * origin 决定重排后把焦点还给哪个控件：行 key 含绝对索引，重排后 DOM 会重建，
 * 不恢复焦点就会掉到 <body>（对话框的 Tab 圈也会被破坏）。
 */
function moveItem(
  absIdx: number,
  delta: -1 | 1,
  origin: "play" | "up" | "down",
) {
  const song = player.queue[absIdx];
  if (!song) return;
  if (!canMove(absIdx, delta)) {
    reorderAnnouncement.value =
      player.index >= 0 && absIdx === player.index
        ? "正在播放的歌曲不能移动"
        : delta < 0
          ? "已经无法上移：不能越过当前播放位置"
          : "已经无法下移：已经到队列显示窗口的末尾";
    return;
  }
  // reorderQueue 的 to 是「插入位置」：下移一位要插到 absIdx+2。
  player.reorderQueue(absIdx, delta < 0 ? absIdx - 1 : absIdx + 2);
  const nextIdx = absIdx + delta;
  announceMove(song, nextIdx, delta);
  void nextTick().then(() => focusRowAction(nextIdx, origin));
}

/** 重排后按绝对索引找回同一首歌的控件；目标按钮若在边界变成 disabled 则退回播放键。 */
function focusRowAction(absIdx: number, origin: "play" | "up" | "down") {
  const root = dialogRef.value;
  if (!root) return;
  const play = root.querySelector<HTMLButtonElement>(
    `[data-queue-index="${absIdx}"][data-queue-play]`,
  );
  const target =
    origin === "play"
      ? play
      : root.querySelector<HTMLButtonElement>(
          `[data-queue-index="${absIdx}"][data-queue-move="${origin}"]`,
        );
  if (target && !target.disabled) {
    target.focus();
    return;
  }
  play?.focus();
}

/** 焦点在整行播放按钮上时 Alt+↑/↓ 调整顺序（拖拽的键盘等价路径）。 */
function onRowKeydown(e: KeyboardEvent, absIdx: number) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    moveItem(absIdx, -1, "play");
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    moveItem(absIdx, 1, "play");
  }
}

function isCurrent(absIdx: number) {
  return player.index >= 0 && absIdx === player.index;
}

function currentStatusLabel() {
  if (player.audioState.loading) return "正在缓冲";
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

function onDragStart(e: DragEvent, absIdx: number) {
  e.dataTransfer?.setData("text/plain", String(absIdx));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  // 整行播放按钮铺满行内区域，实际拖拽源可能是这个透明按钮；
  // 统一用整行做拖影，避免拖动时只飞出一个空白按钮轮廓。
  const row = e.currentTarget;
  if (row instanceof HTMLElement) {
    const rect = row.getBoundingClientRect();
    e.dataTransfer?.setDragImage(
      row,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  }
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
  // 落在自己下方一位等价于原位，不必重建队列、也不必播报。
  if (targetAbsIdx === from + 1) return;
  if (from < 0 || from >= player.queue.length) return;
  if (targetAbsIdx < 0 || targetAbsIdx > player.queue.length) return;
  const song = player.queue[from];
  player.reorderQueue(from, targetAbsIdx);
  if (song) {
    // 拖拽同样播报落点，让读屏用户听到顺序已经改变。
    announceMove(song, targetAbsIdx > from ? targetAbsIdx - 1 : targetAbsIdx);
  }
}

function remove(absIdx: number) {
  const removed = player.queue[absIdx];
  if (!removed) return;
  const previousQueue = [...player.queue];
  const previousIndex = player.index;
  const wasCurrent = absIdx === previousIndex;
  player.removeFromQueue(absIdx);
  // 删除是低风险但不可逆的动作：在抽屉内部给一次「撤销」，把歌放回原来的
  // 绝对位置。不能用全局状态条——它位于播放条上方、会被遮罩/抽屉盖住，
  // 恰好在需要撤销的时候看不见也点不到。
  undoEntry.value = {
    kind: "remove",
    song: removed,
    absIdx,
    queue: previousQueue,
    index: previousIndex,
    wasCurrent,
  };
  // 被删除的行（含焦点所在的删除按钮）会从 DOM 移除，焦点会掉到 body；
  // 把焦点交还对话框，避免后续 Tab 落到遮罩后的页面上。
  void nextTick().then(() => {
    if (open.value && !dialogRef.value?.contains(document.activeElement)) {
      (closeButtonRef.value ?? dialogRef.value)?.focus();
    }
  });
}

function clear() {
  const count = upcomingCount.value;
  if (count <= 0) return;
  const keepsCurrent =
    player.index >= 0 && player.index < player.queue.length;
  const message =
    `清空待播的 ${count} 首歌曲？` +
    (keepsCurrent ? "当前歌曲会继续播放，" : "") +
    "清空后可以用一次撤销恢复。";
  if (!window.confirm(message)) return;
  const removed = keepsCurrent
    ? player.queue.slice(player.index + 1)
    : [...player.queue];
  const previous = {
    queue: [...player.queue],
    index: player.index,
  };
  player.clearQueue();
  if (removed.length > 0) {
    undoEntry.value = {
      kind: "clear",
      queue: previous.queue,
      index: previous.index,
      removedCount: removed.length,
    };
  }
}

function playAll() {
  const songs = [...player.queue.slice(baseIndex.value)];
  if (songs.length === 0) return;
  const previous = {
    queue: [...player.queue],
    index: player.index,
  };
  void player.playList(songs, 0);
  recordRestartUndo(previous);
}

/** 「从这首歌开始」会丢弃当前曲之前的队列条目：同样给一次可撤销的重建。 */
function recordRestartUndo(previous: { queue: Song[]; index: number }) {
  const dropped = previous.index > 0;
  if (!dropped) return;
  undoEntry.value = {
    kind: "restart",
    queue: previous.queue,
    index: previous.index,
  };
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
  const insideAllowedRoot = allowedFocusRoots().some(
    (root) => root.contains(active),
  );
  if (!insideAllowedRoot) {
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

/**
 * 抽屉声明播放条仍可交互，因此键盘焦点圈也必须把播放条视为允许区域；
 * 否则 `keepInteractive` 只对鼠标生效，音量、音质与播放键会被 Tab 绕过。
 */
function allowedFocusRoots(): HTMLElement[] {
  const roots: HTMLElement[] = [];
  if (dialogRef.value) roots.push(dialogRef.value);
  const playerBar = document.querySelector<HTMLElement>(
    "#nnplayer-player-bar",
  );
  if (playerBar) roots.push(playerBar);
  // Tab 圈必须按文档顺序首尾相接。播放条在 #app 内，Teleport 的抽屉在其后；
  // 若仍按“抽屉、播放条”返回，从播放条首个控件 Shift+Tab 会落到 body。
  return roots.sort((left, right) => {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function getFocusableElements(): HTMLElement[] {
  return allowedFocusRoots().flatMap((root) =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null),
  );
}

watch(
  open,
  async (v) => {
    document.body.classList.toggle("queue-drawer-open", v);
    if (v) {
      // 清掉上一次打开时的播报，避免重开抽屉时 live region 带着旧文案。
      reorderAnnouncement.value = "";
      lastActiveElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      document.addEventListener("keydown", onGlobalKeydown);
      await nextTick();
      (closeButtonRef.value ?? dialogRef.value)?.focus();
    } else {
      document.removeEventListener("keydown", onGlobalKeydown);
      reorderAnnouncement.value = "";
      const target = lastActiveElement;
      lastActiveElement = null;
      target?.focus();
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onGlobalKeydown);
  document.body.classList.remove("queue-drawer-open");
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
        class="queue-scrim fixed inset-x-0 top-0 bg-black/20 z-40"
        @click="open = false"
      />
    </Transition>

    <Transition name="queue-slide">
      <aside
        v-if="open"
        ref="dialogRef"
        class="queue-drawer glass fixed top-4 right-4 w-[380px] max-w-[calc(100vw-32px)] z-50 flex flex-col overflow-hidden"
        role="dialog"
        aria-label="播放队列"
        tabindex="-1"
      >
        <header class="flex items-center justify-between px-5 py-4">
          <h2 class="text-base font-semibold text-text-primary">播放队列</h2>
          <button
            ref="closeButtonRef"
            type="button"
            class="queue-icon-button w-9 h-9 rounded-md bg-transparent text-text-secondary hover:bg-surface-soft hover:text-text-primary flex items-center justify-center transition-all duration-200 active:scale-95"
            aria-label="关闭队列"
            @click="open = false"
          >
            <X :size="18" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </header>

        <!-- 重排播报：键盘 Alt+↑/↓、行内上移/下移与拖拽都写入这个 polite region。 -->
        <p
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ reorderAnnouncement }}
        </p>

        <div
          v-if="remainingCount > 0"
          class="px-5 py-3 text-xs text-text-secondary flex gap-4 tabular-nums"
        >
          <span>剩余 {{ remainingCount }} 首</span>
          <span>剩余时长 {{ totalDuration }}</span>
        </div>

        <div
          v-if="remainingCount === 0"
          class="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3 px-8 text-center"
        >
          <Music2 :size="40" :stroke-width="1.25" aria-hidden="true" />
          <span>在任意列表里播放一首歌，队列会显示在这里</span>
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
            draggable="true"
            @dragstart="onDragStart($event, item.absIndex)"
            @dragover="onDragOver"
            @drop="onDrop($event, item.absIndex)"
          >
            <!-- 整行播放按钮铺满行内区域，单击 / Enter / Space 播放；删除按钮是
                 与它并列的兄弟控件，不再是嵌套在可聚焦行里的 button。
                 Alt+↑/↓ 提供与拖拽等价的键盘排序路径。 -->
            <button
              type="button"
              class="queue-row-play absolute inset-0 z-10 cursor-pointer rounded-md border-0 bg-transparent p-0"
              draggable="true"
              :data-queue-index="item.absIndex"
              data-queue-play
              :aria-label="rowLabel(item.song)"
              :aria-keyshortcuts="'Alt+ArrowUp Alt+ArrowDown'"
              :aria-current="isCurrent(item.absIndex) ? 'true' : undefined"
              @click="playRow(item.absIndex)"
              @keydown="onRowKeydown($event, item.absIndex)"
            />
            <span
              class="text-text-tertiary text-xs w-5 tabular-nums text-right font-medium shrink-0"
              aria-hidden="true"
            >
              <Play
                v-if="isCurrent(item.absIndex)"
                :size="12"
                :stroke-width="1.75"
                class="text-accent mx-auto"
                :class="{ 'animate-pulse-fade': player.audioState.playing }"
              />
              <!-- 绝对队列位次（从 1 开始）：与「剩余 N 首 / 从这首歌开始」同一套
                   心智模型。此前用相对序号，第二首（当前曲之后的第一首）会显示 1。 -->
              <span v-else>{{ item.absIndex + 1 }}</span>
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
            <!-- 行尾：未悬停时显示时长 / 当前状态；悬停或行内有焦点时，
                 同一块区域换成常驻的上移、下移、移除三个 24×24 控件（不挤占标题）。
                 没有 hover 的设备（触摸/笔）直接常显这三个控件。 -->
            <div class="queue-row-tail shrink-0">
              <span v-if="isCurrent(item.absIndex)" class="queue-current-badge">
                {{ currentStatusLabel() }}
              </span>
              <span v-else class="queue-row-meta text-xs text-text-tertiary tabular-nums font-medium">
                {{ fmtDurationMs(item.song.duration) }}
              </span>
              <div class="queue-row-actions">
                <button
                  type="button"
                  class="queue-row-action queue-move"
                  :data-queue-index="item.absIndex"
                  data-queue-move="up"
                  :disabled="!canMove(item.absIndex, -1)"
                  :aria-label="`上移 ${item.song.name}`"
                  title="上移"
                  @click.stop="moveItem(item.absIndex, -1, 'up')"
                >
                  <ChevronUp :size="14" :stroke-width="1.75" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="queue-row-action queue-move"
                  :data-queue-index="item.absIndex"
                  data-queue-move="down"
                  :disabled="!canMove(item.absIndex, 1)"
                  :aria-label="`下移 ${item.song.name}`"
                  title="下移"
                  @click.stop="moveItem(item.absIndex, 1, 'down')"
                >
                  <ChevronDown :size="14" :stroke-width="1.75" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="queue-row-action queue-remove"
                  :aria-label="`从队列移除 ${item.song.name}`"
                  @click.stop="remove(item.absIndex)"
                >
                  <X :size="14" :stroke-width="1.75" aria-hidden="true" />
                </button>
              </div>
            </div>
          </li>
          <li
            v-if="hiddenCount > 0"
            class="px-5 py-2 text-xs text-text-tertiary"
          >
            队列较长：先显示 {{ displayItems.length }} 首，其余 {{ hiddenCount }} 首会在播放到附近时继续显示
          </li>
          <li
            v-else-if="upcomingCount === 0 && remainingCount > 0"
            class="px-5 py-2 text-xs text-text-tertiary"
          >
            没有更多待播歌曲
          </li>
        </ul>

        <!-- 撤销条：删除后的可逆入口，必须留在抽屉内部（全局状态条会被遮罩
             与抽屉挡在下面，恰好在该看见它的时候看不见）。 -->
        <div
          v-if="undoEntry"
          class="queue-undo"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="queue-undo__text truncate">
            {{ undoText }}
          </span>
          <button
            type="button"
            class="queue-undo__action"
            @click="undoLastAction"
          >
            撤销
          </button>
          <button
            type="button"
            class="queue-icon-button queue-undo__close"
            aria-label="关闭撤销提示"
            title="关闭撤销提示"
            @click="undoEntry = null"
          >
            <X :size="14" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>

        <footer
          v-if="remainingCount > 0 && (displayItems.length > 1 || upcomingCount > 0)"
          class="px-5 py-3 flex gap-2"
        >
          <button
            v-if="displayItems.length > 1"
            type="button"
            class="btn btn-ghost queue-footer-button text-xs"
            @click="playAll"
          >
            <Play :size="14" :stroke-width="1.75" class="mr-1" aria-hidden="true" />
            <!-- 以当前曲（含）为起点重建/截断队列，不再用容易被读成“继续播放”的「从当前播放」。 -->
            {{ player.index >= 0 ? "从这首歌开始" : "播放全部" }}
          </button>
          <button
            v-if="upcomingCount > 0"
            type="button"
            class="btn btn-ghost queue-footer-button text-xs text-text-tertiary hover:text-accent-on-subtle ml-auto"
            @click="clear"
          >
            <Trash :size="14" :stroke-width="1.75" class="mr-1" aria-hidden="true" />清空待播
          </button>
        </footer>

        <!-- 抽屉位于全局状态条上方。这里投影同一份播放失败状态，避免焦点
             陷阱把用户真正需要的“停止/重试”挡在抽屉背景里。 -->
        <section
          v-if="playbackFailure && describedPlaybackFailure"
          class="queue-risk"
          :role="playbackFailure.autoRetry ? 'status' : 'alert'"
          :aria-live="playbackFailure.autoRetry ? 'polite' : 'assertive'"
          aria-atomic="true"
        >
          <RefreshCw
            :size="14"
            :stroke-width="1.75"
            class="queue-risk__icon"
            aria-hidden="true"
          />
          <div class="queue-risk__body">
            <p class="queue-risk__title">
              {{ describedPlaybackFailure.title }}
            </p>
            <p class="queue-risk__hint">
              {{ describedPlaybackFailure.hint }}
            </p>
          </div>
          <div class="queue-risk__actions">
            <button
              v-if="playbackFailure.autoRetry"
              type="button"
              class="queue-risk__action"
              @click="player.cancelAutoRetry()"
            >
              停止
            </button>
            <button
              v-else-if="describedPlaybackFailure.retryable"
              type="button"
              class="queue-risk__action"
              @click="retryPlaybackFailure"
            >
              重试
            </button>
            <button
              type="button"
              class="queue-icon-button queue-risk__close"
              :aria-label="playbackDismissLabel"
              :title="playbackDismissLabel"
              @click="player.dismissPlaybackFailure()"
            >
              <X :size="14" :stroke-width="1.75" aria-hidden="true" />
            </button>
          </div>
        </section>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 抽屉与遮罩都让开底部播放条：桌面 76px 播放条 + 12px 底距 + 8px 间隙 = 96px，
   窄窗 74px 播放条（#9 新几何）+ 8px 底距 + 8px 间隙 = 90px。这样抽屉不再盖住
   播放条右侧的音质入口/音量/总时长，遮罩之外的播放条也保持可见、可点。
   脚本里的 useBackgroundInert(keepInteractive: #nnplayer-player-bar) 与这条
   几何约定配套：播放条既不压暗、不被遮罩拦截，也不进入 inert 子树。 */
.queue-scrim,
.queue-drawer {
  --queue-bottom-inset: 96px;
}

.queue-scrim {
  /* 遮罩止于播放条顶缘（内缩值比抽屉少 8px 的间隙），播放条那一带既不被压暗、
     也不被遮罩拦截点击，音质入口/音量/总时长在抽屉打开时仍可直接操作。 */
  bottom: calc(var(--queue-bottom-inset) - 8px);
}

.queue-drawer {
  bottom: var(--queue-bottom-inset);
  max-height: calc(100vh - 16px - var(--queue-bottom-inset));
}

@media (max-width: 768px) {
  .queue-scrim,
  .queue-drawer {
    /* 74px 播放条 + 8px 底距 + 8px 间隙；与 App.vue 的 --player-reserved-space 保持同步。 */
    --queue-bottom-inset: 90px;
  }
}

/* 整行播放按钮铺满行内区域，焦点即整行轮廓；行本身不再是可聚焦元素。 */
.queue-row-play {
  outline: none;
}

.queue-row-play:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* 行尾固定 76px：三个 24px 行内控件正好占满，标题列宽度不随悬停变化。
   未悬停时显示时长/状态；hover 或行内焦点时在同一区域换成排序与删除控件，
   不产生布局跳动。没有 hover 的设备直接常显控件（不能靠悬停才能发现删除）。 */
.queue-row-tail {
  position: relative;
  z-index: 20;
  display: flex;
  flex: 0 0 76px;
  width: 76px;
  align-items: center;
  justify-content: flex-end;
  /* 控件默认隐藏时，这块区域的点击仍要落到整行播放按钮上。 */
  pointer-events: none;
}

.queue-row-meta,
.queue-current-badge {
  transition: opacity 0.15s ease;
}

.queue-row-actions {
  position: absolute;
  top: 50%;
  right: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 0.15s ease;
}

@media (hover: hover) {
  .queue-row:hover .queue-row-meta,
  .queue-row:focus-within .queue-row-meta,
  .queue-row:hover .queue-current-badge,
  .queue-row:focus-within .queue-current-badge {
    opacity: 0;
  }

  .queue-row:hover .queue-row-actions,
  .queue-row:focus-within .queue-row-actions {
    opacity: 1;
    pointer-events: auto;
  }
}

/* 触摸/笔：没有悬停这一前置动作，行内控件必须常显且可命中。 */
@media (hover: none) {
  .queue-row-meta,
  .queue-current-badge {
    display: none;
  }

  .queue-row-actions {
    opacity: 1;
    pointer-events: auto;
  }
}

/* 行内控件统一 24×24（≥ WCAG 2.5.8 最小值），触屏上避免双击缩放延迟。 */
.queue-row-action {
  display: flex;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.queue-row-action:hover:not(:disabled) {
  color: var(--color-accent-on-subtle);
  background: var(--color-surface-soft);
}

.queue-row-action:disabled {
  cursor: default;
  opacity: 0.3;
}

.queue-row-action:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
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

/* 抽屉内播放恢复：与撤销条同为安静纸面，但把原因、下一步和动作放在同一视线内。 */
.queue-risk {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 20px 6px;
  padding: 8px 8px 8px 10px;
  border-radius: 6px;
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
}

.queue-risk__icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--color-accent-on-subtle);
}

.queue-risk__body {
  min-width: 0;
  flex: 1;
}

.queue-risk__title,
.queue-risk__hint {
  margin: 0;
  overflow-wrap: anywhere;
}

.queue-risk__title {
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
}

.queue-risk__hint {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.45;
}

.queue-risk__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.queue-risk__action {
  min-height: 24px;
  padding: 2px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-accent-on-subtle);
  font-size: 12px;
  font-weight: 600;
}

.queue-risk__action:hover {
  background: var(--color-accent-subtle);
}

.queue-risk__close {
  width: 24px;
  height: 24px;
}

.queue-risk__action:focus-visible,
.queue-risk__close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* 撤销条：抽屉底部的一条安静纸面（ink-whisper），不抢行内容，也不遮播放条。 */
.queue-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 4px;
  padding: 6px 8px 6px 12px;
  border-radius: 6px;
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.queue-undo__text {
  min-width: 0;
  flex: 1;
}

.queue-undo__action {
  flex: 0 0 auto;
  min-height: 24px;
  padding: 2px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-accent-on-subtle);
  font-size: 12px;
  font-weight: 600;
  transition: background-color 160ms ease;
}

.queue-undo__action:hover {
  background: var(--color-accent-subtle);
}

.queue-undo__close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  /* WCAG 2.5.8：可见的是 14px 图标，命中区必须 ≥24×24（与抽屉内其它图标按钮一致）。 */
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
}

.queue-undo__close:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-strong, var(--color-card-hover));
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
