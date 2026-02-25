import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { getTuyaSnapshotCached } from "@/app/lib/tuya-cache";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const force = request.nextUrl.searchParams.get("force") === "1";
  try {
    const result = await getTuyaSnapshotCached({ force });
    return NextResponse.json({
      ...result.snapshot,
      error: result.error,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Tuya API error" },
      { status: 502 },
    );
  }
}
