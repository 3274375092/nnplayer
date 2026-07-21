export type DesktopLyricsSyncStatus = "idle" | "syncing" | "ready";

export interface MediaClockSample {
  mediaGeneration: number;
  songId: number | null;
  positionMs: number;
  playbackRate: number;
  playing: boolean;
  loading: boolean;
  seekRevision: number;
  sampledAt: number;
}

export interface AuthoritativeMediaClock {
  currentTime: number;
  playbackRate: number;
}

export interface MediaClockState {
  currentSongId: number | null;
  playing: boolean;
  loading: boolean;
  seekRevision: number;
}

export interface DesktopLyricsClockAnchor {
  sessionId: string;
  sessionGeneration: number;
  songId: number | null;
  sequence: number;
  timelineRevision: number;
  mediaGeneration: number;
  positionMs: number;
  sampledAt: number;
  playbackRate: number;
  seekRevision: number;
  playing: boolean;
}

export interface DesktopLyricsTimelineSnapshot
  extends DesktopLyricsClockAnchor {
  songName: string;
  artists: string;
  lines: readonly { time: number; text: string; translation?: string }[];
  tokensByLine: readonly (readonly {
    char: string;
    startMs: number;
    endMs: number;
  }[])[];
}

export interface DesktopLyricsReceiverState {
  status: DesktopLyricsSyncStatus;
  revision: number;
  sessionId: string;
  sessionGeneration: number;
  songId: number | null;
  sequence: number;
  timelineRevision: number;
  mediaGeneration: number;
  songName: string;
  artists: string;
  lines: DesktopLyricsTimelineSnapshot["lines"];
  tokensByLine: DesktopLyricsTimelineSnapshot["tokensByLine"];
  positionMs: number;
  sampledAt: number;
  playbackRate: number;
  seekRevision: number;
  playing: boolean;
}

export interface ClockAnchorReceipt {
  wallTimeMs: number;
  monotonicTimeMs: number;
}

export interface DesktopLyricsTimelineSource {
  songId: number | null;
  timelineSongId: number | null;
  songName: string;
  artists: string;
  lines: DesktopLyricsTimelineSnapshot["lines"];
  tokensByLine: DesktopLyricsTimelineSnapshot["tokensByLine"];
}

/**
 * Sample a Clock Anchor only from the active media element. Queue/loading state
 * can identify a requested song before its audio exists, but it is not an
 * authoritative Playback Position and therefore produces an idle sample.
 */
export function sampleAuthoritativeMediaClock(
  media: AuthoritativeMediaClock | null,
  mediaGeneration: number,
  state: MediaClockState,
  sampledAt: number,
): MediaClockSample {
  const currentTime = media?.currentTime;
  const hasAuthoritativeMedia = media !== null &&
    Number.isSafeInteger(state.currentSongId) &&
    (state.currentSongId as number) > 0 &&
    typeof currentTime === "number" &&
    Number.isFinite(currentTime) &&
    currentTime >= 0;
  if (!hasAuthoritativeMedia) {
    return {
      mediaGeneration,
      songId: null,
      positionMs: 0,
      playbackRate: 1,
      playing: false,
      loading: state.loading,
      seekRevision: state.seekRevision,
      sampledAt,
    };
  }

  const playbackRate = media.playbackRate;
  return {
    mediaGeneration,
    songId: state.currentSongId,
    positionMs: currentTime * 1000,
    playbackRate: Number.isFinite(playbackRate) && playbackRate > 0
      ? playbackRate
      : 1,
    playing: state.playing && !state.loading,
    loading: state.loading,
    seekRevision: state.seekRevision,
    sampledAt,
  };
}

const EMPTY_LINES: DesktopLyricsReceiverState["lines"] = Object.freeze([]);
const EMPTY_TOKENS: DesktopLyricsReceiverState["tokensByLine"] = Object.freeze([]);

/**
 * Produce a comparable generation even when Web Storage is unavailable after
 * a full WebView reload. Epoch time is a floor, while persisted/realm values
 * preserve strict monotonicity for multiple sessions created in one tick.
 */
export function computeNextLyricSessionGeneration(
  previousGenerations: readonly unknown[],
  wallTimeMs: number,
): number {
  let greatest = Number.isSafeInteger(wallTimeMs) && wallTimeMs >= 0
    ? wallTimeMs
    : 0;
  for (const candidate of previousGenerations) {
    if (
      Number.isSafeInteger(candidate) &&
      (candidate as number) >= 0 &&
      (candidate as number) > greatest
    ) {
      greatest = candidate as number;
    }
  }
  if (greatest >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Lyric Session generation space exhausted");
  }
  return greatest + 1;
}

/**
 * Assemble a protocol-safe Timeline Snapshot from independently changing queue,
 * media and lyric state. An unloaded media element is genuinely idle: queued
 * song metadata must not make a desktop window render lyrics for audio that is
 * not the authoritative playback source yet.
 */
export function buildDesktopLyricsTimelineSnapshot(
  anchor: DesktopLyricsClockAnchor,
  source: DesktopLyricsTimelineSource,
): DesktopLyricsTimelineSnapshot | null {
  if (anchor.songId === null) {
    return {
      ...anchor,
      songName: "",
      artists: "",
      lines: EMPTY_LINES,
      tokensByLine: EMPTY_TOKENS,
    };
  }
  if (
    source.songId !== anchor.songId ||
    source.timelineSongId !== anchor.songId
  ) {
    return null;
  }
  return {
    ...anchor,
    songName: source.songName,
    artists: source.artists,
    lines: source.lines,
    tokensByLine: source.tokensByLine,
  };
}

function emptyState(): DesktopLyricsReceiverState {
  return {
    status: "idle",
    revision: 0,
    sessionId: "",
    sessionGeneration: 0,
    songId: null,
    sequence: -1,
    timelineRevision: 0,
    mediaGeneration: 0,
    songName: "",
    artists: "",
    lines: EMPTY_LINES,
    tokensByLine: EMPTY_TOKENS,
    positionMs: 0,
    sampledAt: 0,
    playbackRate: 1,
    seekRevision: 0,
    playing: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClockAnchor(
  value: unknown,
): value is DesktopLyricsClockAnchor | DesktopLyricsTimelineSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    Number.isSafeInteger(value.sessionGeneration) &&
    (value.sessionGeneration as number) > 0 &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    Number.isSafeInteger(value.timelineRevision) &&
    (value.timelineRevision as number) >= 0 &&
    Number.isSafeInteger(value.mediaGeneration) &&
    (value.mediaGeneration as number) >= 0 &&
    (value.songId === null || Number.isSafeInteger(value.songId)) &&
    Number.isFinite(value.positionMs) &&
    (value.positionMs as number) >= 0 &&
    Number.isFinite(value.sampledAt) &&
    (value.sampledAt as number) > 0 &&
    Number.isFinite(value.playbackRate) &&
    (value.playbackRate as number) > 0 &&
    Number.isSafeInteger(value.seekRevision) &&
    (value.seekRevision as number) >= 0 &&
    typeof value.playing === "boolean";
}

function isTimelineSnapshot(
  value: unknown,
): value is DesktopLyricsTimelineSnapshot {
  if (
    !isRecord(value) ||
    typeof value.songName !== "string" ||
    typeof value.artists !== "string" ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.tokensByLine) ||
    !isClockAnchor(value)
  ) {
    return false;
  }

  let previousLineTime = -Infinity;
  for (const line of value.lines) {
    if (
      !isRecord(line) ||
      !Number.isFinite(line.time) ||
      (line.time as number) < 0 ||
      (line.time as number) < previousLineTime ||
      typeof line.text !== "string" ||
      (line.translation !== undefined &&
        typeof line.translation !== "string")
    ) {
      return false;
    }
    previousLineTime = line.time as number;
  }

  for (const tokens of value.tokensByLine) {
    if (!Array.isArray(tokens)) return false;
    for (const token of tokens) {
      if (
        !isRecord(token) ||
        typeof token.char !== "string" ||
        !Number.isFinite(token.startMs) ||
        (token.startMs as number) < 0 ||
        !Number.isFinite(token.endMs) ||
        (token.endMs as number) < (token.startMs as number)
      ) {
        return false;
      }
    }
  }
  return true;
}

export function createDesktopLyricsReceiver() {
  let current = emptyState();

  function acceptsSession(observation: DesktopLyricsClockAnchor): boolean {
    if (!current.sessionId) return true;
    if (observation.sessionGeneration < current.sessionGeneration) return false;
    if (
      observation.sessionGeneration === current.sessionGeneration &&
      observation.sessionId !== current.sessionId
    ) {
      return false;
    }
    return true;
  }

  function receiveClock(anchor: unknown): void {
    if (!isClockAnchor(anchor) || !acceptsSession(anchor)) return;
    if (
      anchor.sessionId === current.sessionId &&
      anchor.sessionGeneration === current.sessionGeneration &&
      anchor.sequence <= current.sequence
    ) {
      return;
    }
    const timelineMatches = current.status === "ready" &&
      current.sessionId === anchor.sessionId &&
      current.songId === anchor.songId &&
      current.timelineRevision === anchor.timelineRevision;
    current = {
      ...current,
      status: anchor.songId === null
        ? "idle"
        : timelineMatches
        ? "ready"
        : "syncing",
      revision: current.revision + 1,
      sessionId: anchor.sessionId,
      sessionGeneration: anchor.sessionGeneration,
      songId: anchor.songId,
      sequence: anchor.sequence,
      timelineRevision: anchor.timelineRevision,
      mediaGeneration: anchor.mediaGeneration,
      songName: timelineMatches ? current.songName : "",
      artists: timelineMatches ? current.artists : "",
      lines: timelineMatches ? current.lines : EMPTY_LINES,
      tokensByLine: timelineMatches ? current.tokensByLine : EMPTY_TOKENS,
      positionMs: anchor.positionMs,
      sampledAt: anchor.sampledAt,
      playbackRate: anchor.playbackRate,
      seekRevision: anchor.seekRevision,
      playing: anchor.playing,
    };
  }

  function receiveSnapshot(snapshot: unknown): void {
    if (!isTimelineSnapshot(snapshot) || !acceptsSession(snapshot)) return;
    const sameSession = snapshot.sessionId === current.sessionId &&
      snapshot.sessionGeneration === current.sessionGeneration;
    if (
      sameSession &&
      (
        snapshot.timelineRevision < current.timelineRevision ||
        (
          snapshot.timelineRevision === current.timelineRevision &&
          current.status === "ready" &&
          snapshot.sequence <= current.sequence
        )
      )
    ) {
      return;
    }
    if (
      sameSession &&
      snapshot.songId !== current.songId &&
      snapshot.sequence < current.sequence
    ) {
      return;
    }
    const keepNewerClock = snapshot.sessionId === current.sessionId &&
      snapshot.sessionGeneration === current.sessionGeneration &&
      snapshot.songId === current.songId &&
      snapshot.sequence < current.sequence;
    const isIdle = snapshot.songId === null;
    current = {
      status: isIdle ? "idle" : "ready",
      revision: current.revision + 1,
      sessionId: snapshot.sessionId,
      sessionGeneration: snapshot.sessionGeneration,
      songId: snapshot.songId,
      sequence: keepNewerClock ? current.sequence : snapshot.sequence,
      timelineRevision: snapshot.timelineRevision,
      mediaGeneration: keepNewerClock
        ? current.mediaGeneration
        : snapshot.mediaGeneration,
      songName: isIdle ? "" : snapshot.songName,
      artists: isIdle ? "" : snapshot.artists,
      lines: isIdle ? EMPTY_LINES : snapshot.lines,
      tokensByLine: isIdle ? EMPTY_TOKENS : snapshot.tokensByLine,
      positionMs: keepNewerClock ? current.positionMs : snapshot.positionMs,
      sampledAt: keepNewerClock ? current.sampledAt : snapshot.sampledAt,
      playbackRate: keepNewerClock
        ? current.playbackRate
        : snapshot.playbackRate,
      seekRevision: keepNewerClock
        ? current.seekRevision
        : snapshot.seekRevision,
      playing: keepNewerClock ? current.playing : snapshot.playing,
    };
  }

  return {
    get state(): DesktopLyricsReceiverState {
      return current;
    },
    receiveClock,
    receiveSnapshot,
  };
}

export function createAnchoredPlaybackClock(maxTransportAgeMs = 5000) {
  let anchorPositionMs = 0;
  let anchorMonotonicTimeMs = 0;
  let playbackRate = 1;
  let playing = false;

  function accept(
    anchor: DesktopLyricsClockAnchor,
    receipt: ClockAnchorReceipt,
  ): { needsRefresh: boolean } {
    const transportAgeMs = receipt.wallTimeMs - anchor.sampledAt;
    const transportAgeIsValid = Number.isFinite(transportAgeMs) &&
      transportAgeMs >= 0 &&
      transportAgeMs <= maxTransportAgeMs;
    playbackRate = Number.isFinite(anchor.playbackRate) &&
        anchor.playbackRate > 0
      ? anchor.playbackRate
      : 1;
    playing = anchor.playing;
    anchorPositionMs = Math.max(
      0,
      anchor.positionMs +
        (playing && transportAgeIsValid ? transportAgeMs * playbackRate : 0),
    );
    anchorMonotonicTimeMs = receipt.monotonicTimeMs;
    return { needsRefresh: !transportAgeIsValid };
  }

  function positionAt(monotonicTimeMs: number): number {
    if (!playing) return anchorPositionMs;
    const elapsedMs = Math.max(0, monotonicTimeMs - anchorMonotonicTimeMs);
    return anchorPositionMs + elapsedMs * playbackRate;
  }

  return { accept, positionAt };
}
