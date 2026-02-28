const g = globalThis as unknown as { __appState?: Record<string, unknown> };

if (!g.__appState) {
  g.__appState = {};
}

const globalAppState = g.__appState;

export function useGlobalSlice<T>(key: string, init: () => T): T {
  if (!(key in globalAppState)) globalAppState[key] = init();
  return globalAppState[key] as T;
}
