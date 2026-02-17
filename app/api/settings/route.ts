import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSettings, updateSettings } from "@/app/lib/settings";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    autoRestartEnabled: settings.autoRestartEnabled,
    restartDelayMinutes: settings.restartDelayMinutes,
    hashrateDeviationPercent: settings.hashrateDeviationPercent,
    notifyAutoRestart: settings.notifyAutoRestart,
    notifyRestartPrompt: settings.notifyRestartPrompt,
  });
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload: {
    autoRestartEnabled?: boolean;
    restartDelayMinutes?: number;
    hashrateDeviationPercent?: number;
    notifyAutoRestart?: boolean;
    notifyRestartPrompt?: boolean;
  } = {};

  if (typeof body.autoRestartEnabled === "boolean") {
    payload.autoRestartEnabled = body.autoRestartEnabled;
  }
  if (
    typeof body.restartDelayMinutes === "number" &&
    Number.isFinite(body.restartDelayMinutes) &&
    body.restartDelayMinutes >= 0
  ) {
    payload.restartDelayMinutes = Math.floor(body.restartDelayMinutes);
  }
  if (
    typeof body.hashrateDeviationPercent === "number" &&
    Number.isFinite(body.hashrateDeviationPercent) &&
    body.hashrateDeviationPercent >= 0
  ) {
    payload.hashrateDeviationPercent = body.hashrateDeviationPercent;
  }
  if (typeof body.notifyAutoRestart === "boolean") {
    payload.notifyAutoRestart = body.notifyAutoRestart;
  }
  if (typeof body.notifyRestartPrompt === "boolean") {
    payload.notifyRestartPrompt = body.notifyRestartPrompt;
  }

  const updated = await updateSettings(payload);
  return NextResponse.json({
    autoRestartEnabled: updated.autoRestartEnabled,
    restartDelayMinutes: updated.restartDelayMinutes,
    hashrateDeviationPercent: updated.hashrateDeviationPercent,
    notifyAutoRestart: updated.notifyAutoRestart,
    notifyRestartPrompt: updated.notifyRestartPrompt,
  });
}
