<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Folder,
  ListMusic,
  Music2,
  Pin,
  Search,
  Sparkles,
} from "@lucide/vue";

import { searchSuggest } from "@/composables/useNcmApi";
import type { SearchSuggestion } from "@/types/music";
import { useUserStore } from "@/stores/user";
import { useDesktopLyricsStore } from "@/stores/desktopLyrics";
import { useNoticeStore } from "@/stores/notice";
import { describeAppError } from "@/utils/appErrors";
import AboutDialog from "@/components/AboutDialog.vue";
import QueueDrawer from "@/components/QueueDrawer.vue";

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const desktopLyricsStore = useDesktopLyricsStore();
const noticeStore = useNoticeStore();

/**
 * 侧栏宽度过渡（DESIGN 规定的 220ms）开始/结束信号。
 * App 收到后把「过渡中」状态 provide 给页面组件（SongList 注入），让容器查询
 * 的结果在动画期间保持冻结；所有会改变侧栏实际宽度的路径（桌面折叠/展开、
 * 窄窗浮层收放、768↔769 断点切换）都汇聚到这一组事件，页面侧只会看到
 * 「开始 → 一次结束」。
 */
const emit = defineEmits<{
  (e: "width-transition-start"): void;
  (e: "width-transition-end"): void;
}>();

const STORAGE_KEY = "nnplayer.sidebarCollapsed";
/** 首次驻留托盘提示只出现一次的标记。 */
const TRAY_HINT_STORAGE_KEY = "nnplayer.trayResidenceHintShown";

const collapsed = ref(
  typeof window !== "undefined" &&
    localStorage.getItem(STORAGE_KEY) === "1",
);

// ≤768px（与 styles.css 的断点一致）固定收成 64px 图标轨道，
// 不再整体隐藏侧栏；桌面端（≥769px）仍按 localStorage 的展开/折叠偏好。
const narrowQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(max-width: 768px)")
    : null;
const narrowViewport = ref(narrowQuery?.matches ?? false);
// 窄窗里从轨道临时展开的浮层：不写入偏好，跨断点或切页后自动收起。
const narrowExpanded = ref(false);
// 关闭浮层时保持 fixed 直到宽度过渡结束：若不这样，aside 会先带着 240px
// 宽度回到 flex 流、再动画回 64px，把内容壳/播放条推出去再拉回来。
const overlayClosing = ref(false);
const overlayActive = computed(
  () => narrowExpanded.value || overlayClosing.value,
);
const compact = computed(() =>
  narrowViewport.value ? !narrowExpanded.value : collapsed.value,
);
/** 占位 wrapper 的宽度：与 aside 的宽度保持同一套类名与过渡，避免内容壳错位。 */
const shellWidthClass = computed(() =>
  overlayActive.value
    ? "sidebar-shell--anchored"
    : compact.value
      ? "w-16"
      : "w-60",
);

// ===== 宽度过渡信号（供 App 冻结页面侧容器查询，见 FIX-CONTEXT-2 #13） =====

/** DESIGN 规定的侧栏宽度过渡时长（与 aside 的 duration-220 / shell 的 220ms 一致）。 */
const WIDTH_TRANSITION_MS = 220;
/** 多等一帧再解除冻结：等最后一帧的宽度提交后，页面只按最终宽度重排一次。 */
const WIDTH_TRANSITION_SETTLE_MS = WIDTH_TRANSITION_MS + 20;
let widthTransitionTimer: number | undefined;

const reduceMotionQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

/**
 * 侧栏实际宽度（64 / 240）。桌面折叠、窄窗浮层、断点切换最终都落到这里，
 * 因此 watch 它能覆盖全部宽度过渡路径；只有宽度真的变化才通知。
 */
const effectiveSidebarWidth = computed(() => (compact.value ? 64 : 240));
const lastSidebarWidth = ref(effectiveSidebarWidth.value);

function endWidthTransition() {
  if (widthTransitionTimer !== undefined) {
    window.clearTimeout(widthTransitionTimer);
    widthTransitionTimer = undefined;
  }
  emit("width-transition-end");
}

function beginWidthTransition() {
  // 减少动效时宽度是瞬变的，没有逐帧重排可冻结，也不该让页面多冻结 240ms。
  if (reduceMotionQuery?.matches) return;
  // 连续切换（动画中途再点）会重置计时器，但保持同一段「过渡中」，
  // 页面侧继续沿用第一次钉住的列策略，不会在动画中途重新测量。
  emit("width-transition-start");
  if (widthTransitionTimer !== undefined) {
    window.clearTimeout(widthTransitionTimer);
  }
  widthTransitionTimer = window.setTimeout(
    endWidthTransition,
    WIDTH_TRANSITION_SETTLE_MS,
  );
}

watch(effectiveSidebarWidth, (width) => {
  if (width === lastSidebarWidth.value) return;
  lastSidebarWidth.value = width;
  beginWidthTransition();
});

const menu = [
  { to: "/now-playing", label: "正在播放", icon: CirclePlay },
  { to: "/daily", label: "每日推荐", icon: Sparkles },
  { to: "/playlists", label: "我的歌单", icon: Folder },
] as const;

/** 关于弹层开关：入口是侧栏品牌区（展开/折叠都可用）。 */
const aboutOpen = ref(false);

const keyword = ref("");
const suggestions = ref<SearchSuggestion[]>([]);
const showSuggest = ref(false);
/** 建议请求失败：不能表现成「没有建议」，要留一条可读提示且回车仍可搜索。 */
const suggestError = ref(false);
const highlightIndex = ref(-1);
/** combobox：输入框用 aria-activedescendant 指向当前高亮的选项（DOM 焦点不离开输入框）。 */
const SUGGEST_LIST_ID = "sidebar-search-suggest";
const SUGGEST_MODAL_LIST_ID = "sidebar-search-modal-suggest";
function optionId(listId: string, idx: number) {
  return `${listId}-option-${idx}`;
}
function activeOptionId(listId: string) {
  return showSuggest.value && highlightIndex.value >= 0
    ? optionId(listId, highlightIndex.value)
    : undefined;
}
/** 建议行副标题：艺人 · 专辑，空字段不参与拼接，避免只剩一个孤立的「·」。 */
function suggestionMeta(s: SearchSuggestion): string {
  return [s.song?.artists, s.song?.album].filter(Boolean).join(" · ");
}
/** 建议行标题：关键词、歌名都没有时用「歌曲」兜底，不留空行或破折号。 */
function suggestionTitle(s: SearchSuggestion): string {
  return s.keyword || s.song?.name || "歌曲";
}
let debounceTimer: number | undefined;
let inFlightSeq = 0;

const searchBoxRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchButtonRef = ref<HTMLButtonElement | null>(null);
const expandButtonRef = ref<HTMLButtonElement | null>(null);
/** 品牌区「关于」入口：展开/折叠是两个不同元素，同一个 ref 只会挂到当前渲染的那个。 */
const aboutButtonRef = ref<HTMLButtonElement | null>(null);
/** 侧栏浮层（dialog 模式）的焦点圈容器。 */
const sidebarRef = ref<HTMLElement | null>(null);
/** 搜索弹层（dialog 模式）的焦点圈容器。 */
const searchPanelRef = ref<HTMLElement | null>(null);
const searchExpand = ref(false);

/**
 * 搜索页上侧栏输入框是 route.query.q 的镜像：路由成为唯一查询来源，
 * 页面输入框与侧栏不再各持一份会互相打架的关键词。其它页面上它仍是独立草稿。
 */
const onSearchPage = computed(() => route.name === "Search");
/** 上一次路由是否停在搜索页：离开时清掉镜像来的关键词，不留误导性的旧词。 */
let wasOnSearchPage = false;

/** 路由 query.q 只接受字符串：重复参数会解析成数组，宁可当作空查询。 */
function routeKeyword(): string {
  const q = route.query.q;
  return typeof q === "string" ? q : "";
}

/** 路由切换后对齐侧栏输入：进入搜索页镜像当前查询，离开时清空。 */
function syncKeywordWithRoute() {
  const current = router.currentRoute.value;
  const onSearch = current.name === "Search";
  if (onSearch) {
    keyword.value =
      typeof current.query.q === "string" ? current.query.q : "";
  } else if (wasOnSearchPage) {
    keyword.value = "";
  }
  wasOnSearchPage = onSearch;
}

/**
 * 搜索页上侧栏输入停顿后把关键词写回路由（replace，不新增历史）：
 * 页面输入框由 route.query.q 驱动，两个输入框看到同一个词、也搜同一批结果。
 */
function syncKeywordToRoute() {
  if (!onSearchPage.value) return;
  // 与路由已经一致就不重复导航（输入后又删回原词会走到这里）。
  if (routeKeyword() === keyword.value) return;
  void router.replace({
    query: keyword.value ? { q: keyword.value } : {},
  });
}

function goSearch(kw?: string) {
  const q = (kw ?? keyword.value).trim();
  if (!q) return;
  hideSuggest();
  // 弹层提交/选建议统一走关闭函数：先归还焦点再跳路由，避免输入框卸载后
  // 焦点掉到 <body>（侧栏跨路由常驻，触发按钮在导航后仍然存在）。
  if (searchExpand.value) closeSearchModal();
  router.push({ name: "Search", query: { q } });
}

function hideSuggest() {
  // 收起建议浮层时同时作废防抖与在途请求：否则「输入后 300ms 内按 Tab/点击外部」
  // 或「建议请求仍在途中就离开搜索框」时，稍后到期的请求/响应会无条件把浮层
  // 重新弹出（absolute z-30），盖住刚获得焦点的侧栏导航。所有收起入口
  // （Tab/Escape、点击外部、焦点离开、提交搜索、路由切换、窄窗浮层收起）共用。
  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  inFlightSeq += 1;
  showSuggest.value = false;
  suggestError.value = false;
  highlightIndex.value = -1;
}

async function fetchSuggest() {
  const q = keyword.value.trim();
  if (!q) {
    inFlightSeq += 1;
    suggestions.value = [];
    showSuggest.value = false;
    suggestError.value = false;
    return;
  }
  const seq = ++inFlightSeq;
  try {
    const res = await searchSuggest(q);
    if (seq !== inFlightSeq) return;
    suggestions.value = res;
    suggestError.value = false;
    showSuggest.value = true;
    highlightIndex.value = res.length > 0 ? 0 : -1;
  } catch (e) {
    if (seq !== inFlightSeq) return;
    // 失败不能表现为「没有建议」：用户需要能区分空结果与请求失败。
    console.warn("[search] 搜索建议获取失败", e);
    suggestions.value = [];
    suggestError.value = true;
    showSuggest.value = true;
    highlightIndex.value = -1;
  }
}

function onInput() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  // 立即使旧请求失效，避免防抖窗口内显示上一关键词的结果。
  suggestError.value = false;
  inFlightSeq += 1;
  debounceTimer = window.setTimeout(() => {
    fetchSuggest();
    // 搜索页上路由是唯一真相：停顿后同步回 query，页面输入框随之更新。
    syncKeywordToRoute();
  }, 300);
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
  if (e.key === "Tab") {
    // 焦点离开输入框：建议浮层必须收起，否则会继续盖住接下来获得焦点的
    // 侧栏导航（绝对定位 z-30），焦点环被压在浮层下面。
    hideSuggest();
    return;
  }
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
    // 建议列表可见时只收起列表，不关闭外层弹层：第一次 Esc 收建议，
    // 第二次才轮到 dialog 的 Esc 关闭（document 监听）。
    e.stopPropagation();
    hideSuggest();
  }
}

function onDocClick(e: MouseEvent) {
  // 折叠态/弹层态没有桌面搜索框：外部点击由浮层遮罩自己处理。
  if (!searchBoxRef.value) return;
  if (searchBoxRef.value.contains(e.target as Node)) return;
  // 点击搜索框外部即视为放弃建议：无论浮层是否已显示都收起并作废待发/在途请求，
  // 否则「输入后 300ms 内点击别处」时，稍后到期的防抖仍会把浮层弹出来。
  hideSuggest();
}

/**
 * 焦点离开搜索框时收起建议（鼠标点外部本来由 onDocClick 兜底，这里补键盘 Tab /
 * 程序化 focus 的路径）。relatedTarget 为空表示焦点落到了非可聚焦区域（例如
 * 建议行本身），此时不能抢先收起：建议行还要收到 click；真正的「点外部」由
 * onDocClick 处理。
 */
function onSearchFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (!next || searchBoxRef.value?.contains(next)) return;
  // 焦点确实离开搜索框：即使建议尚未显示（防抖/请求在途）也要收起并作废，
  // 否则迟到的响应会把浮层重新弹出、盖住刚获得焦点的导航项。
  hideSuggest();
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
  if (
    !window.confirm(
      "退出登录？当前播放会停止，本机登录信息会清除，之后需要重新登录才能继续使用。",
    )
  ) {
    return;
  }
  userStore.logout().then(() => router.replace("/login"));
}

/** 视图切换后主控件会重新渲染，把焦点交给新布局里最靠前的可操作项。 */
function focusPrimaryAction() {
  void nextTick(() => {
    if (compact.value) expandButtonRef.value?.focus();
    else searchInputRef.value?.focus();
  });
}

// 与 aside 的宽度过渡（220ms）对齐，再回落到 flex 流，避免回流瞬间推挤内容。
const OVERLAY_RELEASE_MS = 240;
let overlayTimer: number | undefined;

function clearOverlayTimer() {
  if (overlayTimer !== undefined) {
    window.clearTimeout(overlayTimer);
    overlayTimer = undefined;
  }
}

function openNarrowOverlay() {
  clearOverlayTimer();
  overlayClosing.value = false;
  narrowExpanded.value = true;
  void nextTick(() => searchInputRef.value?.focus());
}

/**
 * 收起窄窗浮层：先让 fixed 浮层带着 aside 的 240→64px 宽度过渡收起，
 * 过渡结束后才把 aside 交回 flex 流（占位由外层 wrapper 保留），
 * 因此内容壳与播放条在整个开关过程中都不位移。
 * restoreFocus=false 用于「打开另一个 modal（队列抽屉）」时把焦点留给它。
 */
function closeNarrowOverlay(restoreFocus = true) {
  if (!narrowExpanded.value) return;
  hideSuggest();
  narrowExpanded.value = false;
  overlayClosing.value = true;
  clearOverlayTimer();
  overlayTimer = window.setTimeout(() => {
    overlayTimer = undefined;
    overlayClosing.value = false;
  }, OVERLAY_RELEASE_MS);
  if (restoreFocus) void nextTick(() => expandButtonRef.value?.focus());
}

function toggleCollapsed() {
  if (narrowViewport.value) {
    // 窄窗：只在浮层里临时展开，不改变桌面端的持久化偏好。
    if (narrowExpanded.value) closeNarrowOverlay();
    else openNarrowOverlay();
    return;
  }
  collapsed.value = !collapsed.value;
  localStorage.setItem(STORAGE_KEY, collapsed.value ? "1" : "0");
  focusPrimaryAction();
}

function openSearchModal() {
  searchExpand.value = true;
  void nextTick(() => searchInputRef.value?.focus());
}

function closeSearchModal() {
  searchExpand.value = false;
  void nextTick(() => searchButtonRef.value?.focus());
}

function onNarrowChange(e: MediaQueryListEvent) {
  const wasOverlay = overlayActive.value;
  const wasSearchModal = searchExpand.value;
  clearOverlayTimer();
  overlayClosing.value = false;
  narrowViewport.value = e.matches;
  // 跨断点复位临时浮层与弹层：≥769px 回到 localStorage 记录的折叠偏好。
  narrowExpanded.value = false;
  searchExpand.value = false;
  // 断点切换会重排/卸载浮层与弹层：把焦点交给仍然存在的等价入口。
  if (wasSearchModal) {
    void nextTick(() => (searchInputRef.value ?? searchButtonRef.value)?.focus());
  } else if (wasOverlay) {
    void nextTick(() => (searchInputRef.value ?? expandButtonRef.value)?.focus());
  }
}

// ===== dialog 焦点管理（侧栏浮层与搜索弹层共用） =====

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 容器内当前可聚焦的元素（过滤 display:none 等不可见项）。 */
function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.getClientRects().length > 0);
}

/** Tab/Shift+Tab 在 dialog 内循环，遮罩后的页面不会被意外聚焦。 */
function trapFocus(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== "Tab") return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    e.preventDefault();
    container?.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  const insideContainer = active !== null && container?.contains(active);
  if (!insideContainer) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault();
    last.focus();
  }
}

/**
 * 两个 dialog 共用 document 级键盘处理：Esc 关闭、Tab 焦点圈。
 * 挂在 document 上而不是面板上：建议列表收起、行内按钮被移除等情况下
 * 焦点可能落到 body，只有 document 仍能收到 keydown 把焦点带回面板。
 */
function onModalKeydown(e: KeyboardEvent) {
  if (!searchExpand.value && !narrowExpanded.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (searchExpand.value) closeSearchModal();
    else closeNarrowOverlay();
    return;
  }
  trapFocus(
    e,
    searchExpand.value ? searchPanelRef.value : sidebarRef.value,
  );
}

const queueDrawerRef = ref<InstanceType<typeof QueueDrawer> | null>(null);
function openQueue() {
  // 浮层与队列抽屉都是 modal：先收起浮层，避免两套焦点圈叠加。
  // restoreFocus=false：焦点交给刚打开的队列抽屉，别被抢回展开按钮。
  if (narrowExpanded.value) closeNarrowOverlay(false);
  queueDrawerRef.value?.open();
}
async function openDesktopLyrics() {
  if (narrowExpanded.value) closeNarrowOverlay(false);
  const opening = !desktopLyricsStore.isOpen;
  try {
    await desktopLyricsStore.toggleWindow();
  } catch (e) {
    console.warn("[desktop-lyrics] 打开失败", e);
    // 窗口开关失败不能只进 console：桌面歌词是核心功能，用户需要看到原因和重试路径。
    noticeStore.push({
      id: "desktop-lyrics-toggle-failed",
      tone: "error",
      title: opening ? "无法打开桌面歌词" : "无法关闭桌面歌词",
      hint: !isTauri()
        ? "桌面歌词只在桌面版 nnplayer 中可用。"
        : opening
          ? "请重试；如果仍然失败，可重启 nnplayer 后再试。"
          : "请重试；如果窗口仍然显示，可重启 nnplayer 后再关闭。",
      detail: describeAppError(e).detail,
    });
  }
}

/** 打开关于弹层；窄窗浮层正开着时先收起它，把焦点让给弹层。 */
function openAbout() {
  if (narrowExpanded.value) closeNarrowOverlay(false);
  aboutOpen.value = true;
}

/** 关闭关于弹层：断点切换可能替换品牌按钮，按当前渲染的入口归还焦点。 */
function closeAbout() {
  aboutOpen.value = false;
  void nextTick(() => aboutButtonRef.value?.focus());
}

/** 首次驻留托盘提示的固定 id 与会话内状态。 */
const TRAY_HINT_ID = "tray-residence-hint";
let trayHintShown = false;
let trayHintDismissed = false;

function pushTrayResidenceHint() {
  trayHintShown = true;
  noticeStore.push({
    id: TRAY_HINT_ID,
    tone: "info",
    title: "关闭窗口后仍会在托盘继续播放",
    hint: "Ctrl+Alt+P 可随时播放/暂停；点击系统托盘图标可重新打开窗口。",
    onDismiss: () => {
      trayHintDismissed = true;
    },
  });
}

/**
 * 首次启动提示「关闭窗口后驻留托盘」：localStorage 标记只出现一次。
 * 只在 Tauri 主窗显示（浏览器预览没有托盘，提示会误导）；
 * 提示本身由 notice store 持有，可手动关闭、不自动消失。
 *
 * 延时到首个路由就绪后再推：App.vue 在切换到登录页/会话切换时会清理
 * 全局提示（resetSessionNotices），首启未登录时路由还没就绪就推会被清掉。
 */
async function showTrayResidenceHintOnce() {
  if (!isTauri()) return;
  // 首个路由就绪后再推；路由初始化可能被会话恢复阻塞，最多等 3s 就照常提示
  // （若之后 App.vue 清掉提示，下面的 watch 会补回）。
  let readyTimer: number | undefined;
  try {
    await Promise.race([
      router.isReady().catch(() => undefined),
      new Promise<void>((resolve) => {
        readyTimer = window.setTimeout(resolve, 3000);
      }),
    ]);
  } finally {
    if (readyTimer !== undefined) window.clearTimeout(readyTimer);
  }
  await nextTick();
  try {
    if (localStorage.getItem(TRAY_HINT_STORAGE_KEY) === "1") return;
    localStorage.setItem(TRAY_HINT_STORAGE_KEY, "1");
  } catch (e) {
    // localStorage 不可用时不打扰用户，也不影响其它功能。
    console.warn("[sidebar] 读取驻留提示标记失败", e);
    return;
  }
  pushTrayResidenceHint();
}

// App.vue 在进入登录页/切换会话时会 clear() 全部提示；驻留提示是应用级的，
// 用户没有主动关闭前都应保留：被外部清掉时补回（dismiss 后不再补）。
watch(
  () => noticeStore.notices.some((item) => item.id === TRAY_HINT_ID),
  (present) => {
    if (!trayHintShown || trayHintDismissed || present) return;
    pushTrayResidenceHint();
  },
);

// 搜索页的路由查询是唯一真相：页面输入框或前进/后退改了 q，侧栏同步镜像；
// 侧栏自己写回路由时 q 与本地输入相等，这里不会回灌覆盖正在输入的新内容。
watch(
  () => route.query.q,
  () => {
    if (!onSearchPage.value) return;
    const next = routeKeyword();
    if (next === keyword.value) return;
    keyword.value = next;
    // 外部改了查询：上一次的建议已经不对应当前关键词，收起而不是继续显示。
    hideSuggest();
  },
);

watch(
  () => router.currentRoute.value.path,
  () => {
    hideSuggest();
    // 窄窗里点导航后收起浮层，把整幅内容还给页面；不在这里归还焦点：
    // 路由切换后的焦点统一由 router.afterEach 交给新页面的内容区，
    // 否则两个 nextTick 回调会互相抢焦点。
    if (narrowExpanded.value) closeNarrowOverlay(false);
    searchExpand.value = false;
    // 进入/离开搜索页时对齐输入框，离开后不留下与页面不一致的旧词。
    syncKeywordWithRoute();
  },
  { immediate: true },
);

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onModalKeydown);
  narrowQuery?.addEventListener("change", onNarrowChange);
  void showTrayResidenceHintOnce();
});

onBeforeUnmount(() => {
  inFlightSeq += 1;
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onModalKeydown);
  narrowQuery?.removeEventListener("change", onNarrowChange);
  if (debounceTimer) window.clearTimeout(debounceTimer);
  clearOverlayTimer();
  // 卸载时若仍在过渡中，补发结束信号，避免 App 的共享状态永远停在 true。
  if (widthTransitionTimer !== undefined) endWidthTransition();
});
</script>

<template>
  <!-- 外层 wrapper 常驻 flex 流：窄窗浮层打开时保留 64px 轨道占位，
       浮层（fixed）只做视觉覆盖，内容壳与播放条不会横向跳动。 -->
  <div
    class="sidebar-shell"
    :class="shellWidthClass"
  >
    <aside
      ref="sidebarRef"
      :class="[
        'sidebar h-full py-6 flex flex-col transition-[width] duration-220 ease-out overflow-hidden',
        compact ? 'w-16 px-2' : 'w-60 px-4',
        { 'sidebar--overlay': overlayActive },
      ]"
      :role="narrowExpanded ? 'dialog' : undefined"
      :aria-modal="narrowExpanded ? 'true' : undefined"
      :aria-label="narrowExpanded ? '侧栏导航' : undefined"
      :tabindex="narrowExpanded ? -1 : undefined"
    >
      <!-- Logo + 折叠按钮 -->
      <div
        :class="[
          'flex items-center mb-5 shrink-0',
          compact ? 'justify-center' : 'justify-between px-1',
        ]"
      >
        <!-- 品牌区可点开「关于」：版本、快捷键、托盘说明与更新入口都在那里。 -->
        <button
          v-if="!compact"
          ref="aboutButtonRef"
          type="button"
          class="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-card-hover"
          title="关于 nnplayer"
          aria-label="关于 nnplayer"
          @click="openAbout"
        >
          <Music2
            :size="22"
            :stroke-width="1.75"
            class="text-accent shrink-0"
          />
          <span class="truncate text-base font-semibold text-text-primary">nnplayer</span>
        </button>
        <button
          v-else
          ref="aboutButtonRef"
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-xl text-accent transition-colors hover:bg-card-hover"
          title="关于 nnplayer"
          aria-label="关于 nnplayer"
          @click="openAbout"
        >
          <Music2 :size="22" :stroke-width="1.75" />
        </button>
        <button
          v-if="!compact"
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-card-hover transition-colors"
          :aria-label="narrowViewport ? '收起侧栏' : '折叠侧栏'"
          :title="narrowViewport ? '收起侧栏' : '折叠侧栏'"
          @click="toggleCollapsed"
        >
          <ChevronLeft :size="18" :stroke-width="1.75" />
        </button>
      </div>

      <!-- 搜索区 -->
      <div
        v-if="!compact"
        ref="searchBoxRef"
        class="mb-4 relative shrink-0"
        @focusout="onSearchFocusOut"
      >
        <form @submit.prevent="onEnter">
          <input
            ref="searchInputRef"
            v-model="keyword"
            type="text"
            placeholder="搜索歌曲或艺人"
            class="input"
            autocomplete="off"
            aria-label="搜索歌曲或艺人"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            :aria-expanded="showSuggest && suggestions.length > 0"
            :aria-controls="
              showSuggest && suggestions.length > 0
                ? SUGGEST_LIST_ID
                : undefined
            "
            :aria-activedescendant="activeOptionId(SUGGEST_LIST_ID)"
            @input="onInput"
            @keydown="onKeydown"
            @focus="fetchSuggest"
          />
        </form>
        <div
          v-if="showSuggest && (suggestions.length > 0 || suggestError)"
          :id="suggestions.length > 0 && !suggestError ? SUGGEST_LIST_ID : undefined"
          :role="suggestions.length > 0 && !suggestError ? 'listbox' : undefined"
          aria-label="搜索建议"
          class="glass absolute left-0 right-0 top-full mt-2 z-30 max-h-80 overflow-y-auto py-1"
        >
          <div
            v-if="suggestError"
            class="px-3 py-2 text-xs text-accent"
            role="status"
          >
            搜索建议加载失败，按回车可直接搜索
          </div>
          <template v-else>
            <div
              v-for="(s, idx) in suggestions"
              :key="`${s.keyword}-${s.song?.id ?? idx}`"
              :id="optionId(SUGGEST_LIST_ID, idx)"
              role="option"
              :aria-selected="highlightIndex === idx"
              class="px-3 py-2 cursor-pointer rounded-md flex items-center gap-2 text-sm transition-colors"
              :class="
                highlightIndex === idx
                  ? 'bg-accent-subtle text-text-primary'
                  : 'text-text-secondary hover:bg-card-hover'
              "
              @mouseenter="highlightIndex = idx"
              @click="onSuggestionClick(idx)"
            >
              <Search
                :size="14"
                :stroke-width="1.75"
                class="text-text-tertiary shrink-0"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate">
                  {{ suggestionTitle(s) }}
                </div>
                <div
                  v-if="suggestionMeta(s)"
                  class="text-[11px] text-text-tertiary truncate"
                >
                  {{ suggestionMeta(s) }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="mb-3 flex justify-center shrink-0">
        <button
          ref="searchButtonRef"
          type="button"
          class="w-10 h-10 rounded-xl bg-card-hover text-text-tertiary hover:text-text-primary hover:bg-surface-strong flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
          :aria-label="'打开搜索'"
          title="打开搜索"
          @click="openSearchModal"
        >
          <Search :size="18" :stroke-width="1.75" />
        </button>
      </div>

      <!-- 折叠态展开搜索弹层 -->
      <Teleport to="body">
        <Transition name="search-fade">
          <div
            v-if="searchExpand && compact"
            class="fixed inset-0 z-40 overflow-y-auto bg-black/60 backdrop-blur-sm"
          >
            <!-- 短视口下外层滚动；关闭只认舞台空白处（点滚动条不会误关，与关于弹层同构）。 -->
            <div
              class="search-modal-stage flex min-h-full items-start justify-center px-4 pt-20 pb-6"
              @click.self="closeSearchModal"
            >
              <div
                ref="searchPanelRef"
                class="glass search-modal-panel p-4 w-full max-w-md"
                role="dialog"
                aria-modal="true"
                aria-label="搜索歌曲"
                tabindex="-1"
              >
                <input
                  ref="searchInputRef"
                  v-model="keyword"
                  type="text"
                  placeholder="搜索歌曲或艺人"
                  class="input mb-3 shrink-0"
                  autocomplete="off"
                  aria-label="搜索歌曲或艺人"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  :aria-expanded="showSuggest && suggestions.length > 0"
                  :aria-controls="
                    showSuggest && suggestions.length > 0
                      ? SUGGEST_MODAL_LIST_ID
                      : undefined
                  "
                  :aria-activedescendant="
                    activeOptionId(SUGGEST_MODAL_LIST_ID)
                  "
                  @input="onInput"
                  @keydown="onKeydown"
                  @keydown.enter="onEnter"
                />
                <div
                  v-if="suggestError"
                  class="px-3 py-2 text-xs text-accent shrink-0"
                  role="status"
                >
                  搜索建议加载失败，按回车可直接搜索
                </div>
                <div
                  v-else-if="showSuggest && suggestions.length > 0"
                  :id="SUGGEST_MODAL_LIST_ID"
                  role="listbox"
                  aria-label="搜索建议"
                  class="max-h-72 min-h-0 overflow-y-auto"
                >
                  <div
                    v-for="(s, idx) in suggestions"
                    :key="`${s.keyword}-${s.song?.id ?? idx}`"
                    :id="optionId(SUGGEST_MODAL_LIST_ID, idx)"
                    role="option"
                    :aria-selected="highlightIndex === idx"
                    class="px-3 py-2 cursor-pointer rounded-md flex items-center gap-2 text-sm transition-colors"
                    :class="
                      highlightIndex === idx
                        ? 'bg-accent-subtle text-text-primary'
                        : 'text-text-secondary hover:bg-card-hover'
                    "
                    @mouseenter="highlightIndex = idx"
                    @click="onSuggestionClick(idx)"
                  >
                    <Search
                      :size="14"
                      :stroke-width="1.75"
                      class="text-text-tertiary shrink-0"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate">
                        {{ suggestionTitle(s) }}
                      </div>
                      <div
                        v-if="suggestionMeta(s)"
                        class="text-[11px] text-text-tertiary truncate"
                      >
                        {{ suggestionMeta(s) }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="flex justify-end mt-2 shrink-0">
                  <button
                    type="button"
                    class="btn btn-ghost text-xs"
                    @click="closeSearchModal"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- 窄窗临时展开浮层的遮罩：点击任意处收起（与队列抽屉的遮罩约定一致） -->
      <Teleport to="body">
        <Transition name="search-fade">
          <div
            v-if="overlayActive"
            class="fixed inset-0 z-40 bg-black/20"
            aria-hidden="true"
            @click="closeNarrowOverlay()"
          />
        </Transition>
      </Teleport>

      <!-- 导航菜单 -->
      <nav class="relative flex-1 mt-2">
        <RouterLink
          v-for="item in menu"
          :key="item.to"
          :to="item.to"
          :class="[
            'flex items-center h-12 rounded-md text-sm transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
            compact ? 'justify-center px-2' : 'px-4 gap-3',
            'text-text-secondary hover:text-text-primary hover:bg-card-hover',
          ]"
          active-class="!text-accent-on-subtle !bg-accent-subtle font-medium"
          :title="compact ? item.label : undefined"
          :aria-label="compact ? item.label : undefined"
        >
          <component
            :is="item.icon"
            :size="18"
            :stroke-width="1.75"
            class="w-5 shrink-0"
          />
          <span v-if="!compact">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- 底部按钮区 -->
      <div class="mt-auto pt-4 flex flex-col gap-1 shrink-0">
        <button
          type="button"
          :class="[
            'flex items-center h-10 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
            compact ? 'justify-center px-2' : 'px-4 gap-3',
          ]"
          title="播放队列"
          :aria-label="'播放队列'"
          @click="openQueue"
        >
          <ListMusic :size="16" :stroke-width="1.75" class="w-5 shrink-0" />
          <span v-if="!compact">播放队列</span>
        </button>
        <button
          type="button"
          :class="[
            'flex items-center h-10 rounded-xl text-sm transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
            compact ? 'justify-center px-2' : 'px-4 gap-3',
            desktopLyricsStore.isOpen
              ? 'text-accent-on-subtle bg-accent-subtle'
              : 'text-text-secondary hover:text-text-primary hover:bg-card-hover',
          ]"
          :title="desktopLyricsStore.isOpen ? '关闭桌面歌词' : '打开桌面歌词'"
          aria-label="桌面歌词"
          :aria-pressed="desktopLyricsStore.isOpen"
          @click="openDesktopLyrics"
        >
          <Pin :size="16" :stroke-width="1.75" class="w-5 shrink-0" />
          <span v-if="!compact">桌面歌词</span>
          <span
            v-if="!compact"
            class="ml-auto text-[11px]"
            :class="
              desktopLyricsStore.isOpen
                ? 'text-accent-on-subtle'
                : 'text-text-tertiary'
            "
          >{{ desktopLyricsStore.isOpen ? "已开启" : "已关闭" }}</span>
        </button>
        <button
          v-if="compact"
          ref="expandButtonRef"
          type="button"
          class="flex h-9 w-9 self-center items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-card-hover transition-colors"
          title="展开侧栏"
          aria-label="展开侧栏"
          @click="toggleCollapsed"
        >
          <ChevronRight :size="18" :stroke-width="1.75" />
        </button>
      </div>

      <!-- 用户信息 -->
      <div
        v-if="!compact"
        class="px-1 pt-2 flex items-center gap-2 text-xs"
      >
        <img
          v-if="userStore.avatarUrl"
          :src="userStore.avatarUrl"
          :alt="userStore.displayName"
          class="w-8 h-8 rounded-full bg-card-hover object-cover shrink-0"
            @error="userStore.clearAvatar()"
        />
        <div
          v-else
          class="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-on-accent text-xs shrink-0"
        >
          {{ userStore.displayName.charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="mb-0.5 truncate text-text-secondary">
            {{ userStore.displayName }}
          </div>
          <button
            v-if="userStore.loggedIn"
            type="button"
            class="text-text-tertiary hover:text-accent transition-colors"
            title="退出登录"
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
          class="w-9 h-9 rounded-full bg-card-hover object-cover"
          :title="userStore.displayName"
            @error="userStore.clearAvatar()"
        />
        <div
          v-else
          class="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-on-accent text-sm"
          :title="userStore.displayName"
        >
          {{ userStore.displayName.charAt(0).toUpperCase() }}
        </div>
      </div>

      <QueueDrawer ref="queueDrawerRef" />

      <!-- 关于/帮助弹层：由品牌区触发，内容含版本、快捷键、托盘说明与更新。 -->
      <AboutDialog :open="aboutOpen" @close="closeAbout" />
    </aside>
  </div>
</template>

<style scoped>
/* 常驻 flex 流的占位 wrapper：aside 在窄窗浮层状态下变 fixed 时，
   由 wrapper 继续占住 64px 轨道宽度，内容壳与播放条不会横向跳动。
   宽度过渡与 aside 的 `transition-[width] duration-220 ease-out`
   完全同步，桌面折叠/展开与 768↔769 断点切换时内容平滑跟随。 */
.sidebar-shell {
  display: flex;
  flex: 0 0 auto;
  height: 100%;
  transition: width 220ms cubic-bezier(0, 0, 0.2, 1);
}

.sidebar-shell--anchored {
  width: 4rem;
}

.sidebar {
  background: var(--color-surface-soft);
  /* 只过渡 width（DESIGN 的 220ms）：padding 不再参与过渡，二次失效的盒子少一半；
     layout/paint containment 把侧栏内部的 reflow 收在栏内，不向内容壳外溢。
     所有浮层（队列抽屉/搜索/关于）都 Teleport 到 body，不会被 paint containment 裁掉。 */
  contain: layout paint;
}

/* 侧栏内所有可键盘聚焦的控件统一 2px 陶土焦点环（DESIGN 的焦点约定）。 */
.sidebar button:focus-visible,
.sidebar a:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* 窄窗从 64px 轨道临时展开：fixed 浮层只做视觉覆盖（占位由外层 wrapper
   保留），遮罩与层级沿用队列抽屉的约定（20% 黑遮罩 + Floating 阴影）。 */
@media (max-width: 768px) {
  .sidebar--overlay {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 45;
    background: var(--color-bg);
    box-shadow: var(--shadow-floating);
  }
}

/* 折叠态搜索弹层：短视口下整层可滚动，面板高度封顶在视口内，
   建议列表收缩滚动，取消按钮始终可达（不再被 fixed 层裁掉）。 */
.search-modal-panel {
  display: flex;
  max-height: calc(100vh - 104px);
  max-height: calc(100dvh - 104px);
  flex-direction: column;
}

.search-fade-enter-active,
.search-fade-leave-active {
  transition: opacity 0.18s ease;
}
.search-fade-enter-from,
.search-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-shell {
    transition: none;
  }

  .search-fade-enter-active,
  .search-fade-leave-active {
    transition: none;
  }
}
</style>
