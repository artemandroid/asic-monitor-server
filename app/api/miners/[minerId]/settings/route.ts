import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { minerStates } from "@/app/lib/store";
import { canAccessMiner } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";

type Params = { params: Promise<{ minerId: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const auth = requireWebAuth(_);
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
    const miner = await prisma.miner.findUnique({ where: { id } });
    if (!miner) {
      return NextResponse.json({ error: "Miner not found" }, { status: 404 });
    }
    return NextResponse.json({
      minerId: miner.id,
      autoRestartEnabled: miner.autoRestartEnabled,
      postRestartGraceMinutes: miner.postRestartGraceMinutes,
      lowHashrateThresholdGh: miner.lowHashrateThresholdGh ?? 10,
      autoPowerOnGridRestore: miner.autoPowerOnGridRestore,
      autoPowerOffGridLoss: miner.autoPowerOffGridLoss,
      autoPowerOffGenerationBelowKw: miner.autoPowerOffGenerationBelowKw ?? null,
      autoPowerOffBatteryBelowPercent: miner.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerRestoreDelayMinutes: miner.autoPowerRestoreDelayMinutes,
      overheatProtectionEnabled: miner.overheatProtectionEnabled,
      overheatShutdownTempC: miner.overheatShutdownTempC ?? 84,
      overheatLocked: miner.overheatLocked,
      overheatLockedAt: miner.overheatLockedAt?.toISOString() ?? null,
      overheatLastTempC: miner.overheatLastTempC ?? null,
      expectedHashrate: miner.expectedHashrate ?? null,
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
    return NextResponse.json({
      minerId: miner.minerId,
      autoRestartEnabled: miner.autoRestartEnabled ?? false,
      postRestartGraceMinutes: miner.postRestartGraceMinutes ?? 10,
      lowHashrateThresholdGh: miner.lowHashrateThresholdGh ?? 10,
      autoPowerOnGridRestore: miner.autoPowerOnGridRestore ?? false,
      autoPowerOffGridLoss: miner.autoPowerOffGridLoss ?? false,
      autoPowerOffGenerationBelowKw: miner.autoPowerOffGenerationBelowKw ?? null,
      autoPowerOffBatteryBelowPercent: miner.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerRestoreDelayMinutes: miner.autoPowerRestoreDelayMinutes ?? 10,
      overheatProtectionEnabled: miner.overheatProtectionEnabled ?? true,
      overheatShutdownTempC: miner.overheatShutdownTempC ?? 84,
      overheatLocked: miner.overheatLocked ?? false,
      overheatLockedAt: miner.overheatLockedAt ?? null,
      overheatLastTempC: miner.overheatLastTempC ?? null,
      expectedHashrate: miner.expectedHashrate ?? null,
    });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { minerId } = await params;
  const id = decodeURIComponent(minerId);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: {
    autoRestartEnabled?: boolean;
    postRestartGraceMinutes?: number;
    lowHashrateThresholdGh?: number;
    autoPowerOnGridRestore?: boolean;
    autoPowerOffGridLoss?: boolean;
    autoPowerOffGenerationBelowKw?: number | null;
    autoPowerOffBatteryBelowPercent?: number | null;
    autoPowerRestoreDelayMinutes?: number;
    overheatProtectionEnabled?: boolean;
    overheatShutdownTempC?: number;
  } = {};

  if (typeof body.autoRestartEnabled === "boolean") {
    patch.autoRestartEnabled = body.autoRestartEnabled;
  }
  if (
    typeof body.postRestartGraceMinutes === "number" &&
    Number.isFinite(body.postRestartGraceMinutes) &&
    body.postRestartGraceMinutes >= 0
  ) {
    patch.postRestartGraceMinutes = Math.floor(body.postRestartGraceMinutes);
  }
  if (
    typeof body.lowHashrateThresholdGh === "number" &&
    Number.isFinite(body.lowHashrateThresholdGh) &&
    body.lowHashrateThresholdGh >= 0
  ) {
    patch.lowHashrateThresholdGh = body.lowHashrateThresholdGh;
  }
  if (typeof body.autoPowerOnGridRestore === "boolean") {
    patch.autoPowerOnGridRestore = body.autoPowerOnGridRestore;
  }
  if (typeof body.autoPowerOffGridLoss === "boolean") {
    patch.autoPowerOffGridLoss = body.autoPowerOffGridLoss;
  }
  if (
    body.autoPowerOffGenerationBelowKw === null ||
    body.autoPowerOffGenerationBelowKw === undefined
  ) {
    patch.autoPowerOffGenerationBelowKw = null;
  } else if (
    typeof body.autoPowerOffGenerationBelowKw === "number" &&
    Number.isFinite(body.autoPowerOffGenerationBelowKw) &&
    body.autoPowerOffGenerationBelowKw >= 0
  ) {
    patch.autoPowerOffGenerationBelowKw = body.autoPowerOffGenerationBelowKw;
  }
  if (
    body.autoPowerOffBatteryBelowPercent === null ||
    body.autoPowerOffBatteryBelowPercent === undefined
  ) {
    patch.autoPowerOffBatteryBelowPercent = null;
  } else if (
    typeof body.autoPowerOffBatteryBelowPercent === "number" &&
    Number.isFinite(body.autoPowerOffBatteryBelowPercent) &&
    body.autoPowerOffBatteryBelowPercent >= 0 &&
    body.autoPowerOffBatteryBelowPercent <= 100
  ) {
    patch.autoPowerOffBatteryBelowPercent = body.autoPowerOffBatteryBelowPercent;
  }
  if (
    typeof body.autoPowerRestoreDelayMinutes === "number" &&
    Number.isFinite(body.autoPowerRestoreDelayMinutes) &&
    body.autoPowerRestoreDelayMinutes >= 0
  ) {
    patch.autoPowerRestoreDelayMinutes = Math.floor(body.autoPowerRestoreDelayMinutes);
  }
  if (typeof body.overheatProtectionEnabled === "boolean") {
    patch.overheatProtectionEnabled = body.overheatProtectionEnabled;
  }
  if (
    typeof body.overheatShutdownTempC === "number" &&
    Number.isFinite(body.overheatShutdownTempC) &&
    body.overheatShutdownTempC > 0
  ) {
    patch.overheatShutdownTempC = body.overheatShutdownTempC;
  }

  try {
    const allMinerIds = (await prisma.miner.findMany({ select: { id: true } })).map(
      (m: { id: string }) => m.id,
    );
    if (!canAccessMiner(auth.email, id, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updated = await prisma.miner.update({
      where: { id },
      data: patch,
    });
    return NextResponse.json({
      minerId: updated.id,
      autoRestartEnabled: updated.autoRestartEnabled,
      postRestartGraceMinutes: updated.postRestartGraceMinutes,
      lowHashrateThresholdGh: updated.lowHashrateThresholdGh ?? 10,
      autoPowerOnGridRestore: updated.autoPowerOnGridRestore,
      autoPowerOffGridLoss: updated.autoPowerOffGridLoss,
      autoPowerOffGenerationBelowKw: updated.autoPowerOffGenerationBelowKw ?? null,
      autoPowerOffBatteryBelowPercent: updated.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerRestoreDelayMinutes: updated.autoPowerRestoreDelayMinutes,
      overheatProtectionEnabled: updated.overheatProtectionEnabled,
      overheatShutdownTempC: updated.overheatShutdownTempC ?? 84,
      overheatLocked: updated.overheatLocked,
      overheatLockedAt: updated.overheatLockedAt?.toISOString() ?? null,
      overheatLastTempC: updated.overheatLastTempC ?? null,
      expectedHashrate: updated.expectedHashrate ?? null,
    });
  } catch {
    const allMinerIds = Array.from(minerStates.keys());
    if (!canAccessMiner(auth.email, id, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const existing = minerStates.get(id);
    if (!existing) {
      return NextResponse.json({ error: "Miner not found" }, { status: 404 });
    }
    if (typeof patch.autoRestartEnabled === "boolean") {
      existing.autoRestartEnabled = patch.autoRestartEnabled;
    }
    if (typeof patch.postRestartGraceMinutes === "number") {
      existing.postRestartGraceMinutes = patch.postRestartGraceMinutes;
    }
    if (typeof patch.lowHashrateThresholdGh === "number") {
      existing.lowHashrateThresholdGh = patch.lowHashrateThresholdGh;
    }
    if (typeof patch.autoPowerOnGridRestore === "boolean") {
      existing.autoPowerOnGridRestore = patch.autoPowerOnGridRestore;
    }
    if (typeof patch.autoPowerOffGridLoss === "boolean") {
      existing.autoPowerOffGridLoss = patch.autoPowerOffGridLoss;
    }
    if (
      patch.autoPowerOffGenerationBelowKw === null ||
      typeof patch.autoPowerOffGenerationBelowKw === "number"
    ) {
      existing.autoPowerOffGenerationBelowKw = patch.autoPowerOffGenerationBelowKw;
    }
    if (
      patch.autoPowerOffBatteryBelowPercent === null ||
      typeof patch.autoPowerOffBatteryBelowPercent === "number"
    ) {
      existing.autoPowerOffBatteryBelowPercent = patch.autoPowerOffBatteryBelowPercent;
    }
    if (typeof patch.autoPowerRestoreDelayMinutes === "number") {
      existing.autoPowerRestoreDelayMinutes = patch.autoPowerRestoreDelayMinutes;
    }
    if (typeof patch.overheatProtectionEnabled === "boolean") {
      existing.overheatProtectionEnabled = patch.overheatProtectionEnabled;
    }
    if (typeof patch.overheatShutdownTempC === "number") {
      existing.overheatShutdownTempC = patch.overheatShutdownTempC;
    }
    minerStates.set(id, existing);
    return NextResponse.json({
      minerId: existing.minerId,
      autoRestartEnabled: existing.autoRestartEnabled ?? false,
      postRestartGraceMinutes: existing.postRestartGraceMinutes ?? 10,
      lowHashrateThresholdGh: existing.lowHashrateThresholdGh ?? 10,
      autoPowerOnGridRestore: existing.autoPowerOnGridRestore ?? false,
      autoPowerOffGridLoss: existing.autoPowerOffGridLoss ?? false,
      autoPowerOffGenerationBelowKw: existing.autoPowerOffGenerationBelowKw ?? null,
      autoPowerOffBatteryBelowPercent: existing.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerRestoreDelayMinutes: existing.autoPowerRestoreDelayMinutes ?? 10,
      overheatProtectionEnabled: existing.overheatProtectionEnabled ?? true,
      overheatShutdownTempC: existing.overheatShutdownTempC ?? 84,
      overheatLocked: existing.overheatLocked ?? false,
      overheatLockedAt: existing.overheatLockedAt ?? null,
      overheatLastTempC: existing.overheatLastTempC ?? null,
      expectedHashrate: existing.expectedHashrate ?? null,
      storage: "memory",
    });
  }
}
