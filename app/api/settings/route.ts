import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSettings, updateSettings } from "@/app/lib/settings";
import { requireWebAuth } from "@/app/lib/web-auth";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const settings = await getSettings();
  return NextResponse.json({
    autoRestartEnabled: settings.autoRestartEnabled,
    minerSyncIntervalSec: settings.minerSyncIntervalSec,
    deyeSyncIntervalSec: settings.deyeSyncIntervalSec,
    tuyaSyncIntervalSec: settings.tuyaSyncIntervalSec,
    restartDelayMinutes: settings.restartDelayMinutes,
    postRestartGraceMinutes: settings.postRestartGraceMinutes,
    lowHashrateThresholdGh: settings.lowHashrateThresholdGh,
    hashrateDeviationPercent: settings.hashrateDeviationPercent,
    notifyAutoRestart: settings.notifyAutoRestart,
    notifyRestartPrompt: settings.notifyRestartPrompt,
    notificationVisibleCount: settings.notificationVisibleCount,
    criticalBatteryOffPercent: settings.criticalBatteryOffPercent,
    dayTariffPrice: settings.dayTariffPrice,
    nightTariffPrice: settings.nightTariffPrice,
    greenTariffPrice: settings.greenTariffPrice,
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
    dayTariffPrice?: number;
    nightTariffPrice?: number;
    greenTariffPrice?: number;
  } = {};

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
    typeof body.tuyaSyncIntervalSec === "number" &&
    Number.isFinite(body.tuyaSyncIntervalSec) &&
    body.tuyaSyncIntervalSec >= 5 &&
    body.tuyaSyncIntervalSec <= 3600
  ) {
    payload.tuyaSyncIntervalSec = Math.floor(body.tuyaSyncIntervalSec);
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
  if (
    typeof body.dayTariffPrice === "number" &&
    Number.isFinite(body.dayTariffPrice) &&
    body.dayTariffPrice >= 0
  ) {
    payload.dayTariffPrice = body.dayTariffPrice;
  }
  if (
    typeof body.nightTariffPrice === "number" &&
    Number.isFinite(body.nightTariffPrice) &&
    body.nightTariffPrice >= 0
  ) {
    payload.nightTariffPrice = body.nightTariffPrice;
  }
  if (
    typeof body.greenTariffPrice === "number" &&
    Number.isFinite(body.greenTariffPrice) &&
    body.greenTariffPrice >= 0
  ) {
    payload.greenTariffPrice = body.greenTariffPrice;
  }

  const updated = await updateSettings(payload);
  return NextResponse.json({
    autoRestartEnabled: updated.autoRestartEnabled,
    minerSyncIntervalSec: updated.minerSyncIntervalSec,
    deyeSyncIntervalSec: updated.deyeSyncIntervalSec,
    tuyaSyncIntervalSec: updated.tuyaSyncIntervalSec,
    restartDelayMinutes: updated.restartDelayMinutes,
    postRestartGraceMinutes: updated.postRestartGraceMinutes,
    lowHashrateThresholdGh: updated.lowHashrateThresholdGh,
    hashrateDeviationPercent: updated.hashrateDeviationPercent,
    notifyAutoRestart: updated.notifyAutoRestart,
    notifyRestartPrompt: updated.notifyRestartPrompt,
    notificationVisibleCount: updated.notificationVisibleCount,
    criticalBatteryOffPercent: updated.criticalBatteryOffPercent,
    dayTariffPrice: updated.dayTariffPrice,
    nightTariffPrice: updated.nightTariffPrice,
    greenTariffPrice: updated.greenTariffPrice,
  });
}
