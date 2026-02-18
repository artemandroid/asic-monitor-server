import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { commands, minerStates } from "@/app/lib/store";

type SyncBody = {
  minerIds?: string[];
  miners?: Array<{ id?: string; expectedHashrate?: number } | string>;
};

function toGh(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 500 ? value / 1000 : value;
}

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

  const entries: Array<{ id: string; expectedHashrate?: number | null }> = [];
  for (const entry of idsRaw) {
    if (typeof entry === "string") {
      entries.push({ id: entry });
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      return NextResponse.json(
        { error: "miners must be strings or objects with id" },
        { status: 400 },
      );
    }
    entries.push({
      id: entry.id,
      expectedHashrate:
        typeof entry.expectedHashrate === "number" ? entry.expectedHashrate : null,
    });
  }

  const ids = entries.map((e) => e.id);

  try {
    for (const entry of entries) {
      const expectedGh = toGh(entry.expectedHashrate ?? null);
      const defaultThresholdGh =
        typeof expectedGh === "number" ? Number((expectedGh * 0.6).toFixed(2)) : 10;
      const existing = await prisma.miner.findUnique({ where: { id: entry.id } });
      await prisma.miner.upsert({
        where: { id: entry.id },
        create: {
          id: entry.id,
          ip: entry.id,
          expectedHashrate: entry.expectedHashrate ?? null,
          autoRestartEnabled: false,
          postRestartGraceMinutes: 10,
          lowHashrateThresholdGh: defaultThresholdGh,
          autoPowerRestoreDelayMinutes: 10,
          overheatProtectionEnabled: true,
          overheatShutdownTempC: 84,
          overheatLocked: false,
          overheatLockedAt: null,
          overheatLastTempC: null,
        },
        update: {
          ip: entry.id,
          expectedHashrate: entry.expectedHashrate ?? undefined,
          lowHashrateThresholdGh:
            existing?.lowHashrateThresholdGh == null ? defaultThresholdGh : undefined,
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
  } catch {
    for (const entry of entries) {
      const existing = minerStates.get(entry.id);
      const expectedGh = toGh(entry.expectedHashrate ?? null);
      minerStates.set(entry.id, {
        minerId: entry.id,
        lastSeen: existing?.lastSeen ?? null,
        lastMetric: existing?.lastMetric ?? null,
        expectedHashrate:
          entry.expectedHashrate ?? existing?.expectedHashrate ?? undefined,
        autoRestartEnabled: existing?.autoRestartEnabled ?? false,
        postRestartGraceMinutes: existing?.postRestartGraceMinutes ?? 10,
        lowHashrateThresholdGh:
          existing?.lowHashrateThresholdGh ??
          (typeof expectedGh === "number" ? Number((expectedGh * 0.6).toFixed(2)) : 10),
        autoPowerOnGridRestore: existing?.autoPowerOnGridRestore ?? false,
        autoPowerOffGridLoss: existing?.autoPowerOffGridLoss ?? false,
        boundTuyaDeviceId: existing?.boundTuyaDeviceId ?? null,
        autoPowerOffGenerationBelowKw: existing?.autoPowerOffGenerationBelowKw ?? null,
        autoPowerOffBatteryBelowPercent: existing?.autoPowerOffBatteryBelowPercent ?? null,
        autoPowerRestoreDelayMinutes: existing?.autoPowerRestoreDelayMinutes ?? 10,
        overheatProtectionEnabled: existing?.overheatProtectionEnabled ?? true,
        overheatShutdownTempC: existing?.overheatShutdownTempC ?? 84,
        overheatLocked: existing?.overheatLocked ?? false,
        overheatLockedAt: existing?.overheatLockedAt ?? null,
        overheatLastTempC: existing?.overheatLastTempC ?? null,
      });
    }

    let removed = 0;
    for (const minerId of Array.from(minerStates.keys())) {
      if (!ids.includes(minerId)) {
        minerStates.delete(minerId);
        removed += 1;
      }
    }
    for (let i = commands.length - 1; i >= 0; i -= 1) {
      if (!ids.includes(commands[i].minerId)) {
        commands.splice(i, 1);
      }
    }

    return NextResponse.json({ ok: true, removed, kept: ids.length, storage: "memory" });
  }
}
