import { prisma } from "@/app/lib/prisma";
import { fetchTuyaDevices, type TuyaSnapshot } from "@/app/lib/tuya-client";

export const TUYA_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

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

const globalTuyaCache = globalThis as unknown as { __tuyaSnapshotCache?: TuyaCacheRecord };

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
  return globalTuyaCache.__tuyaSnapshotCache ?? null;
}

function setMemoryCache(snapshot: TuyaSnapshot, fetchedAt: Date): void {
  globalTuyaCache.__tuyaSnapshotCache = { snapshot, fetchedAt };
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

function backfillEnergyTotals(
  snapshot: TuyaSnapshot,
  previousSnapshot: TuyaSnapshot | null,
): TuyaSnapshot {
  const prevById = new Map((previousSnapshot?.devices ?? []).map((d) => [d.id, d]));
  const devices = snapshot.devices.map((device) => {
    const explicitTotal = asFiniteNumber(device.energyTotalKwh);
    if (explicitTotal !== null) {
      return {
        ...device,
        energyTotalKwh: Math.max(0, round3(explicitTotal)),
      };
    }

    const today = asFiniteNumber(device.energyTodayKwh);
    const prev = prevById.get(device.id);
    const prevTotal = asFiniteNumber(prev?.energyTotalKwh);
    const prevToday = asFiniteNumber(prev?.energyTodayKwh);

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
      ...device,
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
  return {
    snapshot: ensureDisplayTotals(cached.snapshot),
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
    const fetchedAt = new Date();
    setMemoryCache(patchedSnapshot, fetchedAt);
    await writeDbCache(patchedSnapshot, fetchedAt);
  } catch {
    // Non-critical: cache patching should not break command flow.
  }
}
