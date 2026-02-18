import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { minerStates } from "@/app/lib/store";
import { canAccessMiner, getAllowedMinerIds } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";

type PutBody = {
  minerId?: string;
  deviceId?: string | null;
};

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const email = auth.email;

  try {
    const miners = await prisma.miner.findMany({
      select: { id: true, boundTuyaDeviceId: true },
      orderBy: { id: "asc" },
    });
    const allowed = getAllowedMinerIds(
      email,
      miners.map((m: { id: string }) => m.id),
    );
    const bindings: Record<string, string> = {};
    for (const miner of miners) {
      if (!allowed.has(miner.id)) continue;
      if (typeof miner.boundTuyaDeviceId === "string" && miner.boundTuyaDeviceId) {
        bindings[miner.id] = miner.boundTuyaDeviceId;
      }
    }
    return NextResponse.json({ bindings });
  } catch {
    const allMinerIds = Array.from(minerStates.keys());
    const allowed = getAllowedMinerIds(email, allMinerIds);
    const bindings: Record<string, string> = {};
    for (const [minerId, state] of minerStates.entries()) {
      if (!allowed.has(minerId)) continue;
      if (typeof state.boundTuyaDeviceId === "string" && state.boundTuyaDeviceId) {
        bindings[minerId] = state.boundTuyaDeviceId;
      }
    }
    return NextResponse.json({ bindings, storage: "memory" });
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const email = auth.email;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const minerId = (body.minerId ?? "").trim();
  if (!minerId) {
    return NextResponse.json({ error: "minerId is required" }, { status: 400 });
  }
  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim()
      : null;

  try {
    const allMinerIds = (await prisma.miner.findMany({ select: { id: true } })).map(
      (m: { id: string }) => m.id,
    );
    if (!canAccessMiner(email, minerId, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await prisma.$transaction(async (tx: typeof prisma) => {
      if (deviceId) {
        await tx.miner.updateMany({
          where: { boundTuyaDeviceId: deviceId, id: { not: minerId } },
          data: { boundTuyaDeviceId: null },
        });
      }
      await tx.miner.update({
        where: { id: minerId },
        data: { boundTuyaDeviceId: deviceId },
      });
    });
    return NextResponse.json({ ok: true, minerId, deviceId });
  } catch {
    const allMinerIds = Array.from(minerStates.keys());
    if (!canAccessMiner(email, minerId, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (deviceId) {
      for (const state of minerStates.values()) {
        if (state.boundTuyaDeviceId === deviceId && state.minerId !== minerId) {
          state.boundTuyaDeviceId = null;
        }
      }
    }
    const target = minerStates.get(minerId);
    if (!target) {
      return NextResponse.json({ error: "Miner not found" }, { status: 404 });
    }
    target.boundTuyaDeviceId = deviceId;
    minerStates.set(minerId, target);
    return NextResponse.json({ ok: true, minerId, deviceId, storage: "memory" });
  }
}
