<script setup lang="ts">
// 播放队列右侧抽屉。
// 380px 宽,Teleport 到 body,Transition 滑入。
// 列表用原生 HTML5 拖拽排序。

import { computed, ref, watch } from "vue";
import { Play, X } from "lucide-vue-next";
import { usePlayerStore } from "@/stores/player";

const open = ref(false);
const player = usePlayerStore();

const list = computed(() => player.getNextUp(100));

const totalDuration = computed(() => {
  const ms = list.value.reduce((sum, s) => sum + (s.duration ?? 0), 0);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
});

const totalCount = computed(() => list.value.length);

// 拖拽：dataTransfer 存绝对索引
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
  // 越界保护
  if (from < 0 || from >= player.queue.length) return;
  if (targetAbsIdx < 0 || targetAbsIdx > player.queue.length) return;
  player.reorderQueue(from, targetAbsIdx);
}

function remove(absIdx: number) {
  player.removeFromQueue(absIdx);
}

function clear() {
  if (window.confirm("清空播放队列？")) {
    player.clearQueue();
  }
}

function playAll() {
  // 重新从头播放队列中所有"下一首"
  const songs = [...list.value];
  if (songs.length === 0) return;
  void player.playList([player.currentSong!, ...songs].filter(Boolean) as never[], 0);
}

function fmt(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "00:00";
  const total = Math.floor(durationMs / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function onEsc(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    e.preventDefault();
    open.value = false;
  }
}

watch(open, (v) => {
  if (v) {
    document.addEventListener("keydown", onEsc);
  } else {
    document.removeEventListener("keydown", onEsc);
  }
});

defineExpose({
  open: () => (open.value = true),
  close: () => (open.value = false),
});
</script>

<template>
  <Teleport to="body">
    <!-- 背景遮罩 -->
    <Transition name="queue-fade">
      <div
        v-if="open"
        class="fixed inset-0 bg-black/30 z-40"
        @click="open = false"
      />
    </Transition>

    <!-- 抽屉本体 -->
    <Transition name="queue-slide">
      <aside
        v-if="open"
        class="fixed top-0 right-0 bottom-0 w-[380px] max-w-[calc(100vw-16px)] bg-card z-50 shadow-2xl flex flex-col"
        role="dialog"
        aria-label="播放队列"
      >
        <header
          class="flex items-center justify-between px-5 py-4 border-b border-hover"
        >
          <h2 class="text-base font-semibold">播放队列</h2>
          <button
            type="button"
            class="btn btn-ghost p-1"
            aria-label="关闭队列"
            @click="open = false"
          >
            <X :size="16" :stroke-width="1.75" />
          </button>
        </header>

        <div class="px-5 py-3 text-xs text-text-secondary flex gap-4 border-b border-hover">
          <span>{{ totalCount }} 首</span>
          <span>总时长 {{ totalDuration }}</span>
        </div>

        <div
          v-if="totalCount === 0"
          class="flex-1 flex items-center justify-center text-text-secondary text-sm"
        >
          队列为空，去歌单里加几首歌吧
        </div>

        <ul v-else class="flex-1 overflow-y-auto py-1">
          <li
            v-for="(song, i) in list"
            :key="song.id"
            class="group flex items-center gap-3 px-5 py-2 hover:bg-hover cursor-grab active:cursor-grabbing"
            draggable="true"
            @dragstart="onDragStart($event, player.index + 1 + i)"
            @dragover="onDragOver"
            @drop="onDrop($event, player.index + 1 + i)"
          >
            <span class="text-text-secondary text-xs w-5 tabular-nums text-right">
              {{ i + 1 }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate">{{ song.name }}</div>
              <div class="text-xs text-text-secondary truncate">
                {{ song.artists }} · {{ song.album }}
              </div>
            </div>
            <span class="text-xs text-text-secondary tabular-nums">
              {{ fmt(song.duration) }}
            </span>
            <button
              type="button"
              class="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-accent transition-opacity"
              :aria-label="`从队列移除 ${song.name}`"
              @click.stop="remove(player.index + 1 + i)"
            >
              <X :size="14" :stroke-width="1.75" />
            </button>
          </li>
        </ul>

        <footer
          v-if="totalCount > 0"
          class="px-5 py-3 border-t border-hover flex gap-2"
        >
          <button
            type="button"
            class="btn btn-ghost text-xs"
            @click="playAll"
          >
            <Play :size="14" :stroke-width="1.75" class="mr-1" />播放全部
          </button>
          <button
            type="button"
            class="btn btn-ghost text-xs text-text-secondary hover:text-accent ml-auto"
            @click="clear"
          >
            清空队列
          </button>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
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
  transform: translateX(100%);
}
</style>
