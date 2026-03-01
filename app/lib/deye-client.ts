import { createHash } from "node:crypto";
import {
  DEYE_BASE_URL_DEFAULT,
  DEYE_HISTORY_DAY_TIME_ZONE_DEFAULT,
  DEYE_HISTORY_GENERATION_CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
  NIGHT_TARIFF_END_HOUR,
  NIGHT_TARIFF_START_HOUR,
} from "@/app/lib/constants";
import type { DeyeStationSnapshot } from "@/app/lib/deye-types";
import { useGlobalSlice } from "@/app/lib/global-state";

type DeyeApiResponse = {
  success?: boolean;
  code?: string | number;
  msg?: string;
  data?: unknown;
  [key: string]: unknown;
};

const lastKnownGridByStation = useGlobalSlice<Map<number, boolean>>("deyeGridCache", () => new Map());
const globalDeyeState = globalThis as unknown as {
  __deyeHistoryGenerationCache?: {
    timeZone: string;
    dayKey: string;
    fetchedAtMs: number;
    generationKwh: number | null;
  };
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function maybeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function maybeBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "on", "online", "connected", "yes", "1"].includes(v)) return true;
    if (["false", "off", "offline", "disconnected", "no", "0"].includes(v)) return false;
  }
  return null;
}

function collectCandidates(value: unknown, out: Map<string, unknown>) {
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  const keyLike =
    typeof obj.key === "string"
      ? obj.key
      : typeof obj.name === "string"
        ? obj.name
        : typeof obj.code === "string"
          ? obj.code
          : null;
  if (keyLike && "value" in obj) {
    out.set(normalizeKey(keyLike), obj.value);
  }

  for (const [k, v] of Object.entries(obj)) {
    out.set(normalizeKey(k), v);
    collectCandidates(v, out);
  }
}

function toPrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function collectPrimitiveSignals(
  value: unknown,
  path: string,
  out: Array<{ key: string; value: string | number | boolean | null }>,
  seen: Set<string>,
) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectPrimitiveSignals(item, `${path}[${index}]`, out, seen);
    });
    return;
  }
  if (typeof value !== "object") {
    const primitive = toPrimitive(value);
    if (primitive === null || !path || seen.has(path)) return;
    seen.add(path);
    out.push({ key: path, value: primitive });
    return;
  }

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${k}` : k;
    collectPrimitiveSignals(v, nextPath, out, seen);
  }
}

function extractApiSignals(payload: unknown): Array<{ key: string; value: string | number | boolean | null }> {
  const all: Array<{ key: string; value: string | number | boolean | null }> = [];
  const seen = new Set<string>();
  collectPrimitiveSignals(payload, "", all, seen);

  const priority = /(grid|battery|bat|pv|solar|generation|mains|line|ac|workmode|status|soc)/i;
  const prioritized = all.filter((item) => priority.test(item.key));
  const rest = all.filter((item) => !priority.test(item.key));

  return [...prioritized, ...rest].slice(0, 200);
}

type CandidateMatch<T> = {
  key: string;
  raw: unknown;
  value: T;
};

function pickNumberMatch(map: Map<string, unknown>, keys: string[]): CandidateMatch<number> | null {
  for (const key of keys) {
    const raw = map.get(normalizeKey(key));
    const val = maybeNumber(raw);
    if (val !== null) return { key, raw, value: val };
  }
  return null;
}

function pickBoolMatch(map: Map<string, unknown>, keys: string[]): CandidateMatch<boolean> | null {
  for (const key of keys) {
    const raw = map.get(normalizeKey(key));
    const val = maybeBool(raw);
    if (val !== null) return { key, raw, value: val };
  }
  return null;
}

function pickStringMatch(map: Map<string, unknown>, keys: string[]): CandidateMatch<string> | null {
  for (const key of keys) {
    const raw = map.get(normalizeKey(key));
    if (typeof raw === "string" && raw.trim()) return { key, raw, value: raw.trim() };
  }
  return null;
}

function parseGridText(value: string): boolean | null {
  const v = normalizeKey(value);
  if (!v) return null;
  const offlineHints = [
    "nogrid",
    "gridloss",
    "offgrid",
    "island",
    "disconnected",
    "disconnect",
    "absent",
    "fault",
  ];
  if (offlineHints.some((hint) => v.includes(hint))) return false;
  const onlineHints = [
    "ongrid",
    "gridon",
    "gridconnected",
    "connected",
    "normal",
    "online",
    "available",
    "present",
  ];
  if (onlineHints.some((hint) => v.includes(hint))) return true;
  return null;
}

function toKw(value: number | null): number | null {
  if (value === null) return null;
  const abs = Math.abs(value);
  // Deye often returns power in watts; convert safely to kW.
  // 1) definitely watts when value is large (>=100)
  // 2) also treat large integer two-digit values (e.g. 90) as watts
  if (abs >= 100 || (Number.isInteger(value) && abs >= 50)) return value / 1000;
  return value;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function resolveHistoryDayTimeZone(): string {
  const preferred =
    getEnv("DEYE_HISTORY_DAY_TIME_ZONE") ||
    getEnv("APP_TIME_ZONE") ||
    getEnv("TZ") ||
    DEYE_HISTORY_DAY_TIME_ZONE_DEFAULT;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: preferred }).format(new Date());
    return preferred;
  } catch {
    return DEYE_HISTORY_DAY_TIME_ZONE_DEFAULT;
  }
}

function hourInTimeZone(tsSec: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(tsSec * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function parseStationPayload(stationId: number, payload: unknown): DeyeStationSnapshot {
  const map = new Map<string, unknown>();
  collectCandidates(payload, map);

  const batterySoc = pickNumberMatch(map, [
    "batterySoc",
    "batteryCapacitySoc",
    "soc",
    "batteryPercent",
    "batteryLevel",
  ])?.value ?? null;

  const batteryPowerRaw = pickNumberMatch(map, [
    "batteryDischargePower",
    "batteryPower",
    "batPower",
    "essPower",
  ])?.value ?? null;
  const batteryPowerKw = toKw(batteryPowerRaw);
  const batteryStatus =
    pickStringMatch(map, ["batteryStatus", "batteryState", "chargeStatus", "batteryMode", "workMode"])?.value ??
    (batteryPowerKw === null
      ? null
      : batteryPowerKw > 0
        ? "discharging"
        : batteryPowerKw < 0
          ? "charging"
          : "idle");

  const generationPowerKw = toKw(pickNumberMatch(map, [
    "generationPower",
    "pvPower",
    "solarPower",
    "totalPvPower",
  ])?.value ?? null);
  const generationDayRaw = pickNumberMatch(map, [
    "generationDay",
    "dayGeneration",
    "todayGeneration",
    "generationToday",
    "pvGenerationDay",
    "todayPvGeneration",
    "todayYield",
    "eToday",
    "todayEnergy",
  ])?.value ?? null;
  const generationDayKwh =
    generationDayRaw !== null && Number.isFinite(generationDayRaw) && generationDayRaw >= 0
      ? generationDayRaw
      : null;
  const consumptionPowerKw = toKw(pickNumberMatch(map, [
    "consumptionPower",
    "loadPower",
    "totalLoadPower",
    "homeLoadPower",
    "loadActivePower",
  ])?.value ?? null);

  const gridFlagKeys = [
    "gridOnline",
    "gridConnected",
    "isGridConnected",
    "onGrid",
    "gridStatus",
    "isOnGrid",
    "lineConnected",
    "mainsConnected",
    "gridAvail",
    "gridAvailable",
    "acConnected",
  ];
  const gridTextKeys = [
    "gridState",
    "gridStatusText",
    "gridMode",
    "lineState",
    "mainsState",
    "acInputStatus",
    "workMode",
  ];
  const gridPowerKeys = [
    "wirePower",
    "gridPower",
    "gridActivePower",
    "toGridPower",
    "fromGridPower",
    "gridImportPower",
    "gridExportPower",
    "utilityPower",
    "linePower",
    "mainsPower",
    "loadFromGridPower",
  ];

  const gridFlagMatch = pickBoolMatch(map, gridFlagKeys);
  const gridFlagRawPrimitive = toPrimitive(gridFlagMatch?.raw);
  const isZeroGridFlag =
    gridFlagRawPrimitive === 0 || gridFlagRawPrimitive === "0";
  const gridOnlineByFlag = isZeroGridFlag ? null : (gridFlagMatch?.value ?? null);

  const gridTextMatch = pickStringMatch(map, gridTextKeys);
  const gridStateText = gridTextMatch?.value ?? null;
  const gridOnlineByText = gridStateText ? parseGridText(gridStateText) : null;

  const gridPowerMatch = pickNumberMatch(map, gridPowerKeys);
  const gridPowerRaw = gridPowerMatch?.value ?? null;
  const gridPowerKw = toKw(gridPowerRaw);
  // User rule: wirePower != 0 means grid is present; wirePower == 0 means grid is absent.
  // For other power fields keep conservative behavior (non-zero => online, zero => unknown).
  const isWirePower = gridPowerMatch?.key === "wirePower";
  const gridOnlineByWirePower =
    gridPowerRaw === null || !isWirePower ? null : Math.abs(gridPowerRaw) > 0.001;
  const gridOnlineByPower =
    gridPowerRaw === null
      ? null
      : isWirePower
        ? null
        : Math.abs(gridPowerRaw) > 0.05
          ? true
          : null;

  const batteryStatusNorm = (batteryStatus ?? "").trim().toLowerCase();
  const gridOnlineByChargingFallback =
    ((batteryPowerKw !== null && batteryPowerKw < -0.05) ||
      batteryStatusNorm.includes("charging")) &&
    (generationPowerKw === null || generationPowerKw < 0.05)
      ? true
      : null;
  const gridOnlineByDischargingFallback =
    ((batteryPowerKw !== null && batteryPowerKw > 0.05) ||
      batteryStatusNorm.includes("discharg")) &&
    (generationPowerKw === null || generationPowerKw < 0.05)
      ? false
      : null;

  const gridCandidate =
    gridOnlineByWirePower ??
    gridOnlineByFlag ??
    gridOnlineByText ??
    gridOnlineByPower ??
    gridOnlineByChargingFallback ??
    gridOnlineByDischargingFallback;
  const cachedPrevious = lastKnownGridByStation.get(stationId) ?? null;
  const gridOnline = gridCandidate ?? cachedPrevious;
  if (gridOnline !== null) {
    lastKnownGridByStation.set(stationId, gridOnline);
  }
  const gridSignalSource =
    gridOnlineByWirePower !== null
      ? "wire_power"
      : gridOnlineByFlag !== null
      ? "flag"
      : gridOnlineByText !== null
        ? "text"
        : gridOnlineByPower !== null
          ? "power"
          : gridOnlineByChargingFallback !== null
            ? "charging_fallback"
            : gridOnlineByDischargingFallback !== null
              ? "discharging_fallback"
            : cachedPrevious !== null
              ? "cached_previous"
              : "none";

  return {
    stationId,
    gridOnline,
    gridStateText,
    gridPowerKw,
    gridSignals: {
      source: gridSignalSource,
      flag: {
        key: gridFlagMatch?.key ?? null,
        raw: gridFlagRawPrimitive,
        parsed: gridOnlineByFlag,
      },
      text: {
        key: gridTextMatch?.key ?? null,
        value: gridStateText,
        parsed: gridOnlineByText,
      },
      power: {
        key: gridPowerMatch?.key ?? null,
        raw: gridPowerRaw,
        kw: gridPowerKw,
        parsed: gridOnlineByPower,
      },
      chargingFallbackParsed: gridOnlineByChargingFallback,
      dischargingFallbackParsed: gridOnlineByDischargingFallback,
    },
    batterySoc,
    batteryStatus,
    batteryDischargePowerKw: batteryPowerKw,
    generationPowerKw,
    generationDayKwh,
    consumptionPowerKw,
    apiSignals: extractApiSignals(payload),
    updatedAt: new Date().toISOString(),
    raw: payload,
  };
}

function getEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function getAccessToken(baseUrl: string, appId: string, appSecret: string): Promise<string> {
  const staticToken = getEnv("DEYE_ACCESS_TOKEN");
  if (staticToken) return staticToken;

  const email = getEnv("DEYE_EMAIL");
  const username = getEnv("DEYE_USERNAME");
  const mobile = getEnv("DEYE_MOBILE");
  const countryCode = getEnv("DEYE_COUNTRY_CODE");
  const companyId = getEnv("DEYE_COMPANY_ID");
  const passwordSha = getEnv("DEYE_PASSWORD_SHA256");
  const passwordPlain = getEnv("DEYE_PASSWORD");

  if (!email && !username && !mobile) {
    throw new Error("Deye login is not configured (set DEYE_EMAIL or DEYE_USERNAME or DEYE_MOBILE).");
  }
  if (!passwordSha && !passwordPlain) {
    throw new Error("Deye password is not configured (set DEYE_PASSWORD or DEYE_PASSWORD_SHA256).");
  }

  const body: Record<string, unknown> = {
    appSecret,
    password: passwordSha || sha256(passwordPlain),
  };
  if (email) body.email = email;
  else if (username) body.username = username;
  else {
    body.mobile = mobile;
    if (countryCode) body.countryCode = countryCode;
  }
  if (companyId) body.companyId = companyId;

  const tokenUrl = `${baseUrl}/account/token?appId=${encodeURIComponent(appId)}`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  const json = (await resp.json().catch(() => ({}))) as DeyeApiResponse;
  if (!resp.ok || json.success === false) {
    const code = json.code ?? resp.status;
    const msg = json.msg ?? "Token request failed";
    throw new Error(`Deye token failed (${code}): ${String(msg)}`);
  }

  const token =
    (json.data as { token?: string; accessToken?: string } | undefined)?.token ||
    (json.data as { token?: string; accessToken?: string } | undefined)?.accessToken ||
    (json as { token?: string; accessToken?: string }).token ||
    (json as { token?: string; accessToken?: string }).accessToken;
  if (!token) throw new Error("Deye token response does not contain token.");
  return token;
}

export type DeyeHistoryDaySummary = {
  generationKwh: number | null;
  consumptionKwh: number | null;
  importKwhDay: number | null;
  importKwhNight: number | null;
  exportKwh: number | null;
};

const globalHistoryDayCache = globalThis as unknown as {
  __deyeHistoryDayCache?: Map<string, { summary: DeyeHistoryDaySummary | null; fetchedAtMs: number }>;
};

function getHistoryDayCache(): Map<string, { summary: DeyeHistoryDaySummary | null; fetchedAtMs: number }> {
  if (!globalHistoryDayCache.__deyeHistoryDayCache) {
    globalHistoryDayCache.__deyeHistoryDayCache = new Map();
  }
  return globalHistoryDayCache.__deyeHistoryDayCache;
}

/** Fetch full-day power summary for a specific YYYY-MM-DD from the Deye history API.
 *  Integrates generation, consumption, and grid import/export over all returned intervals.
 *  Returns null when the API is unavailable or returns no data points. */
export async function fetchDeyeHistoryDaySummary(dayKey: string): Promise<DeyeHistoryDaySummary | null> {
  const now = Date.now();
  const cache = getHistoryDayCache();
  const cached = cache.get(dayKey);
  const timeZone = resolveHistoryDayTimeZone();
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  // Past days cache for 1 hour; today caches for 10 min (data is still accumulating)
  const ttl = dayKey === todayKey ? 10 * 60 * 1_000 : 60 * 60 * 1_000;
  if (cached && now - cached.fetchedAtMs < ttl) return cached.summary;

  const baseUrl = getEnv("DEYE_BASE_URL") || DEYE_BASE_URL_DEFAULT;
  const appId = getEnv("DEYE_APP_ID");
  const appSecret = getEnv("DEYE_APP_SECRET");
  const stationIdRaw = getEnv("DEYE_STATION_ID");
  const stationId = Number.parseInt(stationIdRaw, 10);
  if (!appId || !appSecret || !Number.isFinite(stationId)) return null;

  try {
    const token = await getAccessToken(baseUrl, appId, appSecret);
    const resp = await fetch(`${baseUrl}/station/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `bearer ${token}` },
      body: JSON.stringify({ stationId, granularity: 1, startAt: dayKey, endAt: dayKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const json = (await resp.json().catch(() => ({}))) as DeyeApiResponse & { stationDataItems?: unknown };
    if (!resp.ok || json.success === false) throw new Error("history failed");

    const rawItems: unknown[] = Array.isArray(json.stationDataItems)
      ? json.stationDataItems
      : Array.isArray((json.data as { stationDataItems?: unknown[] } | undefined)?.stationDataItems)
        ? ((json.data as { stationDataItems?: unknown[] }).stationDataItems ?? [])
        : [];

    console.log(`[deye-history] ${dayKey}: ${rawItems.length} raw items from API`);

    type Pt = { tsSec: number; genKw: number | null; gridKw: number | null; rawWire: number | null };
    const points: Pt[] = rawItems
      .map((item): Pt | null => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const tsSec = maybeNumber(row.timeStamp);
        if (tsSec === null || !Number.isFinite(tsSec)) return null;
        const genKw = toKw(
          maybeNumber(row.generationPower ?? row.pvPower ?? row.solarPower ?? row.totalPvPower),
        );
        const rawWire = maybeNumber(row.wirePower ?? row.gridPower ?? row.gridActivePower ?? row.fromGridPower);
        // wirePower in history API: sign convention auto-detected below.
        const gridKw = toKw(rawWire);
        return { tsSec, genKw, gridKw, rawWire };
      })
      .filter((p): p is Pt => p !== null)
      .sort((a, b) => a.tsSec - b.tsSec);

    if (points.length >= 2) {
      const first = points[0];
      const last = points[points.length - 1];
      const fmt = (tsSec: number) =>
        new Intl.DateTimeFormat("uk-UA", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(tsSec * 1000));
      console.log(
        `[deye-history] ${dayKey}: points span ${fmt(first.tsSec)}–${fmt(last.tsSec)} (${timeZone}), ` +
        `first genKw=${first.genKw} rawWire=${first.rawWire}, last genKw=${last.genKw} rawWire=${last.rawWire}`,
      );
      // Log first 5 and last 5 points for inspection
      const sample = [...points.slice(0, 5), ...(points.length > 10 ? points.slice(-5) : [])];
      for (const p of sample) {
        console.log(
          `  ts=${fmt(p.tsSec)} genKw=${p.genKw?.toFixed(3) ?? "null"} rawWire=${p.rawWire} gridKw=${p.gridKw?.toFixed(3) ?? "null"}`,
        );
      }
    }

    if (points.length < 2) {
      cache.set(dayKey, { summary: null, fetchedAtMs: now });
      return null;
    }

    let generationKwh = 0;
    let hasGrid = false;
    // Accumulate both sign conventions in parallel, then pick the physically plausible one.
    // Convention A: positive wirePower = export to grid, negative = import from grid.
    // Convention B: positive wirePower = import from grid, negative = export to grid.
    const accA = { importDay: 0, importNight: 0, exportDay: 0, exportNight: 0 };
    const accB = { importDay: 0, importNight: 0, export: 0 };

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const deltaHours = (curr.tsSec - prev.tsSec) / 3600;
      if (!Number.isFinite(deltaHours) || deltaHours <= 0 || deltaHours > 1) continue;

      if (prev.genKw !== null && curr.genKw !== null) {
        generationKwh += ((Math.max(0, prev.genKw) + Math.max(0, curr.genKw)) / 2) * deltaHours;
      }
      if (prev.gridKw !== null && curr.gridKw !== null) {
        hasGrid = true;
        const avgKw = (prev.gridKw + curr.gridKw) / 2;
        const midHour = hourInTimeZone((prev.tsSec + curr.tsSec) / 2, timeZone);
        const isNight = midHour >= NIGHT_TARIFF_START_HOUR || midHour < NIGHT_TARIFF_END_HOUR;
        const absKwh = Math.abs(avgKw) * deltaHours;
        if (avgKw > 0) {
          if (isNight) accA.exportNight += absKwh; else accA.exportDay += absKwh;
          if (isNight) accB.importNight += absKwh; else accB.importDay += absKwh;
        } else if (avgKw < 0) {
          if (isNight) accA.importNight += absKwh; else accA.importDay += absKwh;
          accB.export += absKwh;
        }
      }
    }

    const totalExportA = accA.exportDay + accA.exportNight;
    // Convention A is wrong if either:
    // (a) total export exceeds physically possible amount (> 1.5× generation + 10 kWh), OR
    // (b) significant night export (> 10 kWh) — no solar at night, miners don't export to grid.
    const useConvA = totalExportA <= generationKwh * 1.5 + 10 && accA.exportNight <= 10;
    const chosen = useConvA
      ? { importDay: accA.importDay, importNight: accA.importNight, export: totalExportA }
      : { importDay: accB.importDay, importNight: accB.importNight, export: accB.export };
    const importKwhDay = chosen.importDay;
    const importKwhNight = chosen.importNight;
    const exportKwh = chosen.export;

    console.log(
      `[deye-history] ${dayKey}: generationKwh=${generationKwh.toFixed(3)} hasGrid=${hasGrid}`,
    );
    console.log(
      `[deye-history] ${dayKey}: ConvA  importDay=${accA.importDay.toFixed(3)} importNight=${accA.importNight.toFixed(3)} exportDay=${accA.exportDay.toFixed(3)} exportNight=${accA.exportNight.toFixed(3)}`,
    );
    console.log(
      `[deye-history] ${dayKey}: ConvB  importDay=${accB.importDay.toFixed(3)} importNight=${accB.importNight.toFixed(3)} export=${accB.export.toFixed(3)}`,
    );
    console.log(
      `[deye-history] ${dayKey}: nightExportA=${accA.exportNight.toFixed(3)} totalExportA=${totalExportA.toFixed(3)} threshold=${(generationKwh * 1.5 + 10).toFixed(3)} → using Conv${useConvA ? "A (pos=export)" : "B (pos=import)"}`,
    );
    console.log(
      `[deye-history] ${dayKey}: CHOSEN importDay=${importKwhDay.toFixed(3)} importNight=${importKwhNight.toFixed(3)} export=${exportKwh.toFixed(3)}`,
    );

    const importKwhTotal = importKwhDay + importKwhNight;
    // Derive consumption from energy balance (more reliable than consumptionPower field).
    const consumptionKwh = hasGrid ? Math.max(0, generationKwh + importKwhTotal - exportKwh) : null;

    console.log(
      `[deye-history] ${dayKey}: consumptionKwh=${consumptionKwh?.toFixed(3) ?? "null"} (gen+imp-exp=${(generationKwh + importKwhTotal - exportKwh).toFixed(3)})`,
    );

    const summary: DeyeHistoryDaySummary = {
      generationKwh: generationKwh > 0 ? round2(generationKwh) : null,
      consumptionKwh: consumptionKwh !== null ? round2(consumptionKwh) : null,
      importKwhDay: hasGrid ? round2(importKwhDay) : null,
      importKwhNight: hasGrid ? round2(importKwhNight) : null,
      exportKwh: hasGrid ? round2(exportKwh) : null,
    };
    cache.set(dayKey, { summary, fetchedAtMs: now });
    return summary;
  } catch {
    cache.set(dayKey, { summary: null, fetchedAtMs: now });
    return null;
  }
}

export async function fetchDeyeStationSnapshot(): Promise<DeyeStationSnapshot> {
  const baseUrl = getEnv("DEYE_BASE_URL") || DEYE_BASE_URL_DEFAULT;
  const appId = getEnv("DEYE_APP_ID");
  const appSecret = getEnv("DEYE_APP_SECRET");
  const stationIdRaw = getEnv("DEYE_STATION_ID");
  const stationId = Number.parseInt(stationIdRaw, 10);
  if (!appId || !appSecret || !Number.isFinite(stationId)) {
    throw new Error("Deye is not configured. Set DEYE_APP_ID, DEYE_APP_SECRET, DEYE_STATION_ID in .env");
  }

  const token = await getAccessToken(baseUrl, appId, appSecret);
  const latestResp = await fetch(`${baseUrl}/station/latest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${token}`,
    },
    body: JSON.stringify({ stationId }),
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const latestJson = (await latestResp.json().catch(() => ({}))) as DeyeApiResponse;
  if (!latestResp.ok || latestJson.success === false) {
    const code = latestJson.code ?? latestResp.status;
    const msg = latestJson.msg ?? "station/latest failed";
    throw new Error(`Deye station/latest failed (${code}): ${String(msg)}`);
  }
  return parseStationPayload(stationId, latestJson.data ?? latestJson);
}

export async function fetchDeyeTodayGenerationKwhFromHistory(): Promise<number | null> {
  const now = new Date();
  const timeZone = resolveHistoryDayTimeZone();
  const dayKey = dateKeyInTimeZone(now, timeZone);
  const cached = globalDeyeState.__deyeHistoryGenerationCache;
  if (
    cached &&
    cached.timeZone === timeZone &&
    cached.dayKey === dayKey &&
    now.getTime() - cached.fetchedAtMs < DEYE_HISTORY_GENERATION_CACHE_TTL_MS
  ) {
    return cached.generationKwh;
  }

  const baseUrl = getEnv("DEYE_BASE_URL") || DEYE_BASE_URL_DEFAULT;
  const appId = getEnv("DEYE_APP_ID");
  const appSecret = getEnv("DEYE_APP_SECRET");
  const stationIdRaw = getEnv("DEYE_STATION_ID");
  const stationId = Number.parseInt(stationIdRaw, 10);
  if (!appId || !appSecret || !Number.isFinite(stationId)) return null;

  try {
    const token = await getAccessToken(baseUrl, appId, appSecret);
    const historyResp = await fetch(`${baseUrl}/station/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `bearer ${token}`,
      },
      body: JSON.stringify({
        stationId,
        granularity: 1,
        startAt: dayKey,
        endAt: dayKey,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const historyJson = (await historyResp.json().catch(() => ({}))) as DeyeApiResponse & {
      stationDataItems?: unknown;
    };
    if (!historyResp.ok || historyJson.success === false) {
      throw new Error(`station/history failed (${String(historyJson.code ?? historyResp.status)})`);
    }

    const rawItems = Array.isArray(historyJson.stationDataItems)
      ? historyJson.stationDataItems
      : Array.isArray((historyJson.data as { stationDataItems?: unknown } | undefined)?.stationDataItems)
        ? ((historyJson.data as { stationDataItems?: unknown[] }).stationDataItems ?? [])
        : [];

    const points = rawItems
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const tsSec = maybeNumber(row.timeStamp);
        const powerKw = toKw(maybeNumber(row.generationPower));
        if (tsSec === null || powerKw === null) return null;
        if (!Number.isFinite(tsSec) || !Number.isFinite(powerKw)) return null;
        return { tsSec, powerKw };
      })
      .filter((point): point is { tsSec: number; powerKw: number } => point !== null)
      .sort((a, b) => a.tsSec - b.tsSec);

    let generationKwh: number | null = null;
    if (points.length >= 2) {
      let sumKwh = 0;
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const deltaHours = (curr.tsSec - prev.tsSec) / 3600;
        if (!Number.isFinite(deltaHours) || deltaHours <= 0 || deltaHours > 1) continue;
        const avgKw = (prev.powerKw + curr.powerKw) / 2;
        sumKwh += avgKw * deltaHours;
      }
      generationKwh = sumKwh >= 0 ? round2(sumKwh) : null;
    }

    globalDeyeState.__deyeHistoryGenerationCache = {
      timeZone,
      dayKey,
      fetchedAtMs: now.getTime(),
      generationKwh,
    };
    return generationKwh;
  } catch {
    globalDeyeState.__deyeHistoryGenerationCache = {
      timeZone,
      dayKey,
      fetchedAtMs: now.getTime(),
      generationKwh: null,
    };
    return null;
  }
}
