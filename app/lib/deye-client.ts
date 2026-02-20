import { createHash } from "node:crypto";

type DeyeApiResponse = {
  success?: boolean;
  code?: string | number;
  msg?: string;
  data?: unknown;
  [key: string]: unknown;
};

export type DeyeStationSnapshot = {
  stationId: number;
  gridOnline: boolean | null;
  gridStateText: string | null;
  gridPowerKw: number | null;
  gridSignals: {
    source:
      | "wire_power"
      | "flag"
      | "text"
      | "power"
      | "charging_fallback"
      | "discharging_fallback"
      | "cached_previous"
      | "none";
    flag: {
      key: string | null;
      raw: string | number | boolean | null;
      parsed: boolean | null;
    };
    text: {
      key: string | null;
      value: string | null;
      parsed: boolean | null;
    };
    power: {
      key: string | null;
      raw: number | null;
      kw: number | null;
      parsed: boolean | null;
    };
    chargingFallbackParsed: boolean | null;
    dischargingFallbackParsed: boolean | null;
  };
  batterySoc: number | null;
  batteryStatus: string | null;
  batteryDischargePowerKw: number | null;
  generationPowerKw: number | null;
  apiSignals: Array<{
    key: string;
    value: string | number | boolean | null;
  }>;
  updatedAt: string;
  raw: unknown;
};

const DEFAULT_BASE_URL = "https://eu1-developer.deyecloud.com/v1.0";
const lastKnownGridByStation = new Map<number, boolean>();

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
  if (abs >= 100) return value / 1000;
  return value;
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
    "activePower",
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

export async function fetchDeyeStationSnapshot(): Promise<DeyeStationSnapshot> {
  const baseUrl = getEnv("DEYE_BASE_URL") || DEFAULT_BASE_URL;
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
  });
  const latestJson = (await latestResp.json().catch(() => ({}))) as DeyeApiResponse;
  if (!latestResp.ok || latestJson.success === false) {
    const code = latestJson.code ?? latestResp.status;
    const msg = latestJson.msg ?? "station/latest failed";
    throw new Error(`Deye station/latest failed (${code}): ${String(msg)}`);
  }
  return parseStationPayload(stationId, latestJson.data ?? latestJson);
}
