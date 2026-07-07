<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  ListMusic,
  Music2,
  Pin,
  Search,
  Sparkles,
} from "lucide-vue-next";

import { searchSuggest } from "@/composables/useNcmApi";
import type { SearchSuggestion } from "@/types/music";
import { useUserStore } from "@/stores/user";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import QueueDrawer from "@/components/QueueDrawer.vue";

const router = useRouter();
const userStore = useUserStore();
const desktopLyricsStore = useDesktopLyricsStore();

const STORAGE_KEY = "nnplayer.sidebarCollapsed";

const collapsed = ref(
  typeof window !== "undefined" &&
    localStorage.getItem(STORAGE_KEY) === "1",
);

const menu = [
  { to: "/daily", label: "每日推荐", icon: Sparkles },
  { to: "/playlists", label: "我的歌单", icon: Folder },
] as const;

const itemRefs = ref<HTMLElement[]>([]);
const indicatorTop = ref(0);
const activeIdx = ref(0);

function setItemRef(el: unknown, idx: number) {
  const target =
    (el as { $el?: Element } | null)?.$el ?? (el as Element | null);
  if (target instanceof HTMLElement) {
    itemRefs.value[idx] = target;
  }
}

function updateIndicator() {
  const el = itemRefs.value[activeIdx.value];
  if (el) {
    indicatorTop.value = el.offsetTop;
  }
}

const keyword = ref("");
const suggestions = ref<SearchSuggestion[]>([]);
const showSuggest = ref(false);
const highlightIndex = ref(-1);
let debounceTimer: number | undefined;
let inFlightSeq = 0;

const searchBoxRef = ref<HTMLElement | null>(null);
const searchExpand = ref(false);

function goSearch(kw?: string) {
  const q = (kw ?? keyword.value).trim();
  if (!q) return;
  hideSuggest();
  searchExpand.value = false;
  router.push({ name: "Search", query: { q } });
}

function hideSuggest() {
  showSuggest.value = false;
  highlightIndex.value = -1;
}

async function fetchSuggest() {
  const q = keyword.value.trim();
  if (!q) {
    suggestions.value = [];
    showSuggest.value = false;
    return;
  }
  const seq = ++inFlightSeq;
  try {
    const res = await searchSuggest(q);
    if (seq !== inFlightSeq) return;
    suggestions.value = res;
    showSuggest.value = true;
    highlightIndex.value = res.length > 0 ? 0 : -1;
  } catch {
    if (seq !== inFlightSeq) return;
    suggestions.value = [];
    showSuggest.value = false;
  }
}

function onInput() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(fetchSuggest, 300);
}

function onEnter() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  if (
    showSuggest.value &&
    highlightIndex.value >= 0 &&
    highlightIndex.value < suggestions.value.length
  ) {
    const cur = suggestions.value[highlightIndex.value];
    goSearch(cur.keyword || keyword.value);
  } else {
    goSearch();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!showSuggest.value || suggestions.value.length === 0) {
    if (e.key === "Escape") hideSuggest();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightIndex.value =
      (highlightIndex.value + 1) % suggestions.value.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightIndex.value =
      (highlightIndex.value - 1 + suggestions.value.length) %
      suggestions.value.length;
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideSuggest();
  }
}

function onDocClick(e: MouseEvent) {
  if (!showSuggest.value) return;
  if (!searchBoxRef.value) return;
  if (!searchBoxRef.value.contains(e.target as Node)) {
    hideSuggest();
  }
}

function onSuggestionClick(idx: number) {
  const s = suggestions.value[idx];
  if (s.song) {
    goSearch(s.keyword || s.song.name);
  } else {
    goSearch(s.keyword);
  }
}

function logout() {
  userStore.logout().then(() => router.replace("/login"));
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(STORAGE_KEY, collapsed.value ? "1" : "0");
  void nextTick(updateIndicator);
}

const queueDrawerRef = ref<InstanceType<typeof QueueDrawer> | null>(null);
function openQueue() {
  queueDrawerRef.value?.open();
}
async function openDesktopLyrics() {
  try {
    await desktopLyricsStore.toggleWindow();
  } catch (e) {
    console.warn("[desktop-lyrics] 打开失败", e);
  }
}

watch(
  () => router.currentRoute.value.path,
  (path) => {
    const idx = menu.findIndex((m) => m.to === path);
    if (idx >= 0) {
      activeIdx.value = idx;
    }
    void nextTick(updateIndicator);
    hideSuggest();
  },
  { immediate: true },
);

onMounted(() => {
  document.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  if (debounceTimer) window.clearTimeout(debounceTimer);
});
</script>

<template>
  <aside
    :class="[
      'h-full flex flex-col transition-[width,padding] duration-220 ease-out overflow-hidden',
      'bg-[rgba(18,18,20,0.85)] backdrop-blur-2xl border-r border-border',
      collapsed ? 'w-16 px-2' : 'w-60 px-4',
    ]"
  >
    <!-- Logo + 折叠按钮 -->
    <div
      :class="[
        'flex items-center mb-5 shrink-0',
        collapsed ? 'justify-center' : 'justify-between px-1',
      ]"
    >
      <div
        v-if="!collapsed"
        class="flex items-center gap-2"
      >
        <Music2
          :size="22"
          :stroke-width="1.75"
          class="text-accent shrink-0"
        />
        <span class="text-base font-semibold text-[rgba(255,255,255,0.9)]">nnplayer</span>
      </div>
      <Music2
        v-else
        :size="22"
        :stroke-width="1.75"
        class="text-accent"
      />
      <button
        v-if="!collapsed"
        type="button"
        class="text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.7)] transition-colors p-1"
        :aria-label="'折叠侧栏'"
        title="折叠侧栏"
        @click="toggleCollapsed"
      >
        <ChevronLeft :size="18" :stroke-width="1.75" />
      </button>
    </div>

    <!-- 搜索区 -->
    <div
      v-if="!collapsed"
      ref="searchBoxRef"
      class="mb-4 relative shrink-0"
    >
      <form @submit.prevent="onEnter">
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索歌曲"
          class="input"
          autocomplete="off"
          @input="onInput"
          @keydown="onKeydown"
          @focus="fetchSuggest"
        />
      </form>
      <div
        v-if="showSuggest && suggestions.length > 0"
        class="absolute left-0 right-0 top-full mt-1 z-30 bg-card border border-border-strong rounded-xl shadow-theme max-h-80 overflow-y-auto py-1 backdrop-blur-2xl"
      >
        <div
          v-for="(s, idx) in suggestions"
          :key="`${s.keyword}-${s.song?.id ?? idx}`"
          class="px-3 py-2 cursor-pointer flex items-center gap-2 text-sm transition-colors"
          :class="
            highlightIndex === idx
              ? 'bg-accent-subtle text-accent'
              : 'text-text-secondary hover:bg-card-hover'
          "
          @mouseenter="highlightIndex = idx"
          @click="onSuggestionClick(idx)"
        >
          <Search
            :size="14"
            :stroke-width="1.75"
            class="text-[rgba(255,255,255,0.3)] shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate">
              {{ s.keyword || s.song?.name || "—" }}
            </div>
            <div
              v-if="s.song"
              class="text-[11px] text-[rgba(255,255,255,0.35)] truncate"
            >
              {{ s.song.artists }} · {{ s.song.album }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="mb-3 flex justify-center shrink-0">
      <button
        type="button"
        class="w-10 h-10 rounded-xl bg-card-hover text-text-tertiary hover:text-accent hover:bg-accent-subtle flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
        :aria-label="'打开搜索'"
        title="打开搜索"
        @click="searchExpand = true"
      >
        <Search :size="18" :stroke-width="1.75" />
      </button>
    </div>

    <!-- 折叠态展开搜索弹层 -->
    <Teleport to="body">
      <Transition name="search-fade">
        <div
          v-if="searchExpand && collapsed"
          class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
          @click.self="searchExpand = false"
        >
          <div class="bg-card border border-border-strong rounded-2xl p-4 w-full max-w-md shadow-theme">
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索歌曲"
              class="input mb-3"
              autocomplete="off"
              @input="onInput"
              @keydown="onKeydown"
              @keydown.enter="onEnter"
              @keydown.esc="searchExpand = false"
            />
            <div
              v-if="showSuggest && suggestions.length > 0"
              class="max-h-72 overflow-y-auto"
            >
              <div
                v-for="(s, idx) in suggestions"
                :key="`${s.keyword}-${s.song?.id ?? idx}`"
                class="px-3 py-2 cursor-pointer rounded-btn flex items-center gap-2 text-sm"
                :class="
                  highlightIndex === idx
                    ? 'bg-[rgba(232,93,58,0.12)] text-accent'
                    : 'hover:bg-card-hover'
                "
                @mouseenter="highlightIndex = idx"
                @click="onSuggestionClick(idx)"
              >
                <Search
                  :size="14"
                  :stroke-width="1.75"
                  class="text-[rgba(255,255,255,0.3)] shrink-0"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate">
                    {{ s.keyword || s.song?.name || "—" }}
                  </div>
                  <div
                    v-if="s.song"
                    class="text-[11px] text-[rgba(255,255,255,0.35)] truncate"
                  >
                    {{ s.song.artists }} · {{ s.song.album }}
                  </div>
                </div>
              </div>
            </div>
            <div class="flex justify-end mt-2">
              <button
                type="button"
                class="btn btn-ghost text-xs"
                @click="searchExpand = false"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 导航菜单 + 指示器 -->
    <nav class="relative flex-1 mt-2">
      <div
        class="absolute left-0 w-0.5 h-12 bg-accent rounded-r transition-all duration-220 ease-out pointer-events-none shadow-[0_0_12px_var(--color-glow)]"
        :style="{ top: indicatorTop + 'px' }"
      />
      <RouterLink
        v-for="(item, idx) in menu"
        :key="item.to"
        :to="item.to"
        :ref="(el) => setItemRef(el, idx)"
        :class="[
          'flex items-center h-12 rounded-xl text-sm transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
          collapsed ? 'justify-center px-2' : 'px-4 gap-3',
          'text-text-secondary hover:text-text-primary hover:bg-card-hover',
        ]"
        active-class="!text-accent !bg-gradient-to-r !from-accent/[0.12] !to-transparent font-medium"
        :title="collapsed ? item.label : undefined"
      >
        <component
          :is="item.icon"
          :size="18"
          :stroke-width="1.75"
          class="w-5 shrink-0"
        />
        <span v-if="!collapsed">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- 底部按钮区 -->
    <div
      :class="[
        'mt-auto pt-4 border-t border-border flex flex-col gap-1 shrink-0',
        collapsed ? 'px-0' : 'px-1',
      ]"
    >
      <button
        type="button"
        :class="[
          'flex items-center h-10 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
          collapsed ? 'justify-center px-2' : 'px-3 gap-2',
        ]"
        title="播放队列"
        :aria-label="'播放队列'"
        @click="openQueue"
      >
        <ListMusic :size="16" :stroke-width="1.75" class="shrink-0" />
        <span v-if="!collapsed">播放队列</span>
      </button>
      <button
        type="button"
        :class="[
          'flex items-center h-10 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
          collapsed ? 'justify-center px-2' : 'px-3 gap-2',
        ]"
        title="桌面歌词"
        :aria-label="'桌面歌词'"
        @click="openDesktopLyrics"
      >
        <Pin :size="16" :stroke-width="1.75" class="shrink-0" />
        <span v-if="!collapsed">桌面歌词</span>
      </button>
      <button
        v-if="collapsed"
        type="button"
        class="flex items-center justify-center h-10 rounded-xl text-sm text-text-tertiary hover:text-accent hover:bg-accent-subtle transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
        title="展开侧栏"
        aria-label="展开侧栏"
        @click="toggleCollapsed"
      >
        <ChevronRight :size="18" :stroke-width="1.75" />
      </button>
    </div>

    <!-- 用户信息 -->
    <div
      v-if="!collapsed"
      class="px-1 pt-2 flex items-center gap-2 text-xs"
    >
      <img
        v-if="userStore.avatarUrl"
        :src="userStore.avatarUrl"
        :alt="userStore.displayName"
        class="w-8 h-8 rounded-full bg-card-hover object-cover shrink-0 ring-1 ring-border-strong"
          @error="userStore.clearAvatar()"
      />
      <div
        v-else
        class="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs shrink-0"
      >
        {{ userStore.displayName.charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="mb-0.5 truncate text-[rgba(255,255,255,0.45)]">
          {{ userStore.displayName }}
        </div>
        <button
          v-if="userStore.loggedIn"
          class="text-[rgba(255,255,255,0.35)] hover:text-accent transition-colors"
          @click="logout"
        >
          退出登录
        </button>
      </div>
    </div>

    <div
      v-else
      class="pt-3 flex justify-center shrink-0"
    >
      <img
        v-if="userStore.avatarUrl"
        :src="userStore.avatarUrl"
        :alt="userStore.displayName"
        class="w-9 h-9 rounded-full bg-card-hover object-cover ring-1 ring-border-strong"
        :title="userStore.displayName"
          @error="userStore.clearAvatar()"
      />
      <div
        v-else
        class="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm"
        :title="userStore.displayName"
      >
        {{ userStore.displayName.charAt(0).toUpperCase() }}
      </div>
    </div>

    <QueueDrawer ref="queueDrawerRef" />
  </aside>
</template>

<style scoped>
.search-fade-enter-active,
.search-fade-leave-active {
  transition: opacity 0.18s ease;
}
.search-fade-enter-from,
.search-fade-leave-to {
  opacity: 0;
}
</style>
