import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

type SyncBody = {
  minerIds?: string[];
  miners?: Array<{ id?: string; expectedHashrate?: number } | string>;
};

export async function POST(request: NextRequest) {
  const auth = requireAgentAuth(request);
  if (auth) return auth;

  let body: SyncBody;
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idsRaw = body?.minerIds ?? body?.miners;
  if (!Array.isArray(idsRaw)) {
    return NextResponse.json(
      { error: "minerIds must be an array of strings" },
      { status: 400 },
    );
  }

  const ids: string[] = [];
  for (const entry of idsRaw) {
    if (typeof entry === "string") {
      ids.push(entry);
      await prisma.miner.upsert({
        where: { id: entry },
        create: { id: entry, ip: entry },
        update: { ip: entry },
      });
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      return NextResponse.json(
        { error: "miners must be strings or objects with id" },
        { status: 400 },
      );
    }
    ids.push(entry.id);
    await prisma.miner.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        ip: entry.id,
        expectedHashrate:
          typeof entry.expectedHashrate === "number"
            ? entry.expectedHashrate
            : null,
      },
      update: {
        ip: entry.id,
        expectedHashrate:
          typeof entry.expectedHashrate === "number"
            ? entry.expectedHashrate
            : undefined,
      },
    });
  }

  await prisma.command.deleteMany({
    where: { minerId: { notIn: ids } },
  });
  const removed = await prisma.miner.deleteMany({
    where: { id: { notIn: ids } },
  });

  return NextResponse.json({ ok: true, removed: removed.count, kept: ids.length });
}
