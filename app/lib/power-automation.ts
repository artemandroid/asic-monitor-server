import { prisma } from "@/app/lib/prisma";
import { fetchDeyeStationSnapshot } from "@/app/lib/deye-client";
import { getTuyaSnapshotCached, patchTuyaDeviceSwitchState } from "@/app/lib/tuya-cache";
import { setTuyaSwitch } from "@/app/lib/tuya-client";
import { getSettings } from "@/app/lib/settings";
import { saveDeyeEnergySample } from "@/app/lib/deye-energy";

import {
  BATTERY_NOT_DISCHARGING_MAX_KW,
  DEFAULT_CRITICAL_OFF_BATTERY_PERCENT,
  DEFAULT_OVERHEAT_SLEEP_MINUTES,
  GENERATION_COVER_TOLERANCE_KW,
  POWER_AUTOMATION_DEBOUNCE_MS,
  POWER_AUTOMATION_MIN_RUN_INTERVAL_MS,
} from "@/app/lib/constants";
import { CommandStatus, CommandType } from "@/app/lib/types";
import { useGlobalSlice } from "@/app/lib/global-state";

const NOTIFY_POWER_AUTOMATION = "POWER_AUTOMATION";
const NOTIFY_OVERHEAT_WAKE_DEFERRED = "OVERHEAT_WAKE_DEFERRED";
const NOTIFY_OVERHEAT_WAKE_SENT = "OVERHEAT_WAKE_SENT";
const NOTIFY_PROTECTIVE_SLEEP = "PROTECTIVE_SLEEP";
const NOTIFY_PROTECTIVE_OFF = "PROTECTIVE_OFF";
const NOTIFY_PROTECTIVE_OFF_DEFERRED = "PROTECTIVE_OFF_DEFERRED";
const NOTIFY_PROTECTIVE_WAKE = "PROTECTIVE_WAKE";

const PROTECTIVE_REASON = {
  OVERHEAT: "OVERHEAT",
  CRITICAL_BATTERY: "CRITICAL_BATTERY",
  GRID_LOSS: "GRID_LOSS",
  BATTERY_THRESHOLD: "BATTERY_THRESHOLD",
} as const;
type ProtectiveReason = (typeof PROTECTIVE_REASON)[keyof typeof PROTECTIVE_REASON];

function protectiveReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case PROTECTIVE_REASON.OVERHEAT:
      return "overheat";
    case PROTECTIVE_REASON.CRITICAL_BATTERY:
      return "critical battery";
    case PROTECTIVE_REASON.GRID_LOSS:
      return "grid loss";
    case PROTECTIVE_REASON.BATTERY_THRESHOLD:
      return "low battery";
    default:
      return "protection";
  }
}

function extractWirePower(station: Awaited<ReturnType<typeof fetchDeyeStationSnapshot>>): number | null {
  const candidates = station.apiSignals.filter((signal) => /(^|\.|_)wirepower$/i.test(signal.key));
  for (const candidate of candidates) {
    if (typeof candidate.value === "number" && Number.isFinite(candidate.value)) return candidate.value;
    if (typeof candidate.value === "string") {
      const parsed = Number.parseFloat(candidate.value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

type AutomationState = {
  running: boolean;
  lastRunAt: number;
  prevGridOnline: boolean | null;
  lockByKey: Record<string, number>;
  thresholdAutoOffAtByMiner: Record<string, number>;
  overheatWakePendingByMiner: Record<string, boolean>;
  autoOffRequestedByMiner: Record<string, boolean>;
};

const state = useGlobalSlice<AutomationState>("powerAutomation", () => ({
  running: false,
  lastRunAt: 0,
  prevGridOnline: null,
  lockByKey: {},
  thresholdAutoOffAtByMiner: {},
  overheatWakePendingByMiner: {},
  autoOffRequestedByMiner: {},
}));

function shouldSkipRun(nowMs: number): boolean {
  if (state.running) return true;
  return nowMs - state.lastRunAt < POWER_AUTOMATION_MIN_RUN_INTERVAL_MS;
}

async function notify(message: string, minerId?: string, type = NOTIFY_POWER_AUTOMATION) {
  if (!prisma) return;
  await prisma.notification.create({
    data: {
      type,
      message,
      minerId: minerId ?? null,
      action: null,
    },
  });
}

async function clearOverheatLock(minerId: string) {
  if (!prisma) return;
  await prisma.miner.updateMany({
    where: { id: minerId },
    data: {
      overheatLocked: false,
      overheatLockedAt: null,
    },
  });
}

// ─── Staged protective shutdown helpers ─────────────────────────────────────────
// A protective shutdown first sleeps the miner (fans keep cooling the boards) and,
// after the cooldown window, cuts mains via the bound automat. On power restore a
// WAKE is issued because the ASIC persists sleep mode across a power cycle.

async function beginProtectiveSleep(minerId: string, reason: ProtectiveReason) {
  if (!prisma) return;
  await prisma.miner.updateMany({
    where: { id: minerId },
    data: {
      protectiveShutdownAt: new Date(),
      protectiveShutdownReason: reason,
      protectiveShutdownPhase: "SLEEPING",
      pendingWakeAfterPowerOn: false,
    },
  });
}

async function markProtectivePoweredOff(minerId: string) {
  if (!prisma) return;
  await prisma.miner.updateMany({
    where: { id: minerId },
    data: {
      protectiveShutdownPhase: "OFF",
      pendingWakeAfterPowerOn: true,
    },
  });
}

async function clearProtectiveState(minerId: string, opts: { clearPendingWake?: boolean } = {}) {
  if (!prisma) return;
  await prisma.miner.updateMany({
    where: { id: minerId },
    data: {
      protectiveShutdownAt: null,
      protectiveShutdownReason: null,
      protectiveShutdownPhase: null,
      ...(opts.clearPendingWake ? { pendingWakeAfterPowerOn: false } : {}),
    },
  });
}

async function enqueueMinerCommand(minerId: string, type: CommandType.SLEEP | CommandType.WAKE) {
  if (!prisma) return false;
  const pending = await prisma.command.findFirst({
    where: { minerId, type, status: CommandStatus.PENDING },
    select: { id: true },
  });
  if (pending) return false;

  await prisma.command.create({
    data: {
      id: crypto.randomUUID(),
      minerId,
      type,
      status: CommandStatus.PENDING,
      createdAt: new Date(),
    },
  });
  if (type === CommandType.WAKE) {
    await prisma.miner.updateMany({
      where: { id: minerId },
      data: { lastRestartAt: new Date() },
    });
  }
  return true;
}

export async function runPowerAutomation(): Promise<void> {
  const nowMs = Date.now();
  if (!prisma || shouldSkipRun(nowMs)) return;
  state.running = true;
  state.lastRunAt = nowMs;

  try {
    const [station, tuyaResult, miners, settings] = await Promise.all([
      fetchDeyeStationSnapshot(),
      getTuyaSnapshotCached(),
      prisma.miner.findMany({
        where: {
          OR: [
            { boundTuyaDeviceId: { not: null } },
            { overheatLocked: true },
          ],
        },
        select: {
          id: true,
          boundTuyaDeviceId: true,
          autoPowerOnGridRestore: true,
          autoPowerOffGridLoss: true,
          autoPowerOnGenerationAboveKw: true,
          autoPowerOffBatteryBelowPercent: true,
          autoPowerOnBatteryAbovePercent: true,
          autoPowerRestoreDelayMinutes: true,
          overheatLocked: true,
          overheatLockedAt: true,
          overheatSleepMinutes: true,
          manualPowerHold: true,
          manualPauseHold: true,
          protectiveShutdownAt: true,
          protectiveShutdownReason: true,
          protectiveShutdownPhase: true,
          pendingWakeAfterPowerOn: true,
          overheatActionOverride: true,
          protectiveSleepMinutesOverride: true,
          lastOnlineAt: true,
          lastMetric: true,
        },
      }),
      getSettings(),
    ]);
    const tuya = tuyaResult.snapshot;
    const tuyaUnavailable = Boolean(tuyaResult.error);
    await saveDeyeEnergySample(station);
    const criticalOffBatteryPercent =
      typeof settings.criticalBatteryOffPercent === "number"
        ? settings.criticalBatteryOffPercent
        : DEFAULT_CRITICAL_OFF_BATTERY_PERCENT;

    const gridNow = station.gridOnline;
    const wirePower = extractWirePower(station);
    const wirePowerNonZero = wirePower !== null && Math.abs(wirePower) > 0.001;
    const batteryBelowCriticalThreshold =
      typeof station.batterySoc === "number" && station.batterySoc < criticalOffBatteryPercent;
    const prevGrid = state.prevGridOnline;
    const gridRestored = prevGrid === false && gridNow === true;
    const initialGridOnline = prevGrid === null && gridNow === true;
    const gridLost = prevGrid === true && gridNow === false;
    const gridOffline = gridNow === false;
    const shouldOffByCriticalBattery = gridOffline && batteryBelowCriticalThreshold;
    if (gridNow !== null) state.prevGridOnline = gridNow;

    const devicesById = new Map(tuya.devices.map((d) => [d.id, d]));
    const now = Date.now();

    for (const miner of miners) {
      const deviceId = miner.boundTuyaDeviceId ?? "";
      const hasBoundDevice = Boolean(deviceId);
      const device = devicesById.get(deviceId);
      const deviceUnavailable = !device || !device.online || !device.switchCode;
      const lastMetric =
        miner.lastMetric && typeof miner.lastMetric === "object"
          ? (miner.lastMetric as { minerMode?: number; online?: boolean })
          : null;
      const minerMode = typeof lastMetric?.minerMode === "number" ? lastMetric.minerMode : null;
      const isSleepingLike = minerMode === 1;

      const overheatLocked = miner.overheatLocked === true;
      const manualPowerHold = miner.manualPowerHold === true;
      // Operator pause (manual SLEEP): freeze automation for this miner exactly like
      // a manual power hold, so a paused miner is not auto-woken / auto-toggled.
      // Cleared by a manual WAKE or manual power ON.
      const manualPauseHold = miner.manualPauseHold === true;
      const overheatSleepMinutes = Math.max(
        5,
        Math.floor(miner.overheatSleepMinutes ?? DEFAULT_OVERHEAT_SLEEP_MINUTES),
      );
      const overheatSleepDurationMs = overheatSleepMinutes * 60 * 1000;

      // Effective protective-sleep window: per-miner override falls back to global default.
      // (overheatAction NAP/SHUTDOWN override is wired in a later phase; overheat stays NAP.)
      const protectiveSleepMinutes = Math.max(
        1,
        Math.floor(miner.protectiveSleepMinutesOverride ?? settings.protectiveSleepMinutes ?? 5),
      );
      const protectiveSleepDurationMs = protectiveSleepMinutes * 60 * 1000;

      if (manualPowerHold || manualPauseHold) {
        delete state.overheatWakePendingByMiner[miner.id];
        delete state.autoOffRequestedByMiner[miner.id];
        delete state.thresholdAutoOffAtByMiner[miner.id];
        continue;
      }
      const generationAutoOnConfigured = typeof miner.autoPowerOnGenerationAboveKw === "number";
      const generationCoversConsumption =
        typeof station.generationPowerKw === "number" &&
        typeof station.consumptionPowerKw === "number" &&
        station.generationPowerKw >= station.consumptionPowerKw - GENERATION_COVER_TOLERANCE_KW;
      const batteryNotDischarging =
        typeof station.batteryDischargePowerKw === "number" &&
        station.batteryDischargePowerKw <= BATTERY_NOT_DISCHARGING_MAX_KW;
      const generationAutoOnReadyRaw =
        generationAutoOnConfigured &&
        generationCoversConsumption &&
        batteryNotDischarging;
      // This auto-ON mode is relevant only when grid is unavailable.
      // When grid is back, we should not block power restore by generation checks.
      const generationAutoOnReady = gridNow === true ? true : generationAutoOnReadyRaw;
      const batteryConfigured = typeof miner.autoPowerOffBatteryBelowPercent === "number";
      const batteryAtOrBelowOffThreshold =
        batteryConfigured &&
        station.batterySoc !== null &&
        station.batterySoc <= (miner.autoPowerOffBatteryBelowPercent ?? 0);
      const batteryAutoOnConfigured =
        typeof miner.autoPowerOnBatteryAbovePercent === "number";
      const batteryAutoOnThreshold =
        batteryAutoOnConfigured
          ? miner.autoPowerOnBatteryAbovePercent
          : null;
      const shouldOffByBattery =
        batteryConfigured &&
        station.batterySoc !== null &&
        station.batterySoc < (miner.autoPowerOffBatteryBelowPercent ?? 0);
      const shouldOffByGridLossRaw = miner.autoPowerOffGridLoss === true && gridLost;
      const shouldOffByGridLoss =
        shouldOffByGridLossRaw &&
        (
          !batteryConfigured ||
          shouldOffByBattery
        );
      // Threshold-based shutdown logic:
      // 1) Works only when grid is OFF.
      // 2) Battery threshold is mandatory trigger.
      const shouldOffByThreshold =
        gridOffline &&
        batteryConfigured &&
        shouldOffByBattery;
      const shouldOff =
        shouldOffByCriticalBattery ||
        shouldOffByGridLoss ||
        shouldOffByThreshold;
      if (!shouldOff || device?.on === false) {
        delete state.autoOffRequestedByMiner[miner.id];
      }

      // Grid has absolute priority for power restore: when grid is available,
      // restore power regardless of battery/generation settings.
      const shouldOnImmediate =
        !overheatLocked &&
        (gridRestored || initialGridOnline);
      const shouldOnWhenGridOnline =
        !overheatLocked &&
        gridNow === true;
      const batteryTooLowForAutoOn =
        batteryAutoOnConfigured &&
        typeof station.batterySoc === "number" &&
        station.batterySoc <
          (batteryAutoOnThreshold ?? 0);
      const batteryBlocksAutoOnRaw =
        !generationAutoOnConfigured && batteryTooLowForAutoOn && !wirePowerNonZero;
      // When grid is back, battery constraints should not block auto power restore.
      const batteryBlocksAutoOn = gridNow === true ? false : batteryBlocksAutoOnRaw;
      const generationBlocksAutoOn = generationAutoOnConfigured && !generationAutoOnReady;
      // Safety for generation-cover mode: when grid is unavailable, never auto-ON
      // while SOC is already in auto-OFF battery zone.
      const batteryOffSafetyBlocksGenerationAutoOn =
        gridNow !== true &&
        generationAutoOnConfigured &&
        batteryAtOrBelowOffThreshold;
      const autoOnBlocked =
        generationBlocksAutoOn ||
        batteryBlocksAutoOn ||
        batteryOffSafetyBlocksGenerationAutoOn;

      // Overheat NAP: sleep miner for the cooldown window, then auto-wake.
      // A concurrent battery/grid emergency (shouldOff) takes precedence: skip the
      // NAP and fall through to the staged protective shutdown so mains is cut.
      if (overheatLocked && !shouldOff) {
        const lockedAtMs = miner.overheatLockedAt ? new Date(miner.overheatLockedAt).getTime() : NaN;
        if (Number.isFinite(lockedAtMs) && now >= lockedAtMs + overheatSleepDurationMs) {
          const hasPowerPolicyOff =
            shouldOffByCriticalBattery || shouldOffByGridLoss || shouldOffByThreshold;
          const powerUnavailableForWake =
            hasBoundDevice &&
            (
              hasPowerPolicyOff ||
              tuyaUnavailable ||
              !device ||
              !device.online ||
              !device.switchCode ||
              device.on !== true
            );

          if (powerUnavailableForWake) {
            if (!state.overheatWakePendingByMiner[miner.id]) {
              state.overheatWakePendingByMiner[miner.id] = true;
              await notify(
                `Overheat cooldown finished for ${miner.id}, but WAKE is deferred: power is unavailable (switch OFF or blocked by battery/grid policy). WAKE will be sent automatically after power is restored.`,
                miner.id,
                NOTIFY_OVERHEAT_WAKE_DEFERRED,
              );
            }
            continue;
          }

          const queuedWake = await enqueueMinerCommand(miner.id, CommandType.WAKE);
          await clearOverheatLock(miner.id);
          const hadDeferredWake = state.overheatWakePendingByMiner[miner.id] === true;
          delete state.overheatWakePendingByMiner[miner.id];
          await notify(
            hadDeferredWake
              ? `Power restored for ${miner.id}. Deferred WAKE sent after ${overheatSleepMinutes}-minute overheat cooldown.`
              : `${overheatSleepMinutes}-minute overheat cooldown finished for ${miner.id}. WAKE command sent automatically.`,
            miner.id,
            NOTIFY_OVERHEAT_WAKE_SENT,
          );
          if (!queuedWake) {
            // WAKE may already be pending; keep flow consistent and unlock overheat state.
            continue;
          }
          continue;
        }
        // Keep miner sleeping during cooldown window.
        continue;
      }

      if (!hasBoundDevice) continue;
      if (!device) continue;

      // ── Recovery: a protectively powered-off miner is back on mains. The ASIC
      //    persists sleep mode across a power cycle, so issue WAKE once it has booted.
      if (miner.pendingWakeAfterPowerOn && !shouldOff) {
        const shutdownMs = miner.protectiveShutdownAt ? new Date(miner.protectiveShutdownAt).getTime() : 0;
        const onlineMs = miner.lastOnlineAt ? new Date(miner.lastOnlineAt).getTime() : 0;
        // Act only once the ASIC has demonstrably rebooted and reported AFTER mains was
        // cut, so a stale pre-cut online reading cannot fire a premature WAKE.
        const bootedAfterShutdown =
          device.on === true && lastMetric?.online === true && onlineMs > shutdownMs;
        if (bootedAfterShutdown) {
          const lockKey = `${miner.id}:PWAKE`;
          if (now >= (state.lockByKey[lockKey] ?? 0)) {
            state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
            if (isSleepingLike) {
              const reasonLabel = protectiveReasonLabel(miner.protectiveShutdownReason);
              const queued = await enqueueMinerCommand(miner.id, CommandType.WAKE);
              await clearProtectiveState(miner.id, { clearPendingWake: true });
              if (queued) {
                await notify(
                  `Power restored for ${miner.id}: WAKE sent to exit sleep (was ${reasonLabel} shutdown).`,
                  miner.id,
                  NOTIFY_PROTECTIVE_WAKE,
                );
              }
            } else {
              // Booted straight into mining mode (sleep not persisted) — already awake;
              // just reconcile the protective state so the flag can't get stuck.
              await clearProtectiveState(miner.id, { clearPendingWake: true });
            }
          }
          continue;
        }
        // Powered but not booted yet, or still off — fall through so the ON logic restores power.
      }

      // ── Staged protective shutdown (battery / grid): sleep to cool boards, then cut mains. ──
      if (shouldOff) {
        const reason: ProtectiveReason = shouldOffByCriticalBattery
          ? PROTECTIVE_REASON.CRITICAL_BATTERY
          : shouldOffByGridLoss
            ? PROTECTIVE_REASON.GRID_LOSS
            : PROTECTIVE_REASON.BATTERY_THRESHOLD;

        // Stage 1: start the cooling sleep (works even when the automat is unreachable).
        if (!miner.protectiveShutdownAt) {
          const lockKey = `${miner.id}:PROT_SLEEP`;
          if (now >= (state.lockByKey[lockKey] ?? 0)) {
            state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
            if (!isSleepingLike) await enqueueMinerCommand(miner.id, CommandType.SLEEP);
            await beginProtectiveSleep(miner.id, reason);
            await notify(
              `${miner.id}: ${protectiveReasonLabel(reason)} — sleeping ${protectiveSleepMinutes} min to cool boards, then powering off via automat.`,
              miner.id,
              NOTIFY_PROTECTIVE_SLEEP,
            );
          }
          continue;
        }

        // Stage 2: after the cooldown window, cut mains via the automat.
        const startedAtMs = new Date(miner.protectiveShutdownAt).getTime();
        const cooled = Number.isFinite(startedAtMs) && now >= startedAtMs + protectiveSleepDurationMs;
        if (!cooled) continue;

        if (tuyaUnavailable || deviceUnavailable) {
          const lockKey = `${miner.id}:PROT_OFF_DEFERRED`;
          if (now >= (state.lockByKey[lockKey] ?? 0)) {
            // Long interval: only a periodic reminder while the automat stays unreachable.
            state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS * 20;
            await notify(
              `${miner.id}: cooldown finished but the automat is unavailable — staying asleep, power not cut.`,
              miner.id,
              NOTIFY_PROTECTIVE_OFF_DEFERRED,
            );
          }
          continue;
        }

        if (device.on !== false && miner.protectiveShutdownPhase !== "OFF") {
          const lockKey = `${miner.id}:OFF`;
          if (now >= (state.lockByKey[lockKey] ?? 0)) {
            state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
            if (reason === PROTECTIVE_REASON.BATTERY_THRESHOLD) {
              state.thresholdAutoOffAtByMiner[miner.id] = now;
            } else {
              delete state.thresholdAutoOffAtByMiner[miner.id];
            }
            await setTuyaSwitch(device.id, false, device.switchCode);
            await patchTuyaDeviceSwitchState(device.id, false);
            await markProtectivePoweredOff(miner.id);
            // A concurrent overheat lock is moot once mains is cut; clear it so the
            // overheat NAP machine does not fight the protective shutdown on restore.
            if (overheatLocked) await clearOverheatLock(miner.id);
            await notify(
              reason === PROTECTIVE_REASON.CRITICAL_BATTERY
                ? `${miner.id}: cooled — power cut via ${device.name} (grid OFF, battery < ${criticalOffBatteryPercent}%).`
                : `${miner.id}: cooled — power cut via ${device.name} (${protectiveReasonLabel(reason)}).`,
              miner.id,
              NOTIFY_PROTECTIVE_OFF,
            );
          }
        } else if (device.on === false && miner.protectiveShutdownPhase !== "OFF") {
          // Relay already open (we cut it earlier, or it was opened externally) but the
          // OFF phase was never recorded — arm the recovery path so WAKE-on-restore works.
          await markProtectivePoweredOff(miner.id);
        }
        continue;
      }

      // shouldOff is false: if a cooling sleep was started but conditions cleared before the
      // power-off step, wake the miner and clear the protective state.
      if (miner.protectiveShutdownAt && !miner.pendingWakeAfterPowerOn) {
        if (isSleepingLike && lastMetric?.online === true) {
          const lockKey = `${miner.id}:PWAKE`;
          if (now >= (state.lockByKey[lockKey] ?? 0)) {
            state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
            await enqueueMinerCommand(miner.id, CommandType.WAKE);
            await notify(
              `${miner.id}: conditions cleared during cooldown — WAKE sent.`,
              miner.id,
              NOTIFY_PROTECTIVE_WAKE,
            );
          }
        }
        await clearProtectiveState(miner.id, { clearPendingWake: true });
      }

      if (!autoOnBlocked && (shouldOnImmediate || shouldOnWhenGridOnline) && (tuyaUnavailable || deviceUnavailable)) {
        const lockKey = `${miner.id}:WAKE_FALLBACK`;
        const lockedUntil = state.lockByKey[lockKey] ?? 0;
        if (now >= lockedUntil && isSleepingLike && !overheatLocked) {
          state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
          const queued = await enqueueMinerCommand(miner.id, CommandType.WAKE);
          if (queued) {
            await notify(
              `Tuya unavailable for ${miner.id}; fallback WAKE command queued.`,
              miner.id,
            );
          }
        }
        continue;
      }

      if (!autoOnBlocked && (shouldOnImmediate || shouldOnWhenGridOnline) && device.on !== true) {
        const lockKey = `${miner.id}:ON`;
        const lockedUntil = state.lockByKey[lockKey] ?? 0;
        if (now >= lockedUntil) {
          state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
          delete state.thresholdAutoOffAtByMiner[miner.id];
          await setTuyaSwitch(device.id, true, device.switchCode);
          await patchTuyaDeviceSwitchState(device.id, true);
          await notify(`Auto ON requested for ${device.name} because grid is available.`, miner.id);
        }
        continue;
      }

      const thresholdOffAt = state.thresholdAutoOffAtByMiner[miner.id];
      const shouldAutoRestoreAfterThreshold =
        typeof thresholdOffAt === "number" &&
        device.on === false &&
        !overheatLocked &&
        !autoOnBlocked &&
        !shouldOffByGridLoss &&
        !shouldOffByThreshold;
      if (shouldAutoRestoreAfterThreshold) {
        const delayMinutes = Math.max(miner.autoPowerRestoreDelayMinutes ?? 10, 0);
        const delayMs = delayMinutes * 60 * 1000;
        if (now - thresholdOffAt >= delayMs) {
          const lockKey = `${miner.id}:ON`;
          const lockedUntil = state.lockByKey[lockKey] ?? 0;
          if (now >= lockedUntil) {
            state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
            delete state.thresholdAutoOffAtByMiner[miner.id];
            await setTuyaSwitch(device.id, true, device.switchCode);
            await patchTuyaDeviceSwitchState(device.id, true);
            await notify(
              `Auto ON requested for ${device.name} after threshold recovery delay.`,
              miner.id,
            );
          }
        }
      }

      if (!shouldOffByThreshold && device.on === true) {
        delete state.thresholdAutoOffAtByMiner[miner.id];
      }
    }
  } catch {
    // ignore power automation failures; they are surfaced by UI fetchers if needed.
  } finally {
    state.running = false;
  }
}
