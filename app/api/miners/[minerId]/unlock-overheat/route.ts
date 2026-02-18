import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { minerStates } from "@/app/lib/store";
import { canAccessMiner } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";

type Params = { params: Promise<{ minerId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { minerId } = await params;
  const id = decodeURIComponent(minerId);

  try {
    const allMinerIds = (await prisma.miner.findMany({ select: { id: true } })).map(
      (m: { id: string }) => m.id,
    );
    if (!canAccessMiner(auth.email, id, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updated = await prisma.miner.update({
      where: { id },
      data: {
        overheatLocked: false,
        overheatLockedAt: null,
      },
    });

    return NextResponse.json({
      ok: true,
      minerId: updated.id,
      overheatLocked: updated.overheatLocked,
      overheatLockedAt: updated.overheatLockedAt?.toISOString() ?? null,
      overheatLastTempC: updated.overheatLastTempC ?? null,
    });
  } catch {
    const allMinerIds = Array.from(minerStates.keys());
    if (!canAccessMiner(auth.email, id, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const miner = minerStates.get(id);
    if (!miner) {
      return NextResponse.json({ error: "Miner not found" }, { status: 404 });
    }

    miner.overheatLocked = false;
    miner.overheatLockedAt = null;
    minerStates.set(id, miner);

    return NextResponse.json({
      ok: true,
      minerId: miner.minerId,
      overheatLocked: miner.overheatLocked ?? false,
      overheatLockedAt: miner.overheatLockedAt ?? null,
      overheatLastTempC: miner.overheatLastTempC ?? null,
      storage: "memory",
    });
  }
}
