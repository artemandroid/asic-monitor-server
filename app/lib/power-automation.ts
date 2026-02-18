import { prisma } from "@/app/lib/prisma";
import { fetchDeyeStationSnapshot } from "@/app/lib/deye-client";
import { fetchTuyaDevices, setTuyaSwitch } from "@/app/lib/tuya-client";

const POWER_AUTOMATION_DEBOUNCE_MS = 45_000;
const POWER_AUTOMATION_MIN_RUN_INTERVAL_MS = 15_000;

type AutomationState = {
  running: boolean;
  lastRunAt: number;
  prevGridOnline: boolean | null;
  lockByKey: Record<string, number>;
  thresholdAutoOffAtByMiner: Record<string, number>;
};

const globalState = globalThis as unknown as { __powerAutomationState?: AutomationState };

const state: AutomationState =
  globalState.__powerAutomationState ?? {
    running: false,
    lastRunAt: 0,
    prevGridOnline: null,
    lockByKey: {},
    thresholdAutoOffAtByMiner: {},
  };

if (!globalState.__powerAutomationState) {
  globalState.__powerAutomationState = state;
}

function shouldSkipRun(nowMs: number): boolean {
  if (state.running) return true;
  return nowMs - state.lastRunAt < POWER_AUTOMATION_MIN_RUN_INTERVAL_MS;
}

async function notify(message: string, minerId?: string) {
  if (!prisma) return;
  await prisma.notification.create({
    data: {
      type: "POWER_AUTOMATION",
      message,
      minerId: minerId ?? null,
      action: null,
    },
  });
}

export async function runPowerAutomation(): Promise<void> {
  const nowMs = Date.now();
  if (!prisma || shouldSkipRun(nowMs)) return;
  state.running = true;
  state.lastRunAt = nowMs;

  try {
    const [station, tuya, miners] = await Promise.all([
      fetchDeyeStationSnapshot(),
      fetchTuyaDevices(),
      prisma.miner.findMany({
        where: { boundTuyaDeviceId: { not: null } },
        select: {
          id: true,
          boundTuyaDeviceId: true,
          autoPowerOnGridRestore: true,
          autoPowerOffGridLoss: true,
          autoPowerOffGenerationBelowKw: true,
          autoPowerOffBatteryBelowPercent: true,
          autoPowerRestoreDelayMinutes: true,
          overheatLocked: true,
        },
      }),
    ]);

    const gridNow = station.gridOnline;
    const prevGrid = state.prevGridOnline;
    const gridRestored = prevGrid === false && gridNow === true;
    const initialGridOnline = prevGrid === null && gridNow === true;
    const gridLost = prevGrid === true && gridNow === false;
    if (gridNow !== null) state.prevGridOnline = gridNow;

    const devicesById = new Map(tuya.devices.map((d) => [d.id, d]));
    const now = Date.now();

    for (const miner of miners) {
      const deviceId = miner.boundTuyaDeviceId ?? "";
      if (!deviceId) continue;
      const device = devicesById.get(deviceId);
      if (!device || !device.online || !device.switchCode) continue;

      const shouldOffByGridLoss = miner.autoPowerOffGridLoss === true && gridLost;
      const overheatLocked = miner.overheatLocked === true;
      const generationConfigured = typeof miner.autoPowerOffGenerationBelowKw === "number";
      const batteryConfigured = typeof miner.autoPowerOffBatteryBelowPercent === "number";
      const shouldOffByGeneration =
        generationConfigured &&
        station.generationPowerKw !== null &&
        station.generationPowerKw < (miner.autoPowerOffGenerationBelowKw ?? 0);
      const shouldOffByBattery =
        batteryConfigured &&
        station.batterySoc !== null &&
        station.batterySoc < (miner.autoPowerOffBatteryBelowPercent ?? 0);
      const shouldOffByThreshold =
        generationConfigured && batteryConfigured
          ? shouldOffByGeneration && shouldOffByBattery
          : generationConfigured
            ? shouldOffByGeneration
            : batteryConfigured
              ? shouldOffByBattery
              : false;
      const shouldOff = overheatLocked || shouldOffByGridLoss || shouldOffByThreshold;

      const shouldOnImmediate =
        !overheatLocked &&
        miner.autoPowerOnGridRestore === true &&
        (gridRestored || initialGridOnline);
      const shouldOnWhenGridOnline =
        !overheatLocked &&
        miner.autoPowerOnGridRestore === true &&
        gridNow === true &&
        !shouldOff;

      if (shouldOff && device.on !== false) {
        const lockKey = `${miner.id}:OFF`;
        const lockedUntil = state.lockByKey[lockKey] ?? 0;
        if (now >= lockedUntil) {
          state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
          if (shouldOffByThreshold) {
            state.thresholdAutoOffAtByMiner[miner.id] = now;
          } else {
            delete state.thresholdAutoOffAtByMiner[miner.id];
          }
          await setTuyaSwitch(device.id, false, device.switchCode);
          await notify(`Auto OFF requested for ${device.name}.`, miner.id);
        }
        continue;
      }

      if ((shouldOnImmediate || shouldOnWhenGridOnline) && device.on !== true) {
        const lockKey = `${miner.id}:ON`;
        const lockedUntil = state.lockByKey[lockKey] ?? 0;
        if (now >= lockedUntil) {
          state.lockByKey[lockKey] = now + POWER_AUTOMATION_DEBOUNCE_MS;
          delete state.thresholdAutoOffAtByMiner[miner.id];
          await setTuyaSwitch(device.id, true, device.switchCode);
          await notify(`Auto ON requested for ${device.name} because grid is available.`, miner.id);
        }
        continue;
      }

      const thresholdOffAt = state.thresholdAutoOffAtByMiner[miner.id];
      const shouldAutoRestoreAfterThreshold =
        typeof thresholdOffAt === "number" &&
        device.on === false &&
        !overheatLocked &&
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
