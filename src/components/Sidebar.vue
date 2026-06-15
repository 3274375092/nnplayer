<script setup lang="ts">
// 左侧导航栏：Logo + 搜索框（含建议下拉浮层）+ 路由菜单 + 用户/退出。
//
// 搜索建议实现要点：
//   1. 300ms 防抖调用 search_suggest
//   2. 点击外部 / Esc 关闭浮层
//   3. ↑ / ↓ 键盘选择，回车跳转搜索（或直接命中歌曲则双击行为）
//   4. 浮层定位在搜索框正下方，与柔和米黄体系一致

import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { searchSuggest } from "@/composables/useNcmApi";
import type { SearchSuggestion } from "@/types/music";
import { useUserStore } from "@/stores/user";

const router = useRouter();
const userStore = useUserStore();

// ===== 受控搜索关键词 =====
const keyword = ref("");
const suggestions = ref<SearchSuggestion[]>([]);
const showSuggest = ref(false);
const highlightIndex = ref(-1);
let debounceTimer: number | undefined;
let inFlightSeq = 0; // 防止过期请求覆盖新结果

const searchBoxRef = ref<HTMLElement | null>(null);

function goSearch(kw?: string) {
  const q = (kw ?? keyword.value).trim();
  if (!q) return;
  hideSuggest();
  router.push({ name: "Search", query: { q } });
}

function hideSuggest() {
  showSuggest.value = false;
  highlightIndex.value = -1;
}

// ===== 防抖拉取建议 =====
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
    // 仅当仍是最新请求时再写入（避免快速输入时旧响应覆盖）
    if (seq !== inFlightSeq) return;
    suggestions.value = res;
    showSuggest.value = true;
    highlightIndex.value = res.length > 0 ? 0 : -1;
  } catch {
    // 静默失败：下拉浮层关闭即可，避免输入时一直弹错
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
  // 若浮层中有高亮项：回车直接跳转其搜索
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

// ===== 点击外部关闭 =====
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
    // 命中歌曲：跳转搜索页（用户可在搜索页双击播放）
    goSearch(s.keyword || s.song.name);
  } else {
    goSearch(s.keyword);
  }
}

function logout() {
  userStore.logout().then(() => router.replace("/login"));
}

// ===== 路由跳转后清空输入 =====
watch(
  () => router.currentRoute.value.fullPath,
  () => {
    // 切页时关闭浮层，但保留已输入文本以免破坏用户体验
    hideSuggest();
  }
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
  <aside class="bg-card h-full flex flex-col px-4 py-5">
    <!-- Logo -->
    <div class="flex items-center gap-2 mb-6 px-2">
      <div
        class="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white font-bold"
      >
        N
      </div>
      <span class="text-base font-semibold">nnplayer</span>
    </div>

    <!-- 搜索框（含下拉建议） -->
    <div ref="searchBoxRef" class="mb-5 relative">
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

      <!-- 建议浮层 -->
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
          <span class="text-text-secondary text-xs shrink-0">🔍</span>
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

    <!-- 导航菜单 -->
    <nav class="flex flex-col gap-1">
      <router-link
        v-for="item in [
          { to: '/daily', label: '每日推荐' },
          { to: '/playlists', label: '我的歌单' },
        ]"
        :key="item.to"
        :to="item.to"
        class="px-3 py-2 rounded-btn text-text-primary hover:bg-hover transition-colors"
        active-class="bg-hover text-accent font-medium"
      >
        {{ item.label }}
      </router-link>
    </nav>

    <!-- 底部用户信息 -->
    <div class="mt-auto px-2 pt-4 border-t border-hover">
      <div class="text-xs text-text-secondary mb-1">
        {{ userStore.displayName }}
      </div>
      <button
        v-if="userStore.loggedIn"
        class="text-xs text-text-secondary hover:text-accent transition-colors"
        @click="logout"
      >
        退出登录
      </button>
    </div>
  </aside>
</template>
