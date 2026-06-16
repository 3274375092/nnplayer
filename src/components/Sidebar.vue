<script setup lang="ts">
// 左侧导航栏：Logo + 搜索框（含建议下拉浮层）+ 路由菜单 + 队列/桌面歌词/折叠按钮 + 用户/退出。
//
// 阶段4 改造：
//   1. 可折叠：64px ↔ 240px,状态持久化到 localStorage
//   2. 路由指示器：左侧 1px 宽 accent 高亮条,top 跟随激活菜单项 offsetTop 平滑滑动
//   3. 搜索框在折叠态简化为图标按钮
//   4. 底部新增：📋 播放队列（调 QueueDrawer）+ 📌 桌面歌词（调 desktopLyricsStore.toggleWindow）
//
// 搜索建议实现要点（与阶段1 一致）：
//   1. 300ms 防抖调用 search_suggest
//   2. 点击外部 / Esc 关闭浮层
//   3. ↑ / ↓ 键盘选择，回车跳转搜索

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

// 路由指示器 top（绑定到激活菜单项的 offsetTop）
const itemRefs = ref<HTMLElement[]>([]);
const indicatorTop = ref(0);
const activeIdx = ref(0);

function setItemRef(el: unknown, idx: number) {
  // v-for + ref 传 function 时,el 是组件实例(Vue RouterLink)或 Element
  // 优先取 $el;否则它本身就是 HTMLElement
  const target =
    (el as { $el?: Element } | null)?.$el ?? (el as Element | null);
  if (target instanceof HTMLElement) {
    itemRefs.value[idx] = target;
  }
}

function updateIndicator() {
  // 优先用激活项的 offsetTop；若还未挂载（折叠态 DOM 不存在），fallback 0
  const el = itemRefs.value[activeIdx.value];
  if (el) {
    indicatorTop.value = el.offsetTop;
  }
}

// ===== 受控搜索关键词 =====
const keyword = ref("");
const suggestions = ref<SearchSuggestion[]>([]);
const showSuggest = ref(false);
const highlightIndex = ref(-1);
let debounceTimer: number | undefined;
let inFlightSeq = 0;

const searchBoxRef = ref<HTMLElement | null>(null);
const searchExpand = ref(false); // 折叠态点搜索图标后展开输入

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
  // 折叠变化后重新定位指示器
  void nextTick(updateIndicator);
}

// 队列抽屉引用
const queueDrawerRef = ref<InstanceType<typeof QueueDrawer> | null>(null);
function openQueue() {
  queueDrawerRef.value?.open();
}
async function openDesktopLyrics() {
  try {
    await desktopLyricsStore.toggleWindow();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[desktop-lyrics] 打开失败", e);
  }
}

// 路由切换 → 更新激活项索引 + 指示器
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
      'bg-card h-full flex flex-col transition-[width,padding] duration-220 ease-out overflow-hidden',
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
        <span class="text-base font-semibold">nnplayer</span>
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
        class="text-text-secondary hover:text-text-primary transition-colors p-1"
        :aria-label="'折叠侧栏'"
        title="折叠侧栏"
        @click="toggleCollapsed"
      >
        <ChevronLeft :size="18" :stroke-width="1.75" />
      </button>
    </div>

    <!-- 搜索区：折叠态=图标；展开态=输入框 -->
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
        class="absolute left-0 right-0 top-full mt-1 z-30 card max-h-80 overflow-y-auto py-1"
      >
        <div
          v-for="(s, idx) in suggestions"
          :key="`${s.keyword}-${s.song?.id ?? idx}`"
          class="px-3 py-2 cursor-pointer flex items-center gap-2 text-sm transition-colors"
          :class="
            highlightIndex === idx
              ? 'bg-hover text-accent'
              : 'text-text-primary hover:bg-hover'
          "
          @mouseenter="highlightIndex = idx"
          @click="onSuggestionClick(idx)"
        >
          <Search
            :size="14"
            :stroke-width="1.75"
            class="text-text-secondary shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate">
              {{ s.keyword || s.song?.name || "—" }}
            </div>
            <div
              v-if="s.song"
              class="text-[11px] text-text-secondary truncate"
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
        class="w-10 h-10 rounded-btn bg-hover text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors"
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
          class="fixed inset-0 z-40 bg-black/30 flex items-start justify-center pt-20 px-4"
          @click.self="searchExpand = false"
        >
          <div class="card p-4 w-full max-w-md">
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
                    ? 'bg-hover text-accent'
                    : 'hover:bg-hover'
                "
                @mouseenter="highlightIndex = idx"
                @click="onSuggestionClick(idx)"
              >
                <Search
                  :size="14"
                  :stroke-width="1.75"
                  class="text-text-secondary shrink-0"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate">
                    {{ s.keyword || s.song?.name || "—" }}
                  </div>
                  <div
                    v-if="s.song"
                    class="text-[11px] text-text-secondary truncate"
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
      <!-- 指示器 -->
      <div
        class="absolute left-0 w-1 h-12 bg-accent rounded-r transition-all duration-220 ease-out pointer-events-none"
        :style="{ top: indicatorTop + 'px' }"
      />
      <RouterLink
        v-for="(item, idx) in menu"
        :key="item.to"
        :to="item.to"
        :ref="(el) => setItemRef(el, idx)"
        :class="[
          'flex items-center h-12 rounded-btn text-sm transition-colors',
          collapsed ? 'justify-center px-2' : 'px-4 gap-3',
          'text-text-primary hover:bg-hover',
        ]"
        active-class="!text-accent font-medium"
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
        'mt-auto pt-4 border-t border-hover flex flex-col gap-1 shrink-0',
        collapsed ? 'px-0' : 'px-1',
      ]"
    >
      <button
        type="button"
        :class="[
          'flex items-center h-10 rounded-btn text-sm text-text-primary hover:bg-hover transition-colors',
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
          'flex items-center h-10 rounded-btn text-sm text-text-primary hover:bg-hover transition-colors',
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
        class="flex items-center justify-center h-10 rounded-btn text-sm text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
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
        class="w-8 h-8 rounded-full bg-hover object-cover shrink-0"
          @error="userStore.clearAvatar()"
      />
      <div
        v-else
        class="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs shrink-0"
      >
        {{ userStore.displayName.charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="mb-0.5 truncate text-text-secondary">
          {{ userStore.displayName }}
        </div>
        <button
          v-if="userStore.loggedIn"
          class="text-text-secondary hover:text-accent transition-colors"
          @click="logout"
        >
          退出登录
        </button>
      </div>
    </div>

    <!-- 折叠态：纯圆形头像 -->
    <div
      v-else
      class="pt-3 flex justify-center shrink-0"
    >
      <img
        v-if="userStore.avatarUrl"
        :src="userStore.avatarUrl"
        :alt="userStore.displayName"
        class="w-9 h-9 rounded-full bg-hover object-cover"
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

    <!-- 队列抽屉 -->
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
