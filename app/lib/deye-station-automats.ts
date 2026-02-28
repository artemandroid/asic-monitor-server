import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { useGlobalSlice } from "@/app/lib/global-state";

type BindingsByStation = Record<string, string[]>;

type StoreShape = {
  bindingsByStation: BindingsByStation;
};

type StoreSlice = {
  store: StoreShape;
  writeChain: Promise<unknown>;
};

const DEFAULT_STORE: StoreShape = { bindingsByStation: {} };
const STORE_FILE_NAME = "deye.station.automats.json";

const storeSlice = useGlobalSlice<StoreSlice>("deyeStationAutomats", () => ({
  store: DEFAULT_STORE,
  writeChain: Promise.resolve(),
}));

function getStorePath(): string {
  const fromEnv = (process.env.DEYE_STATION_AUTOMATS_PATH ?? "").trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), STORE_FILE_NAME);
}

function normalizeStationKey(stationId: number): string | null {
  if (!Number.isFinite(stationId)) return null;
  const normalized = Math.trunc(stationId);
  if (normalized <= 0) return null;
  return String(normalized);
}

function normalizeDeviceId(deviceId: string): string | null {
  const normalized = deviceId.trim();
  return normalized ? normalized : null;
}

function sanitizeBindings(value: unknown): BindingsByStation {
  if (!value || typeof value !== "object") return {};
  const next: BindingsByStation = {};
  for (const [stationKeyRaw, deviceIdsRaw] of Object.entries(value as Record<string, unknown>)) {
    const stationNumber = Number.parseInt(stationKeyRaw, 10);
    const stationKey = normalizeStationKey(stationNumber);
    if (!stationKey || !Array.isArray(deviceIdsRaw)) continue;
    const unique = new Set<string>();
    for (const item of deviceIdsRaw) {
      if (typeof item !== "string") continue;
      const deviceId = normalizeDeviceId(item);
      if (!deviceId) continue;
      unique.add(deviceId);
    }
    if (unique.size > 0) {
      next[stationKey] = [...unique];
    }
  }
  return next;
}

function sanitizeStore(value: unknown): StoreShape {
  if (!value || typeof value !== "object") return { bindingsByStation: {} };
  const parsed = value as Partial<StoreShape>;
  return { bindingsByStation: sanitizeBindings(parsed.bindingsByStation) };
}

function cloneBindings(bindings: BindingsByStation): BindingsByStation {
  const next: BindingsByStation = {};
  for (const [stationKey, deviceIds] of Object.entries(bindings)) {
    next[stationKey] = [...deviceIds];
  }
  return next;
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(getStorePath(), "utf8");
    const parsed = sanitizeStore(JSON.parse(raw));
    storeSlice.store = parsed;
    return parsed;
  } catch {
    return storeSlice.store;
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  storeSlice.store = store;
  try {
    const filePath = getStorePath();
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
    await rename(tempPath, filePath);
  } catch {
    // Keep in-memory state even if file write is unavailable.
  }
}

async function withStoreWriteLock<T>(op: () => Promise<T>): Promise<T> {
  const chain = storeSlice.writeChain;
  const run = chain.then(op, op);
  storeSlice.writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function upsertBinding(
  bindings: BindingsByStation,
  stationKey: string,
  deviceId: string,
): BindingsByStation {
  const next = cloneBindings(bindings);
  for (const key of Object.keys(next)) {
    next[key] = next[key].filter((id) => id !== deviceId);
    if (next[key].length === 0) delete next[key];
  }
  const current = next[stationKey] ?? [];
  if (!current.includes(deviceId)) {
    current.push(deviceId);
  }
  next[stationKey] = current;
  return next;
}

function removeBinding(
  bindings: BindingsByStation,
  stationKey: string,
  deviceId: string,
): BindingsByStation {
  const next = cloneBindings(bindings);
  const current = next[stationKey] ?? [];
  const filtered = current.filter((id) => id !== deviceId);
  if (filtered.length > 0) {
    next[stationKey] = filtered;
  } else {
    delete next[stationKey];
  }
  return next;
}

export async function getDeyeStationAutomatsBindings(): Promise<BindingsByStation> {
  const store = await readStore();
  return cloneBindings(store.bindingsByStation);
}

export async function bindAutomatToDeyeStation(
  stationId: number,
  deviceIdRaw: string,
): Promise<BindingsByStation> {
  const stationKey = normalizeStationKey(stationId);
  const deviceId = normalizeDeviceId(deviceIdRaw);
  if (!stationKey || !deviceId) {
    return getDeyeStationAutomatsBindings();
  }
  return withStoreWriteLock(async () => {
    const store = await readStore();
    const bindingsByStation = upsertBinding(store.bindingsByStation, stationKey, deviceId);
    await writeStore({ bindingsByStation });
    return cloneBindings(bindingsByStation);
  });
}

export async function unbindAutomatFromDeyeStation(
  stationId: number,
  deviceIdRaw: string,
): Promise<BindingsByStation> {
  const stationKey = normalizeStationKey(stationId);
  const deviceId = normalizeDeviceId(deviceIdRaw);
  if (!stationKey || !deviceId) {
    return getDeyeStationAutomatsBindings();
  }
  return withStoreWriteLock(async () => {
    const store = await readStore();
    const bindingsByStation = removeBinding(store.bindingsByStation, stationKey, deviceId);
    await writeStore({ bindingsByStation });
    return cloneBindings(bindingsByStation);
  });
}
