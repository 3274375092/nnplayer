import type { LyricLine } from "@/utils/lrcParser";
import { getKaraokeTokenProgress } from "@/utils/lyricTiming";

export interface KaraokeToken {
  char: string;
  startMs: number;
  endMs: number;
}

export interface LyricTimeline {
  lines: readonly LyricLine[];
  tokensByLine: readonly (readonly KaraokeToken[])[];
}

export interface LyricFrame {
  positionMs: number;
  activeLineIndex: number;
  lineProgressMs: number;
  tokens: readonly KaraokeToken[];
}

/**
 * Render-ready token data for one Lyric Frame. It deliberately contains no
 * CSS or framework state, so both WebViews can consume the same projection.
 */
export interface ProjectedKaraokeToken {
  readonly char: string;
  progress: number;
}

export interface ProjectedKaraokeFrame {
  readonly tokens: readonly ProjectedKaraokeToken[];
}

export interface KaraokeFrameProjector {
  /**
   * Project the active line without rebuilding its token array every frame.
   * The returned frame shell is ephemeral; token array/object identities stay
   * stable until the source token array changes.
   */
  project: (
    tokens: readonly KaraokeToken[],
    lineProgressMs: number,
  ) => ProjectedKaraokeFrame;
}

const EMPTY_TOKENS: readonly KaraokeToken[] = Object.freeze([]);
const EMPTY_PROJECTED_TOKENS: readonly ProjectedKaraokeToken[] = Object.freeze([]);
const EMPTY_PROJECTED_FRAME: ProjectedKaraokeFrame = Object.freeze({
  tokens: EMPTY_PROJECTED_TOKENS,
});

export function projectLyricFrame(
  timeline: LyricTimeline,
  positionMs: number,
): LyricFrame {
  let low = 0;
  let high = timeline.lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timeline.lines[middle].time <= positionMs) low = middle + 1;
    else high = middle;
  }

  const activeLineIndex = low - 1;
  const line = timeline.lines[activeLineIndex];
  return {
    positionMs,
    activeLineIndex,
    lineProgressMs: line ? Math.max(0, positionMs - line.time) : 0,
    tokens: timeline.tokensByLine[activeLineIndex] ?? EMPTY_TOKENS,
  };
}

/**
 * Create a caller-owned karaoke projector.
 *
 * Each WebView owns its projector, so projecting the same Lyric Timeline at
 * different Playback Positions cannot mutate another consumer's frame. Token
 * data is rebuilt only when the active source array changes; steady-state
 * projection mutates the cached progress scalars and allocates one small frame
 * shell so reactive renderers observe each Playback Position update.
 */
export function createKaraokeFrameProjector(): KaraokeFrameProjector {
  let sourceTokens: readonly KaraokeToken[] = EMPTY_TOKENS;
  let projectedTokens: ProjectedKaraokeToken[] = [];

  function rebuild(tokens: readonly KaraokeToken[]) {
    sourceTokens = tokens;
    projectedTokens = tokens.map((token) => ({
      char: token.char,
      progress: 0,
    }));
  }

  function project(
    tokens: readonly KaraokeToken[],
    lineProgressMs: number,
  ): ProjectedKaraokeFrame {
    if (tokens.length === 0) {
      sourceTokens = EMPTY_TOKENS;
      projectedTokens = [];
      return EMPTY_PROJECTED_FRAME;
    }
    if (tokens !== sourceTokens) rebuild(tokens);

    for (let index = 0; index < sourceTokens.length; index += 1) {
      projectedTokens[index].progress = getKaraokeTokenProgress(
        sourceTokens[index],
        lineProgressMs,
      );
    }

    return { tokens: projectedTokens };
  }

  return { project };
}
