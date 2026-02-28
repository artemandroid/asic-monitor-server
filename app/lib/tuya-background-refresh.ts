import { getTuyaSnapshotCached } from "@/app/lib/tuya-cache";

const TUYA_BACKGROUND_REFRESH_MS = 60 * 60 * 1000;

type TuyaBackgroundRefreshState = {
  timer: NodeJS.Timeout | null;
  running: boolean;
};

const globalState = globalThis as unknown as {
  __tuyaBackgroundRefreshState?: TuyaBackgroundRefreshState;
};

const state: TuyaBackgroundRefreshState =
  globalState.__tuyaBackgroundRefreshState ?? {
    timer: null,
    running: false,
  };

if (!globalState.__tuyaBackgroundRefreshState) {
  globalState.__tuyaBackgroundRefreshState = state;
}

async function refreshSnapshotNow(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await getTuyaSnapshotCached({ force: true, maxAgeMs: 0 });
  } catch {
    // Keep the loop alive even if Tuya is temporarily unavailable.
  } finally {
    state.running = false;
  }
}

export function ensureTuyaBackgroundRefresh(): void {
  if (state.timer) return;

  void refreshSnapshotNow();
  state.timer = setInterval(() => {
    void refreshSnapshotNow();
  }, TUYA_BACKGROUND_REFRESH_MS);
  state.timer.unref?.();
}
