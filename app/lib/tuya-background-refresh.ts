import { getTuyaSnapshotCached } from "@/app/lib/tuya-cache";
import { TUYA_BACKGROUND_REFRESH_MS } from "@/app/lib/constants";
import { useGlobalSlice } from "@/app/lib/global-state";

type TuyaBackgroundRefreshState = {
  timer: NodeJS.Timeout | null;
  running: boolean;
};

const state = useGlobalSlice<TuyaBackgroundRefreshState>("tuyaBackgroundRefresh", () => ({
  timer: null,
  running: false,
}));

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
