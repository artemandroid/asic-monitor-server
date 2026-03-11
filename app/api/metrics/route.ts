import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CommandStatus, CommandType, type MinerMetric } from "@/app/lib/types";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getSettings } from "@/app/lib/settings";
import { runPowerAutomation } from "@/app/lib/power-automation";
import { ensureTuyaBackgroundRefresh } from "@/app/lib/tuya-background-refresh";
import { commands, minerStates, notifications } from "@/app/lib/store";

import { BOARD_HASHRATE_DRIFT_NOTIFY_COOLDOWN_MS, BOARD_HASHRATE_DRIFT_PERCENT } from "@/app/lib/constants";

const NOTIFY_AUTO_RESTART = "AUTO_RESTART";
const NOTIFY_RESTART_PROMPT = "LOW_HASHRATE_PROMPT";
const NOTIFY_OVERHEAT_COOLDOWN = "OVERHEAT_COOLDOWN";
const NOTIFY_BOARD_HASHRATE_DRIFT = "BOARD_HASHRATE_DRIFT";
const AUTO_RESTART_TEMP_DISABLED = false;

function toGh(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // ASIC payload may come in MH/s (e.g. 16110) or GH/s (e.g. 16.11).
  return value > 500 ? value / 1000 : value;
}

function resolveControlHashrateGh(body: MinerMetric): number | null {
  // Auto-restart decisions are based strictly on realtime hashrate.
  return toGh(body.hashrateRealtime ?? null);
}

function resolveMaxTempC(body: MinerMetric): number | null {
  const values: number[] = [];
  if (typeof body.temp === "number" && Number.isFinite(body.temp)) values.push(body.temp);
  for (const value of body.boardTemps ?? []) {
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  for (const value of body.boardOutletTemps ?? []) {
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  return Math.max(...values);
}

type BoardDrift = {
  board: number;
  realGh: number;
  idealGh: number;
  driftPercent: number;
};

function resolveBoardHashrateDrifts(body: MinerMetric): BoardDrift[] {
  const real = Array.isArray(body.boardHashrates) ? body.boardHashrates : [];
  const ideal = Array.isArray(body.boardTheoreticalHashrates) ? body.boardTheoreticalHashrates : [];
  const count = Math.max(real.length, ideal.length);
  const drifts: BoardDrift[] = [];
  for (let i = 0; i < count; i += 1) {
    const realVal = real[i];
    const idealVal = ideal[i];
    if (
      typeof realVal !== "number" ||
      !Number.isFinite(realVal) ||
      typeof idealVal !== "number" ||
      !Number.isFinite(idealVal) ||
      idealVal <= 0
    ) {
      continue;
    }
    const driftPercent = (Math.abs(realVal - idealVal) / idealVal) * 100;
    if (driftPercent >= BOARD_HASHRATE_DRIFT_PERCENT) {
      drifts.push({ board: i + 1, realGh: realVal, idealGh: idealVal, driftPercent });
    }
  }
  return drifts;
}

function formatBoardDriftMessage(minerId: string, drifts: BoardDrift[]): string {
  const summary = drifts
    .map(
      (d) =>
        `B${d.board}: ${d.realGh.toFixed(2)}/${d.idealGh.toFixed(2)} GH/s (${d.driftPercent.toFixed(1)}%)`,
    )
    .join("; ");
  return `Board hashrate drift on ${minerId}: ${summary}.`;
}

type NormalizedMinerConfig = {
  lowHashrateThresholdGh: number;
  postRestartGraceMinutes: number;
  manualPowerHold: boolean;
  overheatProtectionEnabled: boolean;
  overheatShutdownTempC: number;
  overheatSleepMinutes: number;
  overheatLocked: boolean;
  lastRestartAt: Date | null;
  lastLowHashrateAt: Date | null;
};

type MetricDecisions = {
  hashrateGh: number | null;
  maxTempC: number | null;
  boardDrifts: BoardDrift[];
  overheatThreshold: number;
  overheatSleepMinutes: number;
  overheatTriggered: boolean;
  wasOverheatLocked: boolean;
  isOverheatLocked: boolean;
  isLowHashrate: boolean;
  restartReady: boolean;
  promptReady: boolean;
  boardDriftReady: boolean;
};

function computeDecisions(
  body: MinerMetric,
  isOnline: boolean | null,
  config: NormalizedMinerConfig,
  settings: { restartDelayMinutes: number },
  now: Date,
): MetricDecisions {
  const hashrateGh = resolveControlHashrateGh(body);
  const maxTempC = resolveMaxTempC(body);
  const boardDrifts = resolveBoardHashrateDrifts(body);
  const thresholdGh = Math.max(config.lowHashrateThresholdGh, 0);
  const promptCooldownMs = Math.max(settings.restartDelayMinutes, 0) * 60 * 1_000;
  const postRestartGraceMs = Math.max(config.postRestartGraceMinutes, 0) * 60 * 1_000;
  const overheatThreshold = config.overheatShutdownTempC;
  const overheatSleepMinutes = Math.max(5, Math.floor(config.overheatSleepMinutes));
  const runtimeSeconds =
    typeof body.runtimeSeconds === "number" && Number.isFinite(body.runtimeSeconds)
      ? body.runtimeSeconds
      : null;
  const hasPositiveBoardHashrate = Array.isArray(body.boardHashrates)
    ? body.boardHashrates.some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
      )
    : false;
  const hasPositiveBoardFreq = Array.isArray(body.boardFreqs)
    ? body.boardFreqs.some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
      )
    : false;
  const hasActiveMiningTelemetry =
    (runtimeSeconds !== null && runtimeSeconds > 0) ||
    (typeof hashrateGh === "number" && hashrateGh > 0) ||
    hasPositiveBoardHashrate ||
    hasPositiveBoardFreq;
  const overheatTriggered =
    !config.manualPowerHold &&
    config.overheatProtectionEnabled &&
    hasActiveMiningTelemetry &&
    typeof maxTempC === "number" &&
    maxTempC >= overheatThreshold;
  const wasOverheatLocked = config.overheatLocked;
  const isOverheatLocked = wasOverheatLocked || overheatTriggered;
  const isLowHashrate =
    !config.manualPowerHold &&
    isOnline === true &&
    typeof hashrateGh === "number" &&
    hashrateGh < thresholdGh;
  const nowMs = now.getTime();
  const restartReady =
    !config.lastRestartAt || nowMs - config.lastRestartAt.getTime() >= postRestartGraceMs;
  const promptReady =
    !config.lastLowHashrateAt ||
    nowMs - config.lastLowHashrateAt.getTime() >= promptCooldownMs;
  return {
    hashrateGh, maxTempC, boardDrifts, overheatThreshold, overheatSleepMinutes,
    overheatTriggered, wasOverheatLocked, isOverheatLocked,
    isLowHashrate, restartReady, promptReady, boardDriftReady: restartReady,
  };
}

// ─── DB write helpers ─────────────────────────────────────────────────────────

type DbSettings = {
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
  autoRestartEnabled: boolean;
};

async function applyDecisionsToDb(
  minerId: string,
  d: MetricDecisions,
  isOnline: boolean | null,
  upserted: { autoRestartEnabled: boolean; overheatLockedAt: Date | null },
  settings: DbSettings,
  now: Date,
): Promise<void> {
  if (d.isOverheatLocked !== d.wasOverheatLocked || typeof d.maxTempC === "number") {
    await prisma.miner.update({
      where: { id: minerId },
      data: {
        overheatLocked: d.isOverheatLocked,
        overheatLockedAt:
          d.overheatTriggered && !d.wasOverheatLocked ? now : upserted.overheatLockedAt ?? null,
        overheatLastTempC: typeof d.maxTempC === "number" ? d.maxTempC : undefined,
      },
    });
  }

  if (d.overheatTriggered && !d.wasOverheatLocked) {
    const pendingSleep = await prisma.command.findFirst({
      where: { minerId, type: CommandType.SLEEP, status: CommandStatus.PENDING },
    });
    if (!pendingSleep) {
      await prisma.command.create({
        data: {
          id: crypto.randomUUID(),
          minerId,
          type: CommandType.SLEEP,
          status: CommandStatus.PENDING,
          createdAt: now,
        },
      });
    }
    const wakeAt = new Date(now.getTime() + d.overheatSleepMinutes * 60 * 1000);
    await prisma.notification.create({
      data: {
        type: NOTIFY_OVERHEAT_COOLDOWN,
        minerId,
        action: null,
        message:
          `Overheat protection on ${minerId}: ${d.maxTempC?.toFixed(1)}C >= ${d.overheatThreshold.toFixed(1)}C. ` +
          `SLEEP command issued for ${d.overheatSleepMinutes} minutes (until ${wakeAt.toISOString()}). ` +
          `Then WAKE will be sent automatically. If power is unavailable at wake time, WAKE will be deferred until power is restored.`,
      },
    });
  }

  if (d.isLowHashrate && !d.isOverheatLocked) {
    if (settings.autoRestartEnabled && !AUTO_RESTART_TEMP_DISABLED && d.restartReady) {
      const pendingRestart = await prisma.command.findFirst({
        where: { minerId, type: CommandType.RESTART, status: CommandStatus.PENDING },
      });
      if (!pendingRestart) {
        await prisma.command.create({
          data: {
            id: crypto.randomUUID(),
            minerId,
            type: CommandType.RESTART,
            status: CommandStatus.PENDING,
            createdAt: now,
          },
        });
        await prisma.miner.update({ where: { id: minerId }, data: { lastRestartAt: now } });
        if (settings.notifyAutoRestart) {
          await prisma.notification.create({
            data: {
              type: NOTIFY_AUTO_RESTART,
              minerId,
              action: null,
              message: `Hashrate on ${minerId} dropped to ${d.hashrateGh?.toFixed(2)} GH/s. Auto-restart issued.`,
            },
          });
        }
      }
    } else if (!settings.autoRestartEnabled && settings.notifyRestartPrompt && d.promptReady) {
      await prisma.notification.create({
        data: {
          type: NOTIFY_RESTART_PROMPT,
          minerId,
          action: CommandType.RESTART,
          message: `Hashrate on ${minerId} dropped to ${d.hashrateGh?.toFixed(2)} GH/s. Auto-restart is disabled. Restart now?`,
        },
      });
      await prisma.miner.update({ where: { id: minerId }, data: { lastLowHashrateAt: now } });
    }
  }

  if (isOnline === true && d.boardDrifts.length > 0 && d.boardDriftReady) {
    const recentBoardDrift = await prisma.notification.findFirst({
      where: { minerId, type: NOTIFY_BOARD_HASHRATE_DRIFT },
      orderBy: { createdAt: "desc" },
    });
    const cooldownPassed =
      !recentBoardDrift ||
      now.getTime() - recentBoardDrift.createdAt.getTime() >= BOARD_HASHRATE_DRIFT_NOTIFY_COOLDOWN_MS;
    if (cooldownPassed) {
      await prisma.notification.create({
        data: {
          type: NOTIFY_BOARD_HASHRATE_DRIFT,
          minerId,
          action: CommandType.RESTART,
          message: formatBoardDriftMessage(minerId, d.boardDrifts),
        },
      });
    }
  }
}

// ─── Memory (fallback) write helpers ─────────────────────────────────────────

type MemorySettings = {
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
  autoRestartEnabled: boolean;
};

function applyDecisionsToMemory(
  minerId: string,
  d: MetricDecisions,
  settings: MemorySettings,
  nowIso: string,
  now: Date,
): void {
  const miner = minerStates.get(minerId);
  if (miner) {
    miner.overheatLocked = d.isOverheatLocked;
    if (d.overheatTriggered && !d.wasOverheatLocked) {
      miner.overheatLockedAt = nowIso;
    }
    if (typeof d.maxTempC === "number") {
      miner.overheatLastTempC = d.maxTempC;
    }
    minerStates.set(minerId, miner);
  }

  if (d.overheatTriggered && !d.wasOverheatLocked) {
    const hasPendingSleep = commands.some(
      (c) => c.minerId === minerId && c.type === CommandType.SLEEP && c.status === CommandStatus.PENDING,
    );
    if (!hasPendingSleep) {
      commands.push({
        id: crypto.randomUUID(),
        minerId,
        type: CommandType.SLEEP,
        status: CommandStatus.PENDING,
        createdAt: nowIso,
      });
    }
    notifications.unshift({
      id: crypto.randomUUID(),
      type: NOTIFY_OVERHEAT_COOLDOWN,
      message:
        `Overheat protection on ${minerId}: ${d.maxTempC?.toFixed(1)}C >= ${d.overheatThreshold.toFixed(1)}C. ` +
        `SLEEP command issued for ${d.overheatSleepMinutes} minutes. Then WAKE will be sent automatically. ` +
        `If power is unavailable at wake time, WAKE will be deferred until power is restored.`,
      minerId,
      createdAt: nowIso,
    });
  }

  if (d.isLowHashrate && !d.isOverheatLocked) {
    if (settings.autoRestartEnabled && !AUTO_RESTART_TEMP_DISABLED && d.restartReady) {
      const hasPending = commands.some(
        (c) =>
          c.minerId === minerId &&
          c.type === CommandType.RESTART &&
          c.status === CommandStatus.PENDING,
      );
      if (!hasPending) {
        commands.push({
          id: crypto.randomUUID(),
          minerId,
          type: CommandType.RESTART,
          status: CommandStatus.PENDING,
          createdAt: nowIso,
        });
        const m = minerStates.get(minerId);
        if (m) m.lastRestartAt = nowIso;
        if (settings.notifyAutoRestart) {
          notifications.unshift({
            id: crypto.randomUUID(),
            type: NOTIFY_AUTO_RESTART,
            message: `Hashrate on ${minerId} dropped to ${d.hashrateGh?.toFixed(2)} GH/s. Auto-restart issued.`,
            minerId,
            createdAt: nowIso,
          });
        }
      }
    } else if (!settings.autoRestartEnabled && settings.notifyRestartPrompt && d.promptReady) {
      notifications.unshift({
        id: crypto.randomUUID(),
        type: NOTIFY_RESTART_PROMPT,
        message: `Hashrate on ${minerId} dropped to ${d.hashrateGh?.toFixed(2)} GH/s. Auto-restart is disabled. Restart now?`,
        minerId,
        action: CommandType.RESTART,
        createdAt: nowIso,
      });
      const m = minerStates.get(minerId);
      if (m) m.lastLowHashrateAt = nowIso;
    }
  }

  if (d.boardDrifts.length > 0 && d.boardDriftReady) {
    const recentBoardDrift = notifications.find(
      (n) => n.minerId === minerId && n.type === NOTIFY_BOARD_HASHRATE_DRIFT,
    );
    const cooldownPassed =
      !recentBoardDrift ||
      now.getTime() - new Date(recentBoardDrift.createdAt).getTime() >=
        BOARD_HASHRATE_DRIFT_NOTIFY_COOLDOWN_MS;
    if (cooldownPassed) {
      notifications.unshift({
        id: crypto.randomUUID(),
        type: NOTIFY_BOARD_HASHRATE_DRIFT,
        message: formatBoardDriftMessage(minerId, d.boardDrifts),
        minerId,
        action: CommandType.RESTART,
        createdAt: nowIso,
      });
    }
  }

  if (notifications.length > 100) {
    notifications.length = 100;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = requireAgentAuth(request);
  if (auth) return auth;
  ensureTuyaBackgroundRefresh();

  let body: MinerMetric;
  try {
    body = (await request.json()) as MinerMetric;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.minerId) {
    return NextResponse.json({ error: "minerId is required" }, { status: 400 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const minerId = body.minerId;
  const settings = await getSettings();

  try {
    const existing = await prisma.miner.findUnique({ where: { id: minerId } });
    const wasOnline = existing?.online ?? null;
    const isOnline = body.online ?? null;
    const lastOnlineAt = isOnline === true && wasOnline !== true ? now : (existing?.lastOnlineAt ?? null);

    const upserted = await prisma.miner.upsert({
      where: { id: minerId },
      create: {
        id: minerId,
        ip: body.ip ?? minerId,
        asicType: body.asicType ?? null,
        firmware: body.firmware ?? null,
        authType: body.authType ?? null,
        expectedHashrate: body.expectedHashrate ?? null,
        lastSeen: now,
        online: isOnline ?? null,
        readStatus: body.readStatus ?? null,
        error: body.error ?? null,
        lastMetric: body,
        lastOnlineAt,
        manualPowerHold: false,
      },
      update: {
        ip: body.ip ?? existing?.ip ?? minerId,
        asicType: body.asicType ?? existing?.asicType ?? null,
        firmware: body.firmware ?? existing?.firmware ?? null,
        authType: body.authType ?? existing?.authType ?? null,
        expectedHashrate: body.expectedHashrate ?? existing?.expectedHashrate ?? null,
        lastSeen: now,
        online: isOnline ?? existing?.online ?? null,
        readStatus: body.readStatus ?? existing?.readStatus ?? null,
        error: body.error ?? null,
        lastMetric: body,
        lastOnlineAt,
      },
    });

    const decisions = computeDecisions(
      body,
      isOnline,
      {
        lowHashrateThresholdGh: upserted.lowHashrateThresholdGh ?? 10,
        postRestartGraceMinutes: upserted.postRestartGraceMinutes ?? 10,
        manualPowerHold: upserted.manualPowerHold === true,
        overheatProtectionEnabled: upserted.overheatProtectionEnabled === true,
        overheatShutdownTempC: upserted.overheatShutdownTempC ?? 83,
        overheatSleepMinutes: upserted.overheatSleepMinutes ?? 30,
        overheatLocked: upserted.overheatLocked === true,
        lastRestartAt: upserted.lastRestartAt ?? null,
        lastLowHashrateAt: upserted.lastLowHashrateAt ?? null,
      },
      settings,
      now,
    );

    await applyDecisionsToDb(
      minerId,
      decisions,
      isOnline,
      { autoRestartEnabled: upserted.autoRestartEnabled ?? false, overheatLockedAt: upserted.overheatLockedAt ?? null },
      {
        notifyAutoRestart: settings.notifyAutoRestart,
        notifyRestartPrompt: settings.notifyRestartPrompt,
        autoRestartEnabled: upserted.autoRestartEnabled ?? false,
      },
      now,
    );

    await runPowerAutomation();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[metrics] DB write failed, falling back to memory store:", err);

    const existing = minerStates.get(minerId);
    const wasOnline = existing?.online ?? null;
    const isOnline = body.online ?? null;
    const lastOnlineAt =
      isOnline === true && wasOnline !== true ? nowIso : (existing?.lastOnlineAt ?? null);

    minerStates.set(minerId, {
      minerId,
      lastSeen: nowIso,
      lastMetric: body,
      ip: body.ip ?? existing?.ip ?? minerId,
      asicType: body.asicType ?? existing?.asicType ?? null,
      firmware: body.firmware ?? existing?.firmware ?? null,
      authType: body.authType ?? existing?.authType ?? null,
      expectedHashrate: body.expectedHashrate ?? existing?.expectedHashrate ?? undefined,
      autoRestartEnabled: existing?.autoRestartEnabled ?? settings.autoRestartEnabled,
      postRestartGraceMinutes: existing?.postRestartGraceMinutes ?? settings.postRestartGraceMinutes,
      lowHashrateThresholdGh: existing?.lowHashrateThresholdGh ?? settings.lowHashrateThresholdGh,
      autoPowerOnGridRestore: existing?.autoPowerOnGridRestore ?? false,
      autoPowerOffGridLoss: existing?.autoPowerOffGridLoss ?? false,
      boundTuyaDeviceId: existing?.boundTuyaDeviceId ?? null,
      autoPowerOffGenerationBelowKw: existing?.autoPowerOffGenerationBelowKw ?? null,
      autoPowerOnGenerationAboveKw: existing?.autoPowerOnGenerationAboveKw ?? null,
      autoPowerOffBatteryBelowPercent: existing?.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerOnBatteryAbovePercent:
        existing?.autoPowerOnBatteryAbovePercent ?? existing?.autoPowerOffBatteryBelowPercent ?? null,
      autoPowerRestoreDelayMinutes: existing?.autoPowerRestoreDelayMinutes ?? 10,
      manualPowerHold: existing?.manualPowerHold ?? false,
      overheatProtectionEnabled: existing?.overheatProtectionEnabled ?? true,
      overheatShutdownTempC: existing?.overheatShutdownTempC ?? 83,
      overheatSleepMinutes: existing?.overheatSleepMinutes ?? 30,
      overheatLocked: existing?.overheatLocked ?? false,
      overheatLockedAt: existing?.overheatLockedAt ?? null,
      overheatLastTempC: existing?.overheatLastTempC ?? null,
      online: isOnline ?? existing?.online ?? null,
      readStatus: body.readStatus ?? existing?.readStatus ?? null,
      error: body.error ?? null,
      lastOnlineAt,
      lastRestartAt: existing?.lastRestartAt ?? null,
      lastLowHashrateAt: existing?.lastLowHashrateAt ?? null,
    });

    const decisions = computeDecisions(
      body,
      isOnline,
      {
        lowHashrateThresholdGh: existing?.lowHashrateThresholdGh ?? settings.lowHashrateThresholdGh,
        postRestartGraceMinutes: existing?.postRestartGraceMinutes ?? settings.postRestartGraceMinutes,
        manualPowerHold: existing?.manualPowerHold ?? false,
        overheatProtectionEnabled: existing?.overheatProtectionEnabled ?? true,
        overheatShutdownTempC: existing?.overheatShutdownTempC ?? 83,
        overheatSleepMinutes: existing?.overheatSleepMinutes ?? 30,
        overheatLocked: existing?.overheatLocked ?? false,
        lastRestartAt: existing?.lastRestartAt ? new Date(existing.lastRestartAt) : null,
        lastLowHashrateAt: existing?.lastLowHashrateAt ? new Date(existing.lastLowHashrateAt) : null,
      },
      settings,
      now,
    );

    applyDecisionsToMemory(
      minerId,
      decisions,
      {
        notifyAutoRestart: settings.notifyAutoRestart,
        notifyRestartPrompt: settings.notifyRestartPrompt,
        autoRestartEnabled: existing?.autoRestartEnabled ?? settings.autoRestartEnabled,
      },
      nowIso,
      now,
    );

    return NextResponse.json({ ok: true, storage: "memory" });
  }
}
