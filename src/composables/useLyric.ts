// 歌词 composable：
//   1. 拉取并解析当前歌曲歌词
//   2. 前台播放时逐帧读取 audio.currentTime，后台/暂停按媒体事件同步
//   3. 有 YRC 时以 YRC 行/字时间为权威，暴露精确 karaokeTokens
//   4. 向桌面歌词窗口拆分推送静态时间轴快照与轻量媒体时钟
//   5. 桌面歌词窗口打开时 emit 'desktop-lyrics:request-snapshot'，
//               主窗收到后立即推一份最新快照，解决"打开瞬间空白"
//
// 设计原则：
//   - useAudioPlayer 内部已存在唯一的 <audio> 元素（由 player store 持有），
//     useLyric 每帧读取其权威 currentTime，不用墙钟推测媒体位置。
//   - 切歌时自动重置并重新拉取。
//   - 桌面歌词事件 emit 失败时静默（不影响主流程）。
//   - 引擎运行在 detached effect scope 中，是跨路由共享的全局单例；歌词面板
//     卸载不会让桌面歌词失去时钟和播放状态更新。

import {
  computed,
  effectScope,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { getLyric } from "@/composables/useNcmApi";
import { useDesktopLyricsPublisher } from "@/composables/useDesktopLyricsPublisher";
import {
  getYrcLineStartMs,
  getYrcLineText,
  parseLrc,
  parseLrcWithTranslation,
  parseYrc,
  type LyricLine,
} from "@/utils/lrcParser";
import {
  projectLyricFrame,
  type KaraokeToken,
} from "@/lyrics/lyricFrame";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import {
  alignLyricTimelines,
  areLyricTextsEquivalent,
} from "@/utils/lyricTiming";

// =============== 桌面歌词 Timeline Snapshot / Clock Anchor ===============

export type { KaraokeToken } from "@/lyrics/lyricFrame";

export interface UseLyricReturn {
  /** 解析后的歌词行 */
  lines: Ref<LyricLine[]>;
  /** 当前高亮行索引（-1 表示无） */
  activeLineIndex: Ref<number>;
  /** 当前行内精确卡拉 OK 字符级时间窗；无 YRC 时为空 */
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
  /** 重新拉取当前歌曲歌词（错误态手动重试） */
  retry: () => void;
  /** 主歌词面板挂载时申请逐帧更新；返回幂等释放函数 */
  acquireRealtimeUpdates: () => () => void;
  /** 主窗口收到桌面歌词快照请求时激活 publisher。 */
  activateDesktopLyricsPublisher: () => void;
  /** 跳转到指定时间（秒） */
  seekTo: (seconds: number) => void;
}

function createLyricEngine(): UseLyricReturn {
  const player = usePlayerStore();
  const theme = useThemeStore();

  // 时间轴只会整表替换，不需要把每一行/每个 token 深度代理。
  const lines = shallowRef<LyricLine[]>([]);
  const preciseTokensByLine = shallowRef<KaraokeToken[][]>([]);
  const activeLineIndex = ref<number>(-1);
  const progressMs = ref<number>(0);
  const loading = ref<boolean>(false);
  const error = ref<string>("");
  const currentSongId = ref<number | null>(null);

  const hasLyric = computed(() => lines.value.length > 0);

  const karaokeTokens = computed(() => {
    const idx = activeLineIndex.value;
    if (idx < 0 || idx >= lines.value.length) return [];
    return preciseTokensByLine.value[idx] ?? [];
  });

  interface ParsedLyricTimeline {
    lyricLines: LyricLine[];
    tokens: KaraokeToken[][];
  }

  interface CachedLyricTimeline extends ParsedLyricTimeline {
    expiresAt: number;
  }

  // 歌词在同一播放会话中很少变化，近期切回歌曲时无需再次请求和解析。
  // 失败不进入缓存；过期项在下次访问时删除，因此仍可正常重试。
  const LYRIC_CACHE_LIMIT = 12;
  const LYRIC_CACHE_TTL_MS = 60 * 60 * 1000;
  const timelineCache = new Map<number, CachedLyricTimeline>();
  const timelineLoads = new Map<number, Promise<ParsedLyricTimeline>>();

  function readCachedTimeline(songId: number): ParsedLyricTimeline | null {
    const cached = timelineCache.get(songId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      timelineCache.delete(songId);
      return null;
    }
    // Map 的插入顺序充当 LRU；命中时移到末尾。
    timelineCache.delete(songId);
    timelineCache.set(songId, cached);
    return { lyricLines: cached.lyricLines, tokens: cached.tokens };
  }

  function cacheTimeline(songId: number, timeline: ParsedLyricTimeline) {
    timelineCache.delete(songId);
    timelineCache.set(songId, {
      ...timeline,
      expiresAt: Date.now() + LYRIC_CACHE_TTL_MS,
    });
    while (timelineCache.size > LYRIC_CACHE_LIMIT) {
      const oldest = timelineCache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      timelineCache.delete(oldest);
    }
  }

  /**
   * YRC 存在时直接构建权威行时间轴，彻底避免用 20ms 容忍带把它挂到 LRC。
   * 行起点取首个可见字的绝对时间；token 再转成相对此行的时间窗。
   */
  function buildYrcTimeline(
    yrcText: string,
    lrcLines: LyricLine[],
    fallbackTextIsTranslation: boolean,
  ): { lyricLines: LyricLine[]; tokens: KaraokeToken[][] } | null {
    const parsed = parseYrc(yrcText);
    const rows = parsed
      .map((line) => {
        const text = getYrcLineText(line);
        const lineStart = getYrcLineStartMs(line);
        if (!text || !Number.isFinite(lineStart)) return null;

        const firstVisible = line.words.findIndex((word) => word.char.trim().length > 0);
        let lastVisible = line.words.length - 1;
        while (lastVisible >= 0 && line.words[lastVisible].char.trim().length === 0) {
          lastVisible -= 1;
        }
        const words = firstVisible >= 0
          ? line.words.slice(firstVisible, lastVisible + 1)
          : [];
        if (words.length === 0) return null;

        const lyricLine: LyricLine = {
          time: lineStart,
          text,
        };
        const tokens = words.map((word) => ({
          char: word.char,
          startMs: Math.max(0, word.startMs - lineStart),
          endMs: Math.max(0, word.startMs + word.duration - lineStart),
        }));
        return { lyricLine, tokens };
      })
      .filter((row): row is { lyricLine: LyricLine; tokens: KaraokeToken[] } => row !== null)
      .sort((a, b) => a.lyricLine.time - b.lyricLine.time);

    if (rows.length === 0) return null;

    const alignment = alignLyricTimelines(
      rows.map((row) => row.lyricLine),
      lrcLines,
      { lrcTextIsTranslation: fallbackTextIsTranslation },
    );
    const usedLrcIndexes = new Set<number>();
    rows.forEach((row, rowIndex) => {
      const matchedIndex = alignment.lrcIndexByYrc[rowIndex];
      if (matchedIndex === null) return;
      usedLrcIndexes.add(matchedIndex);
      const matched = lrcLines[matchedIndex];
      const translation = matched.translation ??
        (fallbackTextIsTranslation ? matched.text : undefined);
      if (translation) row.lyricLine.translation = translation;
    });

    // 部分损坏/缺行的 YRC 不能让普通 LRC 行消失；未配对行按行级歌词补回，
    // token 为空，因此 UI 会稳定显示文本而不会伪造逐字动画。
    if (fallbackTextIsTranslation && !alignment.reliable) {
      return {
        lyricLines: rows.map((row) => row.lyricLine),
        tokens: rows.map((row) => row.tokens),
      };
    }

    lrcLines.forEach((line, index) => {
      if (usedLrcIndexes.has(index)) return;
      const adjustedTime = Math.max(
        0,
        line.time + alignment.fallbackOffsetMs,
      );
      const duplicate = rows.find((row) =>
        Math.abs(row.lyricLine.time - adjustedTime) <= 1 &&
        (
          areLyricTextsEquivalent(row.lyricLine.text, line.text) ||
          row.lyricLine.text.trim() === line.text.trim()
        )
      );
      if (duplicate) {
        if (!duplicate.lyricLine.translation && line.translation) {
          duplicate.lyricLine.translation = line.translation;
        }
        return;
      }
      rows.push({
        lyricLine: { ...line, time: adjustedTime },
        tokens: [],
      });
    });
    rows.sort((a, b) => {
      const timeOrder = a.lyricLine.time - b.lyricLine.time;
      if (timeOrder !== 0) return timeOrder;
      // 二分定位取同时间的最后一行，因此精确 token 行必须排在最后。
      return Number(a.tokens.length > 0) - Number(b.tokens.length > 0);
    });

    return {
      lyricLines: rows.map((row) => row.lyricLine),
      tokens: rows.map((row) => row.tokens),
    };
  }

  async function resolveTimeline(songId: number): Promise<ParsedLyricTimeline> {
    const cached = readCachedTimeline(songId);
    if (cached) return cached;

    const pending = timelineLoads.get(songId);
    if (pending) return pending;

    const request = (async () => {
      const res = await getLyric(songId);
      const hasLrc = !!res.lrc;
      const lrcLines = hasLrc
        ? parseLrcWithTranslation(res.lrc, res.tLrc)
        : parseLrc(res.tLrc);
      const yrcTimeline = res.yLrc
        ? buildYrcTimeline(res.yLrc, lrcLines, !hasLrc && !!res.tLrc)
        : null;
      const timeline = yrcTimeline ?? {
        lyricLines: lrcLines,
        // 没有精确数据时不伪造逐字同步，只保留行级时间轴。
        tokens: [],
      };
      cacheTimeline(songId, timeline);
      return timeline;
    })();

    timelineLoads.set(songId, request);
    try {
      return await request;
    } finally {
      if (timelineLoads.get(songId) === request) timelineLoads.delete(songId);
    }
  }

  /** 拉取并解析歌词 */
  let lyricSeq = 0;
  const AUTO_RETRY_DELAYS_MS = [1500, 5000] as const;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  let retrySongId: number | null = null;

  function cancelRetryTimer() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function resetRetryState(songId: number | null) {
    cancelRetryTimer();
    retryAttempt = 0;
    retrySongId = songId;
  }

  function scheduleAutomaticRetry(songId: number) {
    if (
      retrySongId !== songId ||
      retryAttempt >= AUTO_RETRY_DELAYS_MS.length ||
      retryTimer
    ) {
      return;
    }
    const delay = AUTO_RETRY_DELAYS_MS[retryAttempt++];
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (player.currentSong?.id === songId) void loadFor(songId, true);
    }, delay);
  }

  async function loadFor(songId: number, force = false) {
    if (!force && songId === currentSongId.value) return;
    const seq = ++lyricSeq;
    currentSongId.value = songId;
    const cached = readCachedTimeline(songId);
    if (cached) {
      lines.value = cached.lyricLines;
      preciseTokensByLine.value = cached.tokens;
      activeLineIndex.value = -1;
      progressMs.value = 0;
      loading.value = false;
      error.value = "";
      cancelRetryTimer();
      return;
    }
    lines.value = [];
    preciseTokensByLine.value = [];
    activeLineIndex.value = -1;
    progressMs.value = 0;
    error.value = "";
    loading.value = true;
    try {
      const timeline = await resolveTimeline(songId);
      if (seq !== lyricSeq) return;
      lines.value = timeline.lyricLines;
      preciseTokensByLine.value = timeline.tokens;
      cancelRetryTimer();
    } catch (e) {
      if (seq !== lyricSeq) return;
      error.value = e instanceof Error ? e.message : "歌词加载失败";
      // Timeline 身份必须继续匹配当前媒体，这样桌面窗口能收到“已同步但
      // 暂无歌词”的空快照；显式 force 参数负责绕过同歌短路并继续重试。
      if (player.currentSong?.id === songId) {
        scheduleAutomaticRetry(songId);
      }
    } finally {
      if (seq === lyricSeq) loading.value = false;
    }
  }

  /** 监听当前歌曲变化：切歌时重新拉取 */
  watch(
    () => player.currentSong?.id ?? null,
    (id) => {
      if (retrySongId !== id) resetRetryState(id);
      if (id === null) {
        lyricSeq += 1;
        lines.value = [];
        preciseTokensByLine.value = [];
        activeLineIndex.value = -1;
        progressMs.value = 0;
        loading.value = false;
        error.value = "";
        currentSongId.value = null;
        return;
      }
      void loadFor(id);
    },
    { immediate: true }
  );

  function retry() {
    const songId = player.currentSong?.id ?? null;
    if (songId === null) return;
    resetRetryState(songId);
    error.value = "";
    void loadFor(songId, true);
  }

  function positionFor(positionMs: number): {
    index: number;
    lineProgressMs: number;
  } {
    const frame = projectLyricFrame(
      {
        lines: lines.value,
        tokensByLine: preciseTokensByLine.value,
      },
      positionMs,
    );
    return {
      index: frame.activeLineIndex,
      lineProgressMs: frame.lineProgressMs,
    };
  }

  /**
   * 主窗口权威歌词时钟。只有正在播放且页面可见时才运行 rAF；暂停、缓冲、
   * 最小化或后台标签页依靠媒体 timeupdate 与离散状态事件同步，避免全局单例
   * 在用户看不到歌词时仍永久占用 60fps。
   */
  const clockMs = ref(0);
  const mediaPlaybackRate = ref(1);
  let clockRaf = 0;
  let realtimeConsumerCount = 0;

  function isDocumentVisible() {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }

  function shouldRunClockRaf() {
    return realtimeConsumerCount > 0 &&
      isDocumentVisible() &&
      player.audioState.playing &&
      !player.audioState.loading;
  }

  function syncClockFromMedia() {
    const sample = player.getMediaClockSample();
    clockMs.value = sample.positionMs;
    mediaPlaybackRate.value = sample.playbackRate;
  }

  function stopClockRaf() {
    if (clockRaf) cancelAnimationFrame(clockRaf);
    clockRaf = 0;
  }

  function clockTick() {
    clockRaf = 0;
    if (!shouldRunClockRaf()) return;
    syncClockFromMedia();
    clockRaf = requestAnimationFrame(clockTick);
  }

  function updateClockRaf() {
    if (!shouldRunClockRaf()) {
      stopClockRaf();
      return;
    }
    if (!clockRaf) clockRaf = requestAnimationFrame(clockTick);
  }

  function acquireRealtimeUpdates() {
    let released = false;
    realtimeConsumerCount += 1;
    syncClockFromMedia();
    updateClockRaf();
    return () => {
      if (released) return;
      released = true;
      realtimeConsumerCount = Math.max(0, realtimeConsumerCount - 1);
      syncClockFromMedia();
      updateClockRaf();
    };
  }

  // 用权威媒体时钟算 activeLineIndex + progressMs。歌词异步加载完成时 lines
  // 也会触发重算，因此暂停状态加载歌词不会一直停在 -1。
  watch(
    [clockMs, lines],
    ([ms]) => {
      const position = positionFor(ms);
      activeLineIndex.value = position.index;
      progressMs.value = position.lineProgressMs;
    },
  );

  // 后台/暂停不运行 rAF，原生 timeupdate 是低频且权威的同步来源。
  watch(
    () => player.audioState.currentTime,
    () => {
      if (!shouldRunClockRaf()) syncClockFromMedia();
    },
    { flush: "sync" },
  );

  // 主窗口 projection 的 rAF 生命周期只由主窗口消费者和媒体状态控制。
  watch(
    [
      () => player.currentSong?.id ?? null,
      () => player.audioState.currentSongId,
      () => player.audioState.playing,
      () => player.audioState.loading,
      () => player.audioState.seekRevision,
    ],
    () => {
      syncClockFromMedia();
      updateClockRaf();
    },
    { flush: "sync" },
  );

  const desktopLyricsPublisher = useDesktopLyricsPublisher({
    currentSong: () => player.currentSong ?? null,
    timelineSongId: () => currentSongId.value,
    lines: () => lines.value,
    tokensByLine: () => preciseTokensByLine.value,
    desktopAccent: () => theme.desktopAccent,
    clockSample: player.getMediaClockSample,
    mediaSongId: () => player.audioState.currentSongId,
    playing: () => player.audioState.playing,
    loading: () => player.audioState.loading,
    seekRevision: () => player.audioState.seekRevision,
    playbackRate: () => mediaPlaybackRate.value,
  });

  const onVisibilityChange = () => {
    syncClockFromMedia();
    updateClockRaf();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  syncClockFromMedia();
  updateClockRaf();

  onScopeDispose(() => {
    cancelRetryTimer();
    stopClockRaf();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  });

  /** 点击某行歌词 → 跳转播放 */
  function seekTo(seconds: number) {
    player.seek(seconds);
  }

  return {
    lines,
    activeLineIndex,
    karaokeTokens,
    progressMs,
    loading,
    error,
    hasLyric,
    retry,
    acquireRealtimeUpdates,
    activateDesktopLyricsPublisher: desktopLyricsPublisher.activate,
    seekTo,
  };
}

let lyricEngine: UseLyricReturn | null = null;
let lyricEngineScope: ReturnType<typeof effectScope> | null = null;

/**
 * 获取跨路由共享的歌词引擎。detached scope 不会随任意 LyricPanel 卸载，
 * 因此桌面歌词在搜索、歌单或其它页面之间切换时仍能收到权威状态。
 */
export function useLyric(): UseLyricReturn {
  if (lyricEngine) return lyricEngine;
  lyricEngineScope = effectScope(true);
  const engine = lyricEngineScope.run(createLyricEngine);
  if (!engine) throw new Error("歌词引擎初始化失败");
  lyricEngine = engine;
  return engine;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    lyricEngineScope?.stop();
    lyricEngineScope = null;
    lyricEngine = null;
  });
}
