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
import { getLyric } from "@/composables/useNcmApi";
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
// 触发器指向"最后一个活跃 useLyric 实例"的推送函数（多个组件共享 playerStore，
// 行为一致，无需担心漂移）。

let _pushDesktopLyrics: (() => void) | null = null;

export function triggerDesktopLyricsPush() {
  _pushDesktopLyrics?.();
}

export interface UseLyricReturn {
  /** 解析后的歌词行 */
  lines: Ref<LyricLine[]>;
  /** 当前高亮行索引（-1 表示无） */
  activeLineIndex: Ref<number>;
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
  const player = usePlayerStore();

  const lines = ref<LyricLine[]>([]);
  const yrcLines = shallowRef<ReturnType<typeof parseYrc>>([]);
  const activeLineIndex = ref<number>(-1);
  const progressMs = ref<number>(0);
  const loading = ref<boolean>(false);
  const error = ref<string>("");
  const currentSongId = ref<number | null>(null);

  const hasLyric = computed(() => lines.value.length > 0);

  const karaokeTokens = computed(() => {
    const idx = activeLineIndex.value;
    if (idx < 0 || idx >= lines.value.length) return [];
    const cur = lines.value[idx];

    // 优先使用 YRC 逐字时间戳（转成行内相对偏移）
    const yrcLine = yrcLines.value.find(
      (yl) => Math.abs(yl.time - cur.time) < 20,
    );
    if (yrcLine && yrcLine.words.length > 0) {
      return yrcLine.words.map((w) => ({
        char: w.char,
        startMs: w.startMs - cur.time,
        endMs: w.startMs + w.duration - cur.time,
      }));
    }

    // 回退：伪卡拉OK 等分
    const next = idx + 1 < lines.value.length ? lines.value[idx + 1] : null;
    const nextMs = next ? next.time : -1;
    const tokens = parseKaraokeLine(cur.text, cur.time, nextMs);
    return tokens.map((t) => ({
      char: t.char,
      startMs: t.startMs - cur.time,
      endMs: t.endMs - cur.time,
    }));
  });

  /** 拉取并解析歌词 */
  let lyricSeq = 0;

  async function loadFor(songId: number) {
    const seq = ++lyricSeq;
    if (songId === currentSongId.value && seq > 1) return;
    currentSongId.value = songId;
    lines.value = [];
    activeLineIndex.value = -1;
    progressMs.value = 0;
    error.value = "";
    loading.value = true;
    try {
      const res = await getLyric(songId);
      if (seq !== lyricSeq) return;
      // 原文优先；只有翻译无原文时退化为用翻译当主歌词（保持旧行为兼容）。
      // 正常外文歌：lrc=原文、tLrc=翻译 → 双语显示。
      const hasLrc = !!res.lrc;
      lines.value = hasLrc
        ? parseLrcWithTranslation(res.lrc, res.tLrc)
        : parseLrc(res.tLrc);
      if (res.yLrc) {
        yrcLines.value = parseYrc(res.yLrc);
      } else {
        yrcLines.value = [];
      }
    } catch (e) {
      if (seq !== lyricSeq) return;
      error.value = e instanceof Error ? e.message : "歌词加载失败";
    } finally {
      if (seq === lyricSeq) loading.value = false;
    }
  }

  /** 监听当前歌曲变化：切歌时重新拉取 */
  watch(
    () => player.currentSong?.id ?? null,
    (id) => {
      if (id === null) {
        lines.value = [];
        activeLineIndex.value = -1;
        progressMs.value = 0;
        currentSongId.value = null;
        return;
      }
      void loadFor(id);
    },
    { immediate: true }
  );

  /**
   * rAF 播放时钟：用 audio.currentTime 做 snap 锚点，performance.now() 墙钟插值。
   *
   * timeupdate 只有 4Hz、且滞后实时约 100~250ms，直接用它算 activeLineIndex 会让
   * 行切换晚 100~250ms（"歌到下一行了、显示还在上一行末尾"）。rAF 60fps 插值后，
   * 行切换精度提到 ~16ms，progressMs 也连续，卡拉OK 更顺。
   *
   * 同理推给桌面歌词窗的 progressMs 也更实时（子窗 anchor 更准）。
   *
   * snap 策略（关键是吸收 timeupdate 抖动，避免冲过头 → 闪回）：
   *   - seek/切歌/首帧 (|delta| > SEEK_MS) → 强制对齐 audio 权威值
   *   - playing 状态变化 → 以当前 clockMs 重新锚定（不跳值）
   *   - audio 落后 clock (delta < -TOLERANCE) → audio 滞后，anchor 完全不动
   *   - audio 领先 clock (delta > TOLERANCE) → 平滑追赶（anchor 取中点）
   *   - |delta| <= TOLERANCE → 抖动带内，anchor 完全不动，rAF 自走
   *
   * 关键不变量：clockAnchorTs 只在 clockAnchorMs 被更新时才同步更新。
   * 若"保持 anchor"分支也重置 clockAnchorTs，会导致 clockMs 每帧被重置回
   * clockAnchorMs（过去设的锚点），rAF 再往前跑、下次 timeupdate 又跳回 →
   * 4Hz 周期性闪回。两个 anchor 要么一起更新，要么都不动。
   */
  const clockMs = ref(0);
  let clockAnchorMs = 0;
  let clockAnchorTs = 0;
  let clockPlaying = false;
  let clockRaf = 0;
  const SEEK_MS = 800;
  /** timeupdate 抖动容忍带：|delta| 在此范围内视为噪声，anchor 不动。 */
  const TOLERANCE_MS = 120;

  function snapClock(force: boolean) {
    const audioMs = player.audioState.currentTime * 1000;
    const delta = audioMs - clockMs.value;
    const now = performance.now();
    const playing = player.audioState.playing;

    if (force || Math.abs(delta) > SEEK_MS) {
      // seek / 切歌 / 首帧 → 对齐 audio 权威值
      clockAnchorMs = audioMs;
      clockAnchorTs = now;
      clockMs.value = audioMs;
    } else if (playing !== clockPlaying) {
      // 播放/暂停切换 → 以当前 clockMs 重新锚定，值不跳
      clockAnchorMs = clockMs.value;
      clockAnchorTs = now;
    } else if (delta > TOLERANCE_MS) {
      // audio 明显领先 → 平滑追赶：anchor 取 clock 与 audio 的中点，
      // 让 rAF 在 ~1 帧内追上，而非直接跳到 audio 值（避免抖动被放大）
      clockAnchorMs = (clockMs.value + audioMs) / 2;
      clockAnchorTs = now;
    }
    // |delta| <= TOLERANCE_MS（抖动带）或 delta < -TOLERANCE_MS（audio 滞后）
    // → anchorMs 和 anchorTs 都不动，rAF 继续按墙钟自走（不重置！）
    clockPlaying = playing;
  }

  function clockTick() {
    if (clockPlaying) {
      clockMs.value = clockAnchorMs + (performance.now() - clockAnchorTs);
    } else {
      clockMs.value = clockAnchorMs;
    }
    clockRaf = requestAnimationFrame(clockTick);
  }

  // timeupdate / playing 变化 → snap 锚点
  watch(
    [() => player.audioState.currentTime, () => player.audioState.playing],
    () => snapClock(false),
  );

  // 用插值时钟算 activeLineIndex + progressMs（60fps，行边界及时切换）
  watch(
    clockMs,
    (ms) => {
      if (lines.value.length === 0) {
        activeLineIndex.value = -1;
        progressMs.value = 0;
        return;
      }
      const currentMs = ms;
      const idx = findActiveLineIndex(lines.value, Math.floor(currentMs));
      activeLineIndex.value = idx;
      if (idx >= 0) {
        const lineTime = lines.value[idx].time;
        const next = lines.value[idx + 1];
        const nextTime = next ? next.time : lineTime + 5000;
        progressMs.value = Math.max(
          0,
          Math.min(nextTime - lineTime, currentMs - lineTime),
        );
      } else {
        progressMs.value = 0;
      }
    },
  );

  /**
   * 阶段3：向桌面歌词窗口推送更新。
   * 节流到 250ms，避免 4Hz timeupdate 高频 IPC。
   * 行切换（activeLineIndex 变）走 flushPush 立即推，避免新行首字延迟。
   */
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  function buildPayload(): DesktopLyricsPayload {
    const idx = activeLineIndex.value;
    const currentLine = idx >= 0 && idx < lines.value.length
      ? lines.value[idx]
      : null;
    const nextLine = idx + 1 < lines.value.length
      ? lines.value[idx + 1]
      : null;
    const lineTime = currentLine ? currentLine.time : 0;
    const nextTime = nextLine ? nextLine.time : lineTime + 5000;
    const span = Math.max(1, nextTime - lineTime);
    const progress = idx >= 0
      ? Math.max(0, Math.min(1, progressMs.value / span))
      : 0;

    return {
      current: currentLine?.text ?? "",
      next: nextLine?.text ?? "",
      progress,
      songName: player.currentSong?.name ?? "",
      artists: player.currentSong?.artists ?? "",
      lines: lines.value,
      activeLineIndex: idx,
      progressMs: progressMs.value,
      karaokeTokens: karaokeTokens.value,
      accentColor: readThemeAccentFromDOM(),
      playing: player.audioState.playing,
    };
  }

  function sendPush() {
    if (!isTauri()) return;
    void emit("desktop-lyrics:update", buildPayload()).catch(() => {});
  }

  function pushUpdateToDesktop() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      sendPush();
    }, 250);
  }

  /** 立即推送一次并清掉节流队列（行切换等关键事件用） */
  function flushPush() {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = undefined;
    }
    sendPush();
  }

  /** 监听变化主动推送：观察整首歌变化、活跃行、行内进度、歌词数组 */
  watch(
    [
      () => player.currentSong,
      activeLineIndex,
      progressMs,
      lines,
    ],
    () => {
      pushUpdateToDesktop();
    },
  );

  /** 行切换立即推一次，避免新行首字延迟（绕过 250ms 节流） */
  watch(activeLineIndex, () => {
    flushPush();
  });

  // 注册最新推送函数，供 request-snapshot 时调用。
  // 多个组件都 useLyric() 时，最后一个活跃实例的引用生效（它们观察同一个
  // playerStore，行为一致）。
  _pushDesktopLyrics = pushUpdateToDesktop;

  onMounted(() => {
    snapClock(true);
    clockRaf = requestAnimationFrame(clockTick);
  });

  onBeforeUnmount(() => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = undefined;
    if (clockRaf) cancelAnimationFrame(clockRaf);
    clockRaf = 0;
    if (_pushDesktopLyrics === pushUpdateToDesktop) {
      _pushDesktopLyrics = null;
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
    seekTo,
  };
}