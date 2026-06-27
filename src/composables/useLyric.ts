// 歌词 composable：
//   1. 拉取并解析当前歌曲歌词
//   2. 监听 audio currentTime，计算当前高亮行 activeLineIndex
//   3. 阶段3：暴露 karaokeTokens（当前行字符级时间窗）和 progressMs（行内毫秒进度）
//   4. 阶段3：向桌面歌词窗口 emit 'desktop-lyrics:update'
//   5. 阶段3+：桌面歌词窗口打开时 emit 'desktop-lyrics:request-snapshot'，
//               主窗收到后立即推一份最新快照，解决"打开瞬间空白"
//
// 设计原则：
//   - useAudioPlayer 内部已存在唯一的 <audio> 元素（由 player store 持有），
//     useLyric 只通过 playerStore.audioState 读取 currentTime，不再创建 audio。
//   - 切歌时自动重置并重新拉取。
//   - 桌面歌词事件 emit 失败时静默（不影响主流程）。
//   - useLyric 可被多个组件同时调用（DailyRecommend / Search / PlaylistDetail /
//     NowPlaying），每次实例都注册一份推送函数；最新一次注册生效。所有实例
//     观察同一个 playerStore，不会丢失推送。

import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { emit } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { fetchOnlineLyric, getLyric, getLocalLyric } from "@/composables/useNcmApi";
import {
  findActiveLineIndex,
  parseKaraokeLine,
  parseLrc,
  parseLrcWithTranslation,
  parseYrc,
  type LyricLine,
} from "@/utils/lrcParser";
import { usePlayerStore } from "@/stores/player";

// =============== 桌面歌词 payload ===============

/** 从 :root CSS 变量读取当前封面主题色。
 * 零 Pinia Store 依赖，直接读 DOM（themeStore 把色写到 :root 上），
 * 彻底避免 useLyric ↔ useThemeStore 交叉依赖破坏滚动。 */
function readThemeAccentFromDOM(): string {
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim();
    return v || "#E85D3A";
  } catch {
    return "#E85D3A";
  }
}

export interface KaraokeToken {
  char: string;
  startMs: number;
  endMs: number;
}

export interface DesktopLyricsPayload {
  /** 当前行文本 */
  current: string;
  /** 下一行文本 */
  next: string;
  /** 当前行进度的 0-1 百分比 */
  progress: number;
  /** 歌曲名 */
  songName: string;
  /** 艺术家 */
  artists: string;
  /** 完整歌词行（多行渲染用） */
  lines: LyricLine[];
  /** 当前行索引 */
  activeLineIndex: number;
  /** 行内毫秒进度（卡拉OK 用） */
  progressMs: number;
  /** 当前行卡拉OK 字符级时间窗 */
  karaokeTokens: KaraokeToken[];
  /** 封面提取的强调色（hex），供桌面歌词卡拉OK 逐字染色 */
  accentColor: string;
  /** 是否正在播放（子窗据此决定本地时钟是否前进） */
  playing: boolean;
}

// =============== 主窗 ↔ 桌面歌词窗：拉取快照 ===============
//
// 桌面歌词窗口打开瞬间会 emit 'desktop-lyrics:request-snapshot'。
// 主窗 App.vue 监听到该事件后调用 triggerDesktopLyricsPush() 推一份最新状态。
//
// 关键：lyrics 状态 + watches + 推送器 全部是**模块级单例**。
// 历史 bug：当主窗没渲染 LyricPanel（如 LocalMusic/PlaylistDetail 路由）时，
// useLyric() 不会被调，_pushDesktopLyrics 是 null，桌面歌词空白。
// 现在 initGlobalLyricBridge() 由 App.vue onMounted 显式调一次，
// 保证主窗任何路由下都能推送。

// ============ 模块级共享 state（单例） ============

const _lines = ref<LyricLine[]>([]);
const _yrcLines = shallowRef<ReturnType<typeof parseYrc>>([]);
const _activeLineIndex = ref<number>(-1);
const _progressMs = ref<number>(0);
const _loading = ref<boolean>(false);
const _error = ref<string>("");
const _currentSongId = ref<number | null>(null);
let _lyricSeq = 0;

// ============ rAF 播放时钟（模块级单例）============
const _clockMs = ref(0);
let _clockAnchorMs = 0;
let _clockAnchorTs = 0;
let _clockPlaying = false;
let _clockRaf = 0;
const SEEK_MS = 800;
const TOLERANCE_MS = 120;

function _snapClock(force: boolean) {
  const player = usePlayerStore();
  const audioMs = player.audioState.currentTime * 1000;
  const delta = audioMs - _clockMs.value;
  const now = performance.now();
  const playing = player.audioState.playing;

  if (force || Math.abs(delta) > SEEK_MS) {
    _clockAnchorMs = audioMs;
    _clockAnchorTs = now;
    _clockMs.value = audioMs;
  } else if (playing !== _clockPlaying) {
    _clockAnchorMs = _clockMs.value;
    _clockAnchorTs = now;
  } else if (delta > TOLERANCE_MS) {
    _clockAnchorMs = (_clockMs.value + audioMs) / 2;
    _clockAnchorTs = now;
  }
  _clockPlaying = playing;
}

function _clockTick() {
  if (_clockPlaying) {
    _clockMs.value = _clockAnchorMs + (performance.now() - _clockAnchorTs);
  } else {
    _clockMs.value = _clockAnchorMs;
  }
  _clockRaf = requestAnimationFrame(_clockTick);
}

/** 歌词来源（用于 LyricPanel 在"本地歌+在线歌词"时显示提示） */
type LyricSource = "local" | "online" | "none";
const _source = ref<LyricSource>("none");

const _karaokeTokens = computed(() => {
  const idx = _activeLineIndex.value;
  if (idx < 0 || idx >= _lines.value.length) return [];
  const cur = _lines.value[idx];

  const yrcLine = _yrcLines.value.find(
    (yl) => Math.abs(yl.time - cur.time) < 20,
  );
  if (yrcLine && yrcLine.words.length > 0) {
    return yrcLine.words.map((w) => ({
      char: w.char,
      startMs: w.startMs - cur.time,
      endMs: w.startMs + w.duration - cur.time,
    }));
  }

  const next = idx + 1 < _lines.value.length ? _lines.value[idx + 1] : null;
  const nextMs = next ? next.time : -1;
  const tokens = parseKaraokeLine(cur.text, cur.time, nextMs);
  return tokens.map((t) => ({
    char: t.char,
    startMs: t.startMs - cur.time,
    endMs: t.endMs - cur.time,
  }));
});

const _hasLyric = computed(() => _lines.value.length > 0);

let _pushDesktopLyrics: (() => void) | null = null;
let _globalBridgeInited = false;
const _watchStops: Array<() => void> = [];

export function triggerDesktopLyricsPush() {
  _pushDesktopLyrics?.();
}

async function _loadFor(songId: number) {
  const seq = ++_lyricSeq;
  const song = usePlayerStore().currentSong;
  if (song && !song.localPath && songId === _currentSongId.value && seq > 1) return;
  _currentSongId.value = songId;
  _lines.value = [];
  _activeLineIndex.value = -1;
  _progressMs.value = 0;
  _error.value = "";
  _source.value = "none";
  _loading.value = true;
  try {
    if (song?.localPath) {
      // ─── 本地歌词：内嵌/同目录 .lrc → 在线 NCM 兜底 ───
      let raw = "";
      try {
        raw = await getLocalLyric(song.localPath);
      } catch (e) {
        console.warn("[useLyric] 读本地歌词失败", song.localPath, e);
      }
      if (seq !== _lyricSeq) return;
      if (raw && raw.trim().length > 0) {
        _source.value = "local";
        _lines.value = parseLrc(raw);
        _yrcLines.value = [];
      } else {
        // 在线兜底
        try {
          console.log("[useLyric] 本地无歌词, 在线搜 NCM:", song.name, song.artists);
          const online = await fetchOnlineLyric(song.name, song.artists);
          if (seq !== _lyricSeq) return;
          if (online && online.trim().length > 0) {
            _source.value = "online";
            _lines.value = parseLrc(online);
            _yrcLines.value = [];
          } else {
            _source.value = "none";
            _lines.value = [];
          }
        } catch (e) {
          console.warn("[useLyric] 在线搜歌词失败", e);
          _source.value = "none";
          _lines.value = [];
        }
      }
    } else {
      // ─── NCM 歌词 ───
      const res = await getLyric(songId);
      if (seq !== _lyricSeq) return;
      const hasLrc = !!res.lrc;
      _lines.value = hasLrc
        ? parseLrcWithTranslation(res.lrc, res.tLrc)
        : parseLrc(res.tLrc);
      if (res.yLrc) {
        _yrcLines.value = parseYrc(res.yLrc);
      } else {
        _yrcLines.value = [];
      }
      _source.value = (res.lrc || res.tLrc) ? "online" : "none";
    }
  } catch (e) {
    if (seq !== _lyricSeq) return;
    _error.value = e instanceof Error ? e.message : "歌词加载失败";
  } finally {
    if (seq === _lyricSeq) _loading.value = false;
  }
}

let _pushTimer: ReturnType<typeof setTimeout> | undefined;

function _buildPayload(): DesktopLyricsPayload {
  const idx = _activeLineIndex.value;
  const currentLine = idx >= 0 && idx < _lines.value.length
    ? _lines.value[idx]
    : null;
  const nextLine = idx + 1 < _lines.value.length
    ? _lines.value[idx + 1]
    : null;
  const lineTime = currentLine ? currentLine.time : 0;
  const nextTime = nextLine ? nextLine.time : lineTime + 5000;
  const span = Math.max(1, nextTime - lineTime);
  const progress = idx >= 0
    ? Math.max(0, Math.min(1, _progressMs.value / span))
    : 0;
  const player = usePlayerStore();
  return {
    current: currentLine?.text ?? "",
    next: nextLine?.text ?? "",
    progress,
    songName: player.currentSong?.name ?? "",
    artists: player.currentSong?.artists ?? "",
    lines: _lines.value,
    activeLineIndex: idx,
    progressMs: _progressMs.value,
    karaokeTokens: _karaokeTokens.value,
    accentColor: readThemeAccentFromDOM(),
    playing: player.audioState.playing,
  };
}

function _sendPush() {
  if (!isTauri()) return;
  void emit("desktop-lyrics:update", _buildPayload()).catch(() => {});
}

function _pushUpdateToDesktop() {
  if (_pushTimer) return;
  _pushTimer = setTimeout(() => {
    _pushTimer = undefined;
    _sendPush();
  }, 250);
}

function _flushPush() {
  if (_pushTimer) {
    clearTimeout(_pushTimer);
    _pushTimer = undefined;
  }
  _sendPush();
}

/**
 * 初始化全局歌词桥接：在 App.vue onMounted 调用一次（**早于**任何 LyricPanel 挂载）。
 * 注册三个 watch：
 *   1. player.currentSong.id 变化 → _loadFor
 *   2. player.audioState.currentTime 变化 → 重算 activeLineIndex / progressMs
 *   3. 上述 state 变化 → _pushUpdateToDesktop
 * 同时设置模块级 _pushDesktopLyrics 供 triggerDesktopLyricsPush 使用。
 */
export function initGlobalLyricBridge() {
  if (_globalBridgeInited) return;
  _globalBridgeInited = true;

  const player = usePlayerStore();

  // 1. 切歌 → 拉歌词
  _watchStops.push(
    watch(
      () => player.currentSong?.id ?? null,
      (id) => {
        if (id === null) {
          _lines.value = [];
          _activeLineIndex.value = -1;
          _progressMs.value = 0;
          _currentSongId.value = null;
          return;
        }
        void _loadFor(id);
      },
      { immediate: true },
    ),
  );

  // 2. timeupdate / playing 变化 → snap 锚点
  _watchStops.push(
    watch(
      [() => player.audioState.currentTime, () => player.audioState.playing],
      () => _snapClock(false),
    ),
  );

  // 3. 用插值时钟算 activeLineIndex + progressMs（60fps，行边界及时切换）
  _watchStops.push(
    watch(
      _clockMs,
      (ms) => {
        if (_lines.value.length === 0) {
          _activeLineIndex.value = -1;
          _progressMs.value = 0;
          return;
        }
        const idx = findActiveLineIndex(_lines.value, Math.floor(ms));
        _activeLineIndex.value = idx;
        if (idx >= 0) {
          const lineTime = _lines.value[idx].time;
          const next = _lines.value[idx + 1];
          const nextTime = next ? next.time : lineTime + 5000;
          _progressMs.value = Math.max(
            0,
            Math.min(nextTime - lineTime, ms - lineTime),
          );
        } else {
          _progressMs.value = 0;
        }
      },
    ),
  );

  // 4. 状态变化 → 推送到桌面歌词（节流 250ms）
  _watchStops.push(
    watch(
      [_activeLineIndex, _progressMs, _lines, () => player.currentSong],
      () => _pushUpdateToDesktop(),
    ),
  );

  // 5. 行切换立即推一次（绕过 250ms 节流，避免新行首字延迟）
  _watchStops.push(
    watch(_activeLineIndex, () => _flushPush()),
  );

  _pushDesktopLyrics = _pushUpdateToDesktop;

  // 启动 rAF 时钟
  _snapClock(true);
  _clockRaf = requestAnimationFrame(_clockTick);
}

/** 销毁全局桥接（仅用于测试/热更；正常流程不用调） */
export function destroyGlobalLyricBridge() {
  _watchStops.forEach((s) => s());
  _watchStops.length = 0;
  if (_clockRaf) cancelAnimationFrame(_clockRaf);
  _clockRaf = 0;
  _pushDesktopLyrics = null;
  _globalBridgeInited = false;
}

export type { LyricSource };

export interface UseLyricReturn {
  /** 解析后的歌词行 */
  lines: Ref<LyricLine[]>;
  /** 当前高亮行索引（-1 表示无） */
  activeLineIndex: Ref<number>;
  /** 歌词来源：local = 内嵌/.lrc；online = NCM 在线；none = 无 */
  source: Ref<LyricSource>;
  /** 当前行内卡拉OK 字符级时间窗（伪） */
  karaokeTokens: ComputedRef<
    { char: string; startMs: number; endMs: number }[]
  >;
  /** 当前行内毫秒进度（用于卡拉OK 颜色切换） */
  progressMs: Ref<number>;
  /** 加载中 */
  loading: Ref<boolean>;
  /** 加载/解析错误 */
  error: Ref<string>;
  /** 是否存在原文歌词 */
  hasLyric: ComputedRef<boolean>;
  /** 跳转到指定时间（秒） */
  seekTo: (seconds: number) => void;
}

export function useLyric(): UseLyricReturn {
  // 兜底：万一 App.vue 没调 initGlobalLyricBridge，组件首次挂载时也补一下
  initGlobalLyricBridge();

  function seekTo(seconds: number) {
    const player = usePlayerStore();
    player.seek(seconds);
  }

  return {
    lines: _lines,
    activeLineIndex: _activeLineIndex,
    karaokeTokens: _karaokeTokens,
    progressMs: _progressMs,
    loading: _loading,
    error: _error,
    hasLyric: _hasLyric,
    source: _source,
    seekTo,
  };
}