import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { setTuyaSwitch } from "@/app/lib/tuya-client";

type Body = {
  deviceId?: string;
  on?: boolean;
  code?: string;
};

export async function POST(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.deviceId || typeof body.on !== "boolean") {
    return NextResponse.json({ error: "deviceId and on are required" }, { status: 400 });
  }

  try {
    await setTuyaSwitch(body.deviceId, body.on, body.code ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Tuya command error" },
      { status: 502 },
    );
  }
}
