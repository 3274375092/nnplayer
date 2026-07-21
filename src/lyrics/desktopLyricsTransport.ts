export interface DesktopLyricsTransportWatchdogRuntime<TimerHandle> {
  now: () => number;
  schedule: (delayMs: number, task: () => void) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
  onStale: () => void;
}

export interface DesktopLyricsTransportWatchdogOptions {
  staleAfterMs?: number;
  retryEveryMs?: number;
}

export interface DesktopLyricsSnapshotRecoveryRuntime<TimerHandle> {
  now: () => number;
  request: (songId: number | null) => void;
  schedule: (delayMs: number, task: () => void) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
}

export interface DesktopLyricsSnapshotRecoveryOptions
  extends DesktopLyricsTransportWatchdogOptions {
  burstRetryDelaysMs?: readonly number[];
}

/**
 * Detect a silent desktop-lyrics transport and keep retrying the snapshot
 * handshake until a valid protocol observation proves that the channel is alive.
 */
export function createDesktopLyricsTransportWatchdog<TimerHandle>(
  runtime: DesktopLyricsTransportWatchdogRuntime<TimerHandle>,
  options: DesktopLyricsTransportWatchdogOptions = {},
) {
  const staleAfterMs = options.staleAfterMs ?? 5_000;
  const retryEveryMs = options.retryEveryMs ?? 2_000;
  let lastAliveAt = runtime.now();
  let handle: TimerHandle | undefined;
  let started = false;
  let disposed = false;

  function cancelPending() {
    if (handle !== undefined) runtime.cancel(handle);
    handle = undefined;
  }

  function schedule(delayMs: number) {
    cancelPending();
    handle = runtime.schedule(delayMs, check);
  }

  function check() {
    handle = undefined;
    if (disposed || !started) return;
    const ageMs = Math.max(0, runtime.now() - lastAliveAt);
    if (ageMs < staleAfterMs) {
      schedule(staleAfterMs - ageMs);
      return;
    }
    runtime.onStale();
    schedule(retryEveryMs);
  }

  function start() {
    if (disposed || started) return;
    started = true;
    lastAliveAt = runtime.now();
    schedule(staleAfterMs);
  }

  function noteAlive() {
    if (disposed) return;
    lastAliveAt = runtime.now();
    if (started) schedule(staleAfterMs);
  }

  function dispose() {
    disposed = true;
    started = false;
    cancelPending();
  }

  return { start, noteAlive, dispose };
}

/**
 * Own the complete Timeline Snapshot recovery lifecycle: a short request burst
 * for fast handshakes plus recurring cycles while the transport stays silent.
 */
export function createDesktopLyricsSnapshotRecovery<TimerHandle>(
  runtime: DesktopLyricsSnapshotRecoveryRuntime<TimerHandle>,
  options: DesktopLyricsSnapshotRecoveryOptions = {},
) {
  const burstRetryDelaysMs = options.burstRetryDelaysMs ?? [500, 1500];
  const burstHandles = new Set<TimerHandle>();
  let pendingSongId: number | null | undefined;
  let currentSongId: number | null = null;
  let started = false;
  let disposed = false;

  function clearBurst() {
    burstHandles.forEach((handle) => runtime.cancel(handle));
    burstHandles.clear();
    pendingSongId = undefined;
  }

  function ensure(songId: number | null) {
    if (disposed) return;
    currentSongId = songId;
    if (pendingSongId === songId && burstHandles.size > 0) return;
    clearBurst();
    pendingSongId = songId;
    runtime.request(songId);
    for (const delayMs of burstRetryDelaysMs) {
      const handle = runtime.schedule(delayMs, () => {
        burstHandles.delete(handle);
        if (disposed || pendingSongId !== songId) return;
        runtime.request(songId);
        if (burstHandles.size === 0) pendingSongId = undefined;
      });
      burstHandles.add(handle);
    }
    if (burstHandles.size === 0) pendingSongId = undefined;
  }

  const watchdog = createDesktopLyricsTransportWatchdog(
    {
      now: runtime.now,
      schedule: runtime.schedule,
      cancel: runtime.cancel,
      onStale: () => ensure(currentSongId),
    },
    options,
  );

  function start(songId: number | null) {
    if (disposed || started) return;
    started = true;
    currentSongId = songId;
    watchdog.start();
    ensure(songId);
  }

  function noteAlive(songId?: number | null) {
    if (disposed) return;
    if (songId !== undefined) currentSongId = songId;
    watchdog.noteAlive();
  }

  function resolve(songId?: number | null) {
    if (songId === undefined || pendingSongId === songId) clearBurst();
  }

  function dispose() {
    disposed = true;
    started = false;
    clearBurst();
    watchdog.dispose();
  }

  return { start, ensure, noteAlive, resolve, dispose };
}

/**
 * Register a related listener set as one resource. If any registration fails,
 * listeners that did register are immediately released before the error is
 * surfaced to the caller.
 */
export async function registerDesktopLyricsListenersAtomically(
  registrations: readonly (() => Promise<() => void>)[],
): Promise<(() => void)[]> {
  const results = await Promise.allSettled(
    registrations.map((register) => register()),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    for (const result of results) {
      if (result.status === "fulfilled") result.value();
    }
    throw failed.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<() => void>).value);
}
