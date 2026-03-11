import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSettings, updateSettings } from "@/app/lib/settings";
import { requireWebAuth } from "@/app/lib/web-auth";

const FIXED_TUYA_SYNC_INTERVAL_SEC = 3600;

function toUtcDateInputValue(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
    useNetMeteringForGreenTariff: settings.useNetMeteringForGreenTariff,
    miningStartDate: toUtcDateInputValue(
      (settings as { miningStartDate?: Date | string | null }).miningStartDate,
    ),
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
    useNetMeteringForGreenTariff?: boolean;
    miningStartDate?: Date | null;
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
  if (typeof body.useNetMeteringForGreenTariff === "boolean") {
    payload.useNetMeteringForGreenTariff = body.useNetMeteringForGreenTariff;
  }
  if (body.miningStartDate === null) {
    payload.miningStartDate = null;
  } else if (typeof body.miningStartDate === "string") {
    const trimmed = body.miningStartDate.trim();
    if (!trimmed) {
      payload.miningStartDate = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = new Date(`${trimmed}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) {
        payload.miningStartDate = parsed;
      }
    }
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
    useNetMeteringForGreenTariff: updated.useNetMeteringForGreenTariff,
    miningStartDate: toUtcDateInputValue(
      (updated as { miningStartDate?: Date | string | null }).miningStartDate,
    ),
  });
}
