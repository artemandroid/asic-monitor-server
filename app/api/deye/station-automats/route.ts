import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  bindAutomatToDeyeStation,
  getDeyeStationAutomatsBindings,
  unbindAutomatFromDeyeStation,
} from "@/app/lib/deye-station-automats";
import { prisma } from "@/app/lib/prisma";
import { minerStates } from "@/app/lib/store";
import { requireWebAuth } from "@/app/lib/web-auth";

type PutBody = {
  stationId?: number;
  deviceId?: string;
  bind?: boolean;
};

function parseStationId(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const value = Math.trunc(raw);
  return value > 0 ? value : null;
}

async function clearMinerBindingsForDevice(deviceId: string): Promise<void> {
  try {
    await prisma.miner.updateMany({
      where: { boundTuyaDeviceId: deviceId },
      data: { boundTuyaDeviceId: null },
    });
    return;
  } catch {
    for (const state of minerStates.values()) {
      if (state.boundTuyaDeviceId === deviceId) {
        state.boundTuyaDeviceId = null;
      }
    }
  }
}

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const allBindings = await getDeyeStationAutomatsBindings();
    const stationIdParam = request.nextUrl.searchParams.get("stationId");
    if (!stationIdParam) {
      return NextResponse.json({ bindingsByStation: allBindings });
    }

    const stationId = Number.parseInt(stationIdParam, 10);
    if (!Number.isFinite(stationId) || stationId <= 0) {
      return NextResponse.json({ error: "stationId must be a positive integer" }, { status: 400 });
    }
    const stationKey = String(Math.trunc(stationId));
    return NextResponse.json({
      stationId: Math.trunc(stationId),
      deviceIds: allBindings[stationKey] ?? [],
      bindingsByStation: allBindings,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Deye station automats error" },
      { status: 502 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const stationId = parseStationId(body.stationId);
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const bind = body.bind === true;

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  try {
    const bindingsByStation = bind
      ? await bindAutomatToDeyeStation(stationId, deviceId)
      : await unbindAutomatFromDeyeStation(stationId, deviceId);
    if (!bind) {
      const deviceStillBoundToStation = Object.values(bindingsByStation).some((ids) => ids.includes(deviceId));
      if (!deviceStillBoundToStation) {
        await clearMinerBindingsForDevice(deviceId);
      }
    }
    return NextResponse.json({
      ok: true,
      stationId,
      deviceId,
      bind,
      bindingsByStation,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Deye station automats update error" },
      { status: 502 },
    );
  }
}
