import { prisma } from "./prisma";
import { memorySettings } from "./store";

export type SettingsPayload = {
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
};

function toUtcDateInputValue(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function getSettings() {
  try {
    const existing = await prisma.settings.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return prisma.settings.create({ data: { id: 1 } });
  } catch {
    return memorySettings;
  }
}

export async function updateSettings(payload: SettingsPayload) {
  try {
    await getSettings();
    return prisma.settings.update({
      where: { id: 1 },
      data: {
        autoRestartEnabled: payload.autoRestartEnabled,
        minerSyncIntervalSec: payload.minerSyncIntervalSec,
        deyeSyncIntervalSec: payload.deyeSyncIntervalSec,
        tuyaSyncIntervalSec: payload.tuyaSyncIntervalSec,
        restartDelayMinutes: payload.restartDelayMinutes,
        postRestartGraceMinutes: payload.postRestartGraceMinutes,
        lowHashrateThresholdGh: payload.lowHashrateThresholdGh,
        hashrateDeviationPercent: payload.hashrateDeviationPercent,
        notifyAutoRestart: payload.notifyAutoRestart,
        notifyRestartPrompt: payload.notifyRestartPrompt,
        notificationVisibleCount: payload.notificationVisibleCount,
        criticalBatteryOffPercent: payload.criticalBatteryOffPercent,
        useNetMeteringForGreenTariff: payload.useNetMeteringForGreenTariff,
        miningStartDate: payload.miningStartDate,
      },
    });
  } catch {
    if (typeof payload.autoRestartEnabled === "boolean") {
      memorySettings.autoRestartEnabled = payload.autoRestartEnabled;
    }
    if (typeof payload.minerSyncIntervalSec === "number") {
      memorySettings.minerSyncIntervalSec = payload.minerSyncIntervalSec;
    }
    if (typeof payload.deyeSyncIntervalSec === "number") {
      memorySettings.deyeSyncIntervalSec = payload.deyeSyncIntervalSec;
    }
    if (typeof payload.tuyaSyncIntervalSec === "number") {
      memorySettings.tuyaSyncIntervalSec = payload.tuyaSyncIntervalSec;
    }
    if (typeof payload.restartDelayMinutes === "number") {
      memorySettings.restartDelayMinutes = payload.restartDelayMinutes;
    }
    if (typeof payload.postRestartGraceMinutes === "number") {
      memorySettings.postRestartGraceMinutes = payload.postRestartGraceMinutes;
    }
    if (typeof payload.lowHashrateThresholdGh === "number") {
      memorySettings.lowHashrateThresholdGh = payload.lowHashrateThresholdGh;
    }
    if (typeof payload.hashrateDeviationPercent === "number") {
      memorySettings.hashrateDeviationPercent = payload.hashrateDeviationPercent;
    }
    if (typeof payload.notifyAutoRestart === "boolean") {
      memorySettings.notifyAutoRestart = payload.notifyAutoRestart;
    }
    if (typeof payload.notifyRestartPrompt === "boolean") {
      memorySettings.notifyRestartPrompt = payload.notifyRestartPrompt;
    }
    if (typeof payload.notificationVisibleCount === "number") {
      memorySettings.notificationVisibleCount = payload.notificationVisibleCount;
    }
    if (typeof payload.criticalBatteryOffPercent === "number") {
      memorySettings.criticalBatteryOffPercent = payload.criticalBatteryOffPercent;
    }
    if (typeof payload.useNetMeteringForGreenTariff === "boolean") {
      memorySettings.useNetMeteringForGreenTariff = payload.useNetMeteringForGreenTariff;
    }
    if (payload.miningStartDate !== undefined) {
      memorySettings.miningStartDate = toUtcDateInputValue(payload.miningStartDate ?? null);
    }
    return memorySettings;
  }
}
