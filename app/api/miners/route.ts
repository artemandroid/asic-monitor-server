import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { commands, minerStates } from "@/app/lib/store";
import type { NextRequest } from "next/server";
import { getAllowedMinerIds } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  const email = auth.email;

  try {
    const miners = await prisma.miner.findMany({
      orderBy: { id: "asc" },
    });
    const allowedMinerIds = getAllowedMinerIds(
      email,
      miners.map((m: { id: string }) => m.id),
    );
    const pendingCommands = await prisma.command.findMany({
      where: {
        status: "PENDING", type: { in: ["RESTART", "SLEEP", "WAKE"] }, minerId: { in: [...allowedMinerIds] },
      },
      orderBy: { createdAt: "desc" },
    });
    const pendingByMiner = new Map<string, string>();
    for (const cmd of pendingCommands) {
      if (!pendingByMiner.has(cmd.minerId)) {
        pendingByMiner.set(cmd.minerId, cmd.type);
      }
    }
    const list = miners.filter((miner: { id: string }) => allowedMinerIds.has(miner.id)).map((miner: {
      id: string;
      lastSeen: Date | null;
      lastRestartAt: Date | null;
      expectedHashrate: number | null;
      autoRestartEnabled: boolean;
      postRestartGraceMinutes: number;
      lowHashrateThresholdGh: number | null;
      autoPowerOnGridRestore: boolean;
      autoPowerOffGridLoss: boolean;
      boundTuyaDeviceId: string | null;
      autoPowerOffGenerationBelowKw: number | null;
      autoPowerOnGenerationAboveKw: number | null;
      autoPowerOffBatteryBelowPercent: number | null;
      autoPowerOnBatteryAbovePercent: number | null;
      autoPowerRestoreDelayMinutes: number;
      overheatProtectionEnabled: boolean;
      overheatShutdownTempC: number | null;
      overheatLocked: boolean;
      overheatLockedAt: Date | null;
      overheatLastTempC: number | null;
      lastMetric: unknown;
    }) => ({
      minerId: miner.id,
      lastSeen: miner.lastSeen?.toISOString() ?? null,
      lastRestartAt: miner.lastRestartAt?.toISOString() ?? null,
      pendingCommandType: pendingByMiner.get(miner.id) ?? null,
      expectedHashrate: miner.expectedHashrate ?? undefined,
      autoRestartEnabled: miner.autoRestartEnabled,
      postRestartGraceMinutes: miner.postRestartGraceMinutes,
      lowHashrateThresholdGh: miner.lowHashrateThresholdGh,
      autoPowerOnGridRestore: miner.autoPowerOnGridRestore,
      autoPowerOffGridLoss: miner.autoPowerOffGridLoss,
      boundTuyaDeviceId: miner.boundTuyaDeviceId ?? null,
      autoPowerOffGenerationBelowKw: miner.autoPowerOffGenerationBelowKw,
      autoPowerOnGenerationAboveKw: miner.autoPowerOnGenerationAboveKw,
      autoPowerOffBatteryBelowPercent: miner.autoPowerOffBatteryBelowPercent,
      autoPowerOnBatteryAbovePercent:
        miner.autoPowerOnBatteryAbovePercent ?? miner.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerRestoreDelayMinutes: miner.autoPowerRestoreDelayMinutes,
      overheatProtectionEnabled: miner.overheatProtectionEnabled,
      overheatShutdownTempC: miner.overheatShutdownTempC,
      overheatLocked: miner.overheatLocked,
      overheatLockedAt: miner.overheatLockedAt?.toISOString() ?? null,
      overheatLastTempC: miner.overheatLastTempC,
      lastMetric: miner.lastMetric ?? null,
    }));
    return NextResponse.json(list);
  } catch {
    const allMinerIds = Array.from(minerStates.keys());
    const allowedMinerIds = getAllowedMinerIds(email, allMinerIds);
    const list = Array.from(minerStates.values())
      .filter((m) => allowedMinerIds.has(m.minerId))
      .sort((a, b) => a.minerId.localeCompare(b.minerId))
      .map((miner) => ({
        minerId: miner.minerId,
        lastSeen: miner.lastSeen,
        lastRestartAt: miner.lastRestartAt ?? null,
        pendingCommandType:
          commands.find(
            (cmd) =>
              cmd.minerId === miner.minerId &&
              cmd.status === "PENDING" &&
              (cmd.type === "RESTART" || cmd.type === "SLEEP" || cmd.type === "WAKE"),
          )?.type ?? null,
        expectedHashrate: miner.expectedHashrate ?? undefined,
        autoRestartEnabled: miner.autoRestartEnabled ?? false,
        postRestartGraceMinutes: miner.postRestartGraceMinutes ?? 10,
        lowHashrateThresholdGh: miner.lowHashrateThresholdGh ?? null,
        autoPowerOnGridRestore: miner.autoPowerOnGridRestore ?? false,
        autoPowerOffGridLoss: miner.autoPowerOffGridLoss ?? false,
        boundTuyaDeviceId: miner.boundTuyaDeviceId ?? null,
        autoPowerOffGenerationBelowKw: miner.autoPowerOffGenerationBelowKw ?? null,
        autoPowerOnGenerationAboveKw: miner.autoPowerOnGenerationAboveKw ?? null,
        autoPowerOffBatteryBelowPercent: miner.autoPowerOffBatteryBelowPercent ?? null,
        autoPowerOnBatteryAbovePercent:
          miner.autoPowerOnBatteryAbovePercent ?? miner.autoPowerOffBatteryBelowPercent ?? null,
        autoPowerRestoreDelayMinutes: miner.autoPowerRestoreDelayMinutes ?? 10,
        overheatProtectionEnabled: miner.overheatProtectionEnabled ?? true,
        overheatShutdownTempC: miner.overheatShutdownTempC ?? 84,
        overheatLocked: miner.overheatLocked ?? false,
        overheatLockedAt: miner.overheatLockedAt ?? null,
        overheatLastTempC: miner.overheatLastTempC ?? null,
        lastMetric: miner.lastMetric ?? null,
      }));
    return NextResponse.json(list);
  }
}
