import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/app/lib/web-auth";

export async function GET(request: NextRequest) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    email: session.email,
    expiresAt: session.exp,
  });
}
