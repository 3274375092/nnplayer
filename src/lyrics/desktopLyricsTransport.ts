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

/**
 * Detect a silent desktop-lyrics transport and keep retrying the snapshot
 * handshake until a valid protocol packet proves that the channel is alive.
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
