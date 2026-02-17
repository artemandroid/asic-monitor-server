import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  const miners = await prisma.miner.findMany({
    orderBy: { id: "asc" },
  });
  const list = miners.map((miner) => ({
    minerId: miner.id,
    lastSeen: miner.lastSeen?.toISOString() ?? null,
    lastMetric: miner.lastMetric ?? null,
  }));
  return NextResponse.json(list);
}
