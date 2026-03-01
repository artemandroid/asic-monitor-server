import { prisma } from "@/app/lib/prisma";
import { fetchTuyaDevices, type TuyaSnapshot } from "@/app/lib/tuya-client";
import { TUYA_CACHE_MAX_AGE_MS } from "@/app/lib/constants";
import { useGlobalSlice } from "@/app/lib/global-state";

export { TUYA_CACHE_MAX_AGE_MS };

type TuyaCacheRecord = {
  snapshot: TuyaSnapshot;
  fetchedAt: Date;
};

type TuyaCacheResult = {
  snapshot: TuyaSnapshot;
  fromCache: boolean;
  stale: boolean;
  error?: string;
};

type TuyaCacheSlice = { record: TuyaCacheRecord | null };
const tuyaCacheSlice = useGlobalSlice<TuyaCacheSlice>("tuyaCache", () => ({ record: null }));

function isTuyaSnapshot(value: unknown): value is TuyaSnapshot {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<TuyaSnapshot>;
  return typeof maybe.updatedAt === "string" && typeof maybe.total === "number" && Array.isArray(maybe.devices);
}

async function readDbCache(): Promise<TuyaCacheRecord | null> {
  if (!prisma) return null;
  try {
    const row = await prisma.tuyaSnapshotCache.findUnique({ where: { id: 1 } });
    if (!row || !isTuyaSnapshot(row.snapshot)) return null;
    return { snapshot: row.snapshot, fetchedAt: row.fetchedAt };
  } catch {
    return null;
  }
}

async function writeDbCache(snapshot: TuyaSnapshot, fetchedAt: Date): Promise<void> {
  if (!prisma) return;
  try {
    await prisma.tuyaSnapshotCache.upsert({
      where: { id: 1 },
      create: { id: 1, snapshot, fetchedAt },
      update: { snapshot, fetchedAt },
    });
  } catch {
    // ignore; memory fallback remains available
  }
}

function getMemoryCache(): TuyaCacheRecord | null {
  return tuyaCacheSlice.record;
}

function setMemoryCache(snapshot: TuyaSnapshot, fetchedAt: Date): void {
  tuyaCacheSlice.record = { snapshot, fetchedAt };
}

function isFresh(record: TuyaCacheRecord, maxAgeMs: number): boolean {
  return Date.now() - record.fetchedAt.getTime() <= maxAgeMs;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function hoursBetweenIso(fromIso: string | null | undefined, toIso: string | null | undefined): number {
  if (!fromIso || !toIso) return 0;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  const deltaMs = to - from;
  if (deltaMs <= 0) return 0;
  return deltaMs / (60 * 60 * 1000);
}

function dayKeyLocal(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function backfillEnergyTotals(
  snapshot: TuyaSnapshot,
  previousSnapshot: TuyaSnapshot | null,
): TuyaSnapshot {
  const prevById = new Map((previousSnapshot?.devices ?? []).map((d) => [d.id, d]));
  const currentDay = dayKeyLocal(snapshot.updatedAt);
  const previousDay = dayKeyLocal(previousSnapshot?.updatedAt ?? null);
  const sameDayAsPrevious = currentDay !== null && currentDay === previousDay;
  const elapsedHoursSincePrevious = hoursBetweenIso(
    previousSnapshot?.updatedAt ?? null,
    snapshot.updatedAt,
  );

  const devices = snapshot.devices.map((device) => {
    const currentRawToday =
      asFiniteNumber((device as { energyTodayRawKwh?: unknown }).energyTodayRawKwh) ??
      asFiniteNumber(device.energyTodayKwh);
    const currentTodaySource =
      typeof (device as { energyTodaySourceCode?: unknown }).energyTodaySourceCode === "string"
        ? String((device as { energyTodaySourceCode?: unknown }).energyTodaySourceCode)
        : null;

    const explicitTotal = asFiniteNumber(device.energyTotalKwh);
    const prev = prevById.get(device.id);
    const prevDisplayToday = asFiniteNumber(prev?.energyTodayKwh);
    const prevRawToday =
      asFiniteNumber((prev as { energyTodayRawKwh?: unknown } | undefined)?.energyTodayRawKwh) ??
      asFiniteNumber(prev?.energyTodayKwh);
    const currentPowerW = asFiniteNumber(device.powerW);
    const currentPowerKw = currentPowerW !== null ? Math.max(0, currentPowerW) / 1000 : 0;
    const powerDeltaKwh = elapsedHoursSincePrevious > 0 ? currentPowerKw * elapsedHoursSincePrevious : 0;

    let normalizedToday = currentRawToday;
    const unitMismatchAfterScaleChange =
      currentTodaySource === "add_ele" &&
      currentRawToday !== null &&
      prevRawToday !== null &&
      currentRawToday > 0 &&
      prevRawToday > 0 &&
      (prevRawToday / currentRawToday > 20 || currentRawToday / prevRawToday > 20);
    if (
      currentTodaySource === "add_ele" &&
      currentRawToday !== null &&
      !unitMismatchAfterScaleChange &&
      sameDayAsPrevious &&
      prevDisplayToday !== null &&
      prevRawToday !== null
    ) {
      const resetDetected = currentRawToday + 0.0005 < prevRawToday;
      const delta = resetDetected
        ? Math.max(0, currentRawToday)
        : Math.max(0, currentRawToday - prevRawToday);
      normalizedToday = prevDisplayToday + delta;
    }
    if (
      currentTodaySource === "add_ele" &&
      prevDisplayToday !== null &&
      sameDayAsPrevious &&
      elapsedHoursSincePrevious > 0
    ) {
      // add_ele may stall on some devices; progress today's kWh by measured power between samples.
      normalizedToday = Math.max(normalizedToday ?? 0, prevDisplayToday + powerDeltaKwh);
    }

    const normalizedDevice = {
      ...device,
      energyTodayRawKwh:
        currentRawToday === null ? null : Math.max(0, round3(currentRawToday)),
      energyTodayKwh:
        normalizedToday === null ? null : Math.max(0, round3(normalizedToday)),
    };

    if (explicitTotal !== null) {
      return {
        ...normalizedDevice,
        energyTotalKwh: Math.max(0, round3(explicitTotal)),
      };
    }

    const today = asFiniteNumber(normalizedDevice.energyTodayKwh);
    const prevTotal = asFiniteNumber(prev?.energyTotalKwh);
    const prevToday = prevDisplayToday;

    let estimatedTotal: number | null = null;
    if (prevTotal !== null) {
      estimatedTotal = prevTotal;
      if (today !== null && prevToday !== null) {
        const resetDetected = today + 0.05 < prevToday;
        if (resetDetected) {
          estimatedTotal = prevTotal + Math.max(0, today);
        } else {
          estimatedTotal = prevTotal + Math.max(0, today - prevToday);
        }
      }
    } else if (today !== null) {
      // No lifetime meter from Tuya API: bootstrap local cumulative total from current day.
      estimatedTotal = today;
    }

    return {
      ...normalizedDevice,
      energyTotalKwh:
        estimatedTotal === null
          ? null
          : Math.max(0, round3(estimatedTotal)),
    };
  });

  return {
    ...snapshot,
    devices,
  };
}

function ensureDisplayTotals(snapshot: TuyaSnapshot): TuyaSnapshot {
  const devices = snapshot.devices.map((device) => {
    const explicitTotal = asFiniteNumber(device.energyTotalKwh);
    if (explicitTotal !== null) {
      return {
        ...device,
        energyTotalKwh: Math.max(0, round3(explicitTotal)),
      };
    }
    const today = asFiniteNumber(device.energyTodayKwh);
    if (today === null) return device;
    return {
      ...device,
      energyTotalKwh: Math.max(0, round3(today)),
    };
  });
  return {
    ...snapshot,
    devices,
  };
}

function projectTodayEnergyByPower(
  snapshot: TuyaSnapshot,
  fetchedAt: Date,
  now: Date,
): TuyaSnapshot {
  const elapsedHours = (now.getTime() - fetchedAt.getTime()) / (60 * 60 * 1000);
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return snapshot;

  const devices = snapshot.devices.map((device) => {
    const source =
      typeof (device as { energyTodaySourceCode?: unknown }).energyTodaySourceCode === "string"
        ? String((device as { energyTodaySourceCode?: unknown }).energyTodaySourceCode)
        : null;
    // Only project for add_ele-based meters; reliable daily counters should come from device directly.
    if (source !== "add_ele") return device;

    const powerW = asFiniteNumber(device.powerW);
    if (powerW === null || powerW <= 0) return device;

    const baseToday = asFiniteNumber(device.energyTodayKwh) ?? 0;
    const projected = baseToday + (powerW / 1000) * elapsedHours;
    return {
      ...device,
      energyTodayKwh: Math.max(0, round3(projected)),
    };
  });

  return {
    ...snapshot,
    devices,
  };
}

function emptySnapshot(): TuyaSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    total: 0,
    devices: [],
  };
}

async function loadCachedRecord(): Promise<TuyaCacheRecord | null> {
  const memoryCache = getMemoryCache();
  const dbCache = memoryCache ? null : await readDbCache();
  const cached = memoryCache ?? dbCache;
  if (dbCache && !memoryCache) {
    setMemoryCache(dbCache.snapshot, dbCache.fetchedAt);
  }
  return cached;
}

export async function getTuyaSnapshotCached({
  force = false,
  maxAgeMs = TUYA_CACHE_MAX_AGE_MS,
}: {
  force?: boolean;
  maxAgeMs?: number;
} = {}): Promise<TuyaCacheResult> {
  const cached = await loadCachedRecord();

  if (cached && !force && isFresh(cached, maxAgeMs)) {
    return { snapshot: cached.snapshot, fromCache: true, stale: false };
  }

  try {
    const snapshotRaw = await fetchTuyaDevices();
    const snapshot = backfillEnergyTotals(snapshotRaw, cached?.snapshot ?? null);
    const fetchedAt = new Date();
    setMemoryCache(snapshot, fetchedAt);
    await writeDbCache(snapshot, fetchedAt);
    return { snapshot, fromCache: false, stale: false };
  } catch (error) {
    if (!cached) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown Tuya cache refresh error";
    return {
      snapshot: cached.snapshot,
      fromCache: true,
      stale: true,
      error: message,
    };
  }
}

export async function getTuyaSnapshotStored({
  maxAgeMs = TUYA_CACHE_MAX_AGE_MS,
}: {
  maxAgeMs?: number;
} = {}): Promise<TuyaCacheResult> {
  const cached = await loadCachedRecord();
  if (!cached) {
    return {
      snapshot: emptySnapshot(),
      fromCache: true,
      stale: true,
    };
  }
  const projected = projectTodayEnergyByPower(cached.snapshot, cached.fetchedAt, new Date());
  return {
    snapshot: ensureDisplayTotals(projected),
    fromCache: true,
    stale: !isFresh(cached, maxAgeMs),
  };
}

export async function patchTuyaDeviceSwitchState(deviceId: string, on: boolean): Promise<void> {
  try {
    const cached = await loadCachedRecord();
    if (!cached) return;
    if (!cached.snapshot.devices.some((device) => device.id === deviceId)) return;

    const patchedSnapshot: TuyaSnapshot = {
      ...cached.snapshot,
      updatedAt: new Date().toISOString(),
      devices: cached.snapshot.devices.map((device) =>
        device.id === deviceId
          ? { ...device, on }
          : device,
      ),
    };
    // Keep original fetch timestamp: local ON/OFF patch must not extend Tuya cache freshness.
    const fetchedAt = cached.fetchedAt;
    setMemoryCache(patchedSnapshot, fetchedAt);
    await writeDbCache(patchedSnapshot, fetchedAt);
  } catch {
    // Non-critical: cache patching should not break command flow.
  }
}
