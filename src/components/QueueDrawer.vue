<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Music2, Play, Trash2, X } from "lucide-vue-next";
import { usePlayerStore } from "@/stores/player";
import { coverImageUrl } from "@/utils/coverImage";
import { fmtDurationMs } from "@/utils/format";

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
}

function clear() {
  if (window.confirm("清空下一首列表？")) {
    player.clearQueue();
  }
}

function playAll() {
  const songs = [...list.value];
  if (songs.length === 0) return;
  const allSongs = player.currentSong
    ? [player.currentSong, ...songs]
    : songs;
  void player.playList(allSongs, 0);
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

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onEsc);
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
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        @click="open = false"
      />
    </Transition>

    <Transition name="queue-slide">
      <aside
        v-if="open"
        class="fixed top-0 right-0 bottom-0 w-[380px] max-w-[calc(100vw-16px)] bg-glass backdrop-blur-2xl border-l border-border z-50 shadow-2xl flex flex-col"
        role="dialog"
        aria-label="播放队列"
      >
        <header
          class="flex items-center justify-between px-5 py-4 border-b border-border"
        >
          <h2 class="text-base font-semibold text-text-primary">播放队列</h2>
          <button
            type="button"
            class="w-8 h-8 rounded-full bg-surface-soft hover:bg-surface-strong flex items-center justify-center transition-all duration-200 active:scale-95"
            aria-label="关闭队列"
            @click="open = false"
          >
            <X :size="14" :stroke-width="1.5" class="text-text-secondary" />
          </button>
        </header>

        <div class="px-5 py-3 text-xs text-text-secondary flex gap-4 border-b border-border">
          <span>{{ totalCount }} 首</span>
          <span>总时长 {{ totalDuration }}</span>
        </div>

        <div
          v-if="totalCount === 0"
          class="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3"
        >
          <Music2 :size="40" :stroke-width="1.25" />
          <span>队列为空，去歌单里加几首歌吧</span>
        </div>

        <ul v-else class="flex-1 overflow-y-auto py-1">
          <li
            v-for="(song, i) in list"
            :key="song.id"
            class="group flex items-center gap-3 px-5 py-2.5 hover:bg-surface-soft cursor-grab active:cursor-grabbing transition-colors duration-150 text-text-primary relative"
            draggable="true"
            @dragstart="onDragStart($event, player.index + 1 + i)"
            @dragover="onDragOver"
            @drop="onDrop($event, player.index + 1 + i)"
          >
            <span class="text-text-tertiary text-xs w-5 tabular-nums text-right font-medium">
              {{ i + 1 }}
            </span>
            <div class="w-9 h-9 overflow-hidden shrink-0 ring-1 ring-ring relative">
              <img
                v-if="song.picUrl"
                :src="coverImageUrl(song.picUrl, 36)"
                class="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
                alt=""
              />
              <div v-else class="w-full h-full bg-surface-soft flex items-center justify-center">
                <Music2 :size="14" :stroke-width="1.25" class="text-text-tertiary" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate text-text-primary">{{ song.name }}</div>
              <div class="text-xs text-text-secondary truncate">
                {{ song.artists }}
              </div>
            </div>
            <span class="text-xs text-text-tertiary tabular-nums font-medium">
              {{ fmtDurationMs(song.duration) }}
            </span>
            <button
              type="button"
              class="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-accent transition-all duration-200"
              :aria-label="`从队列移除 ${song.name}`"
              @click.stop="remove(player.index + 1 + i)"
            >
              <X :size="14" :stroke-width="1.5" />
            </button>
          </li>
        </ul>

        <footer
          v-if="totalCount > 0"
          class="px-5 py-3 border-t border-border flex gap-2"
        >
          <button
            type="button"
            class="btn btn-ghost text-xs rounded-xl"
            @click="playAll"
          >
            <Play :size="14" :stroke-width="1.5" class="mr-1" />播放全部
          </button>
          <button
            type="button"
            class="btn btn-ghost text-xs text-text-tertiary hover:text-accent rounded-xl ml-auto"
            @click="clear"
          >
            <Trash2 :size="14" :stroke-width="1.5" class="mr-1" />清空
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
