import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { notifications } from "@/app/lib/store";
import { getAllowedMinerIds } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const allMinerIds = (await prisma.miner.findMany({ select: { id: true } })).map(
      (m: { id: string }) => m.id,
    );
    const allowedMinerIds = getAllowedMinerIds(auth.email, allMinerIds);
    const list = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(
      list
      .filter((n: { minerId: string | null }) => !n.minerId || allowedMinerIds.has(n.minerId))
      .map((n: {
        id: string;
        type: string;
        message: string;
        minerId: string | null;
        action: string | null;
        createdAt: Date;
      }) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        minerId: n.minerId ?? undefined,
        action: n.action ?? undefined,
        createdAt: n.createdAt.toISOString(),
      })),
    );
  } catch {
    const allowedMinerIds = getAllowedMinerIds(auth.email, Array.from(new Set(
      notifications.map((n) => n.minerId).filter((v): v is string => Boolean(v)),
    )));
    return NextResponse.json(
      [...notifications]
        .slice(-100)
        .reverse()
        .filter((n) => !n.minerId || allowedMinerIds.has(n.minerId)),
    );
  }
}
