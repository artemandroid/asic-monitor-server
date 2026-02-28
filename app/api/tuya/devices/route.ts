import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { ensureTuyaBackgroundRefresh } from "@/app/lib/tuya-background-refresh";
import { getTuyaSnapshotCached, getTuyaSnapshotStored } from "@/app/lib/tuya-cache";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  ensureTuyaBackgroundRefresh();
  try {
    let result = await getTuyaSnapshotStored();
    let refreshError: string | undefined;
    if (result.stale) {
      try {
        const refreshed = await getTuyaSnapshotCached({ force: true, maxAgeMs: 0 });
        refreshError = refreshed.error;
      } catch (error) {
        refreshError = error instanceof Error ? error.message : "Unknown Tuya refresh error";
      }
      result = await getTuyaSnapshotStored();
    }
    return NextResponse.json({
      ...result.snapshot,
      error: refreshError ?? result.error,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Tuya cache error" },
      { status: 502 },
    );
  }
}
