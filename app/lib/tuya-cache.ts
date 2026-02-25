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

export async function getTuyaSnapshotCached({
  force = false,
  maxAgeMs = TUYA_CACHE_MAX_AGE_MS,
}: {
  force?: boolean;
  maxAgeMs?: number;
} = {}): Promise<TuyaCacheResult> {
  const memoryCache = getMemoryCache();
  const dbCache = memoryCache ? null : await readDbCache();
  const cached = memoryCache ?? dbCache;
  if (dbCache && !memoryCache) {
    setMemoryCache(dbCache.snapshot, dbCache.fetchedAt);
  }

  if (cached && !force && isFresh(cached, maxAgeMs)) {
    return { snapshot: cached.snapshot, fromCache: true, stale: false };
  }

  try {
    const snapshot = await fetchTuyaDevices();
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
