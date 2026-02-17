import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function requireAgentAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_TOKEN;
  const token = request.headers.get("x-agent-token");
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
