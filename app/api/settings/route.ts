import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSettings, updateSettings } from "@/app/lib/settings";
import { requireWebAuth } from "@/app/lib/web-auth";

const FIXED_TUYA_SYNC_INTERVAL_SEC = 3600;

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const settings = await getSettings();
  return NextResponse.json({
    autoRestartEnabled: settings.autoRestartEnabled,
    minerSyncIntervalSec: settings.minerSyncIntervalSec,
    deyeSyncIntervalSec: settings.deyeSyncIntervalSec,
    tuyaSyncIntervalSec: FIXED_TUYA_SYNC_INTERVAL_SEC,
    restartDelayMinutes: settings.restartDelayMinutes,
    postRestartGraceMinutes: settings.postRestartGraceMinutes,
    lowHashrateThresholdGh: settings.lowHashrateThresholdGh,
    hashrateDeviationPercent: settings.hashrateDeviationPercent,
    notifyAutoRestart: settings.notifyAutoRestart,
    notifyRestartPrompt: settings.notifyRestartPrompt,
    notificationVisibleCount: settings.notificationVisibleCount,
    criticalBatteryOffPercent: settings.criticalBatteryOffPercent,
  });
}

export async function PUT(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload: {
    autoRestartEnabled?: boolean;
    minerSyncIntervalSec?: number;
    deyeSyncIntervalSec?: number;
    tuyaSyncIntervalSec?: number;
    restartDelayMinutes?: number;
    postRestartGraceMinutes?: number;
    lowHashrateThresholdGh?: number;
    hashrateDeviationPercent?: number;
    notifyAutoRestart?: boolean;
    notifyRestartPrompt?: boolean;
    notificationVisibleCount?: number;
    criticalBatteryOffPercent?: number;
  } = {};

  // Tuya polling is fixed to once per hour.
  payload.tuyaSyncIntervalSec = FIXED_TUYA_SYNC_INTERVAL_SEC;

  if (typeof body.autoRestartEnabled === "boolean") {
    payload.autoRestartEnabled = body.autoRestartEnabled;
  }
  if (
    typeof body.minerSyncIntervalSec === "number" &&
    Number.isFinite(body.minerSyncIntervalSec) &&
    body.minerSyncIntervalSec >= 5 &&
    body.minerSyncIntervalSec <= 3600
  ) {
    payload.minerSyncIntervalSec = Math.floor(body.minerSyncIntervalSec);
  }
  if (
    typeof body.deyeSyncIntervalSec === "number" &&
    Number.isFinite(body.deyeSyncIntervalSec) &&
    body.deyeSyncIntervalSec >= 5 &&
    body.deyeSyncIntervalSec <= 3600
  ) {
    payload.deyeSyncIntervalSec = Math.floor(body.deyeSyncIntervalSec);
  }
  if (
    typeof body.restartDelayMinutes === "number" &&
    Number.isFinite(body.restartDelayMinutes) &&
    body.restartDelayMinutes >= 0
  ) {
    payload.restartDelayMinutes = Math.floor(body.restartDelayMinutes);
  }
  if (
    typeof body.postRestartGraceMinutes === "number" &&
    Number.isFinite(body.postRestartGraceMinutes) &&
    body.postRestartGraceMinutes >= 0
  ) {
    payload.postRestartGraceMinutes = Math.floor(body.postRestartGraceMinutes);
  }
  if (
    typeof body.lowHashrateThresholdGh === "number" &&
    Number.isFinite(body.lowHashrateThresholdGh) &&
    body.lowHashrateThresholdGh >= 0
  ) {
    payload.lowHashrateThresholdGh = body.lowHashrateThresholdGh;
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
  if (
    typeof body.notificationVisibleCount === "number" &&
    Number.isFinite(body.notificationVisibleCount) &&
    body.notificationVisibleCount >= 1
  ) {
    payload.notificationVisibleCount = Math.floor(body.notificationVisibleCount);
  }
  if (
    typeof body.criticalBatteryOffPercent === "number" &&
    Number.isFinite(body.criticalBatteryOffPercent) &&
    body.criticalBatteryOffPercent >= 0 &&
    body.criticalBatteryOffPercent <= 100
  ) {
    payload.criticalBatteryOffPercent = body.criticalBatteryOffPercent;
  }

  const updated = await updateSettings(payload);
  return NextResponse.json({
    autoRestartEnabled: updated.autoRestartEnabled,
    minerSyncIntervalSec: updated.minerSyncIntervalSec,
    deyeSyncIntervalSec: updated.deyeSyncIntervalSec,
    tuyaSyncIntervalSec: FIXED_TUYA_SYNC_INTERVAL_SEC,
    restartDelayMinutes: updated.restartDelayMinutes,
    postRestartGraceMinutes: updated.postRestartGraceMinutes,
    lowHashrateThresholdGh: updated.lowHashrateThresholdGh,
    hashrateDeviationPercent: updated.hashrateDeviationPercent,
    notifyAutoRestart: updated.notifyAutoRestart,
    notifyRestartPrompt: updated.notifyRestartPrompt,
    notificationVisibleCount: updated.notificationVisibleCount,
    criticalBatteryOffPercent: updated.criticalBatteryOffPercent,
  });
}
