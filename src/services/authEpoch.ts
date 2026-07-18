export type AuthEpochListener = (epoch: number) => void;

interface AuthEpochState {
  epoch: number;
  listeners: Set<AuthEpochListener>;
}

const STATE_KEY = "__nnplayerAuthEpochState__";
const globalScope = globalThis as typeof globalThis & {
  [STATE_KEY]?: AuthEpochState;
};

// Keep one state object across Vite HMR replacements. Consumers unsubscribe with
// their own scope, so a hot replacement cannot split the app across two epochs.
const state = globalScope[STATE_KEY] ?? {
  epoch: 0,
  listeners: new Set<AuthEpochListener>(),
};
globalScope[STATE_KEY] = state;

export function getAuthEpoch(): number {
  return state.epoch;
}

export function rotateAuthEpoch(): number {
  state.epoch += 1;
  for (const listener of [...state.listeners]) {
    try {
      listener(state.epoch);
    } catch (error) {
      console.error("[authEpoch] listener failed", error);
    }
  }
  return state.epoch;
}

export function subscribeAuthEpoch(listener: AuthEpochListener): () => void {
  state.listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    state.listeners.delete(listener);
  };
}
