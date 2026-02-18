import { createHash, createHmac, randomUUID } from "node:crypto";

type TuyaApiResponse<T> = {
  success?: boolean;
  msg?: string;
  code?: number;
  result?: T;
};

type TuyaDeviceListItem = {
  id: string;
  name?: string;
  online?: boolean;
  category?: string;
  product_name?: string;
};

type TuyaStatusItem = {
  code: string;
  value: boolean | number | string;
};

export type TuyaDeviceView = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  switchCode: string | null;
  powerW: number | null;
  category: string | null;
  productName: string | null;
};

export type TuyaSnapshot = {
  updatedAt: string;
  total: number;
  devices: TuyaDeviceView[];
};

const regionHost: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function signHmacSha256(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex").toUpperCase();
}

function stringifyBody(body: unknown): string {
  if (body === undefined || body === null) return "";
  return typeof body === "string" ? body : JSON.stringify(body);
}

function buildStringToSign(method: string, pathWithQuery: string, bodyText: string): string {
  const contentHash = sha256Hex(bodyText);
  return [method.toUpperCase(), contentHash, "", pathWithQuery].join("\n");
}

async function tuyaRequest<T>({
  baseUrl,
  accessId,
  accessSecret,
  method,
  pathWithQuery,
  accessToken,
  body,
}: {
  baseUrl: string;
  accessId: string;
  accessSecret: string;
  method: "GET" | "POST";
  pathWithQuery: string;
  accessToken?: string;
  body?: unknown;
}): Promise<TuyaApiResponse<T>> {
  const t = Date.now().toString();
  const nonce = randomUUID();
  const bodyText = stringifyBody(body);
  const stringToSign = buildStringToSign(method, pathWithQuery, bodyText);
  const signPayload = `${accessId}${accessToken ?? ""}${t}${nonce}${stringToSign}`;
  const sign = signHmacSha256(signPayload, accessSecret);

  const headers: HeadersInit = {
    client_id: accessId,
    sign_method: "HMAC-SHA256",
    t,
    nonce,
    sign,
  };
  if (accessToken) headers.access_token = accessToken;
  if (method === "POST") headers["Content-Type"] = "application/json";

  const resp = await fetch(`${baseUrl}${pathWithQuery}`, {
    method,
    headers,
    body: method === "POST" ? bodyText : undefined,
    cache: "no-store",
  });
  const json = (await resp.json().catch(() => ({}))) as TuyaApiResponse<T>;
  if (!resp.ok || json.success === false) {
    const code = json.code ?? resp.status;
    const msg = json.msg ?? "Tuya request failed";
    throw new Error(`Tuya API failed (${code}): ${String(msg)}`);
  }
  return json;
}

function extractOn(status: TuyaStatusItem[]): boolean | null {
  const keys = ["switch_1", "switch", "switch_2", "switch_3", "switch_4", "switch_led"];
  for (const key of keys) {
    const found = status.find((s) => s.code === key);
    if (!found) continue;
    if (typeof found.value === "boolean") return found.value;
    if (typeof found.value === "string") {
      const v = found.value.toLowerCase();
      if (["true", "on", "opened", "open"].includes(v)) return true;
      if (["false", "off", "closed", "close"].includes(v)) return false;
    }
  }
  return null;
}

function extractPowerW(status: TuyaStatusItem[]): number | null {
  const map = new Map(status.map((s) => [s.code, s.value]));
  const directKeys = ["cur_power", "curPower", "power", "add_ele", "total_power"];
  for (const key of directKeys) {
    const val = map.get(key);
    if (typeof val === "number" && Number.isFinite(val)) {
      return val > 10000 ? val / 10 : val;
    }
  }
  return null;
}

function extractSwitchCode(status: TuyaStatusItem[]): string | null {
  const preferred = ["switch_1", "switch", "switch_2", "switch_3", "switch_4", "switch_led"];
  for (const key of preferred) {
    if (status.some((s) => s.code === key)) return key;
  }
  const anySwitch = status.find((s) => s.code.startsWith("switch"));
  return anySwitch?.code ?? null;
}

async function getToken(): Promise<{
  baseUrl: string;
  accessId: string;
  accessSecret: string;
  token: string;
}> {
  const accessId = env("TUYA_ACCESS_ID");
  const accessSecret = env("TUYA_ACCESS_SECRET");
  const region = (env("TUYA_REGION") || "eu").toLowerCase();
  const baseUrl = env("TUYA_BASE_URL") || regionHost[region] || regionHost.eu;

  if (!accessId || !accessSecret) {
    throw new Error("Tuya is not configured. Set TUYA_ACCESS_ID and TUYA_ACCESS_SECRET.");
  }

  const tokenResp = await tuyaRequest<{ access_token?: string }>({
    baseUrl,
    accessId,
    accessSecret,
    method: "GET",
    pathWithQuery: "/v1.0/token?grant_type=1",
  });
  const token = tokenResp.result?.access_token;
  if (!token) throw new Error("Tuya token response has no access_token");
  return { baseUrl, accessId, accessSecret, token };
}

export async function fetchTuyaDevices(): Promise<TuyaSnapshot> {
  const userId = env("TUYA_USER_ID");
  if (!userId) {
    throw new Error("Tuya is not configured. Set TUYA_USER_ID in .env");
  }
  const { baseUrl, accessId, accessSecret, token } = await getToken();

  const devicesResp = await tuyaRequest<TuyaDeviceListItem[]>({
    baseUrl,
    accessId,
    accessSecret,
    accessToken: token,
    method: "GET",
    pathWithQuery: `/v1.0/users/${encodeURIComponent(userId)}/devices`,
  });
  const devices = Array.isArray(devicesResp.result) ? devicesResp.result : [];

  const withStatus = await Promise.all(
    devices.map(async (device) => {
      try {
        const statusResp = await tuyaRequest<TuyaStatusItem[]>({
          baseUrl,
          accessId,
          accessSecret,
          accessToken: token,
          method: "GET",
          pathWithQuery: `/v1.0/devices/${encodeURIComponent(device.id)}/status`,
        });
        const status = Array.isArray(statusResp.result) ? statusResp.result : [];
        return {
          id: device.id,
          name: device.name || device.id,
          online: Boolean(device.online),
          on: extractOn(status),
          switchCode: extractSwitchCode(status),
          powerW: extractPowerW(status),
          category: device.category ?? null,
          productName: device.product_name ?? null,
        } as TuyaDeviceView;
      } catch {
        return {
          id: device.id,
          name: device.name || device.id,
          online: Boolean(device.online),
          on: null,
          switchCode: null,
          powerW: null,
          category: device.category ?? null,
          productName: device.product_name ?? null,
        } as TuyaDeviceView;
      }
    }),
  );

  const automatsOnly = withStatus.filter((d) => d.switchCode !== null);
  return {
    updatedAt: new Date().toISOString(),
    total: automatsOnly.length,
    devices: automatsOnly,
  };
}

export async function setTuyaSwitch(
  deviceId: string,
  on: boolean,
  code?: string | null,
): Promise<void> {
  const { baseUrl, accessId, accessSecret, token } = await getToken();
  const commandCode = (code || "switch_1").trim();
  const pathWithQuery = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/commands`;
  await tuyaRequest({
    baseUrl,
    accessId,
    accessSecret,
    accessToken: token,
    method: "POST",
    pathWithQuery,
    body: {
      commands: [{ code: commandCode, value: on }],
    },
  });
}
