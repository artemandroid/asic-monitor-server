import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { MinerMetric } from "@/app/lib/types";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getSettings } from "@/app/lib/settings";
import { runPowerAutomation } from "@/app/lib/power-automation";
import { commands, minerStates, notifications } from "@/app/lib/store";

const NOTIFY_AUTO_RESTART = "AUTO_RESTART";
const NOTIFY_RESTART_PROMPT = "LOW_HASHRATE_PROMPT";
const NOTIFY_OVERHEAT_LOCK = "OVERHEAT_LOCK";
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

export async function POST(request: NextRequest) {
  const auth = requireAgentAuth(request);
  if (auth) return auth;

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
  const minerId = body.minerId;
  const settings = await getSettings();
  try {
    const existing = await prisma.miner.findUnique({ where: { id: minerId } });
    const wasOnline = existing?.online ?? null;
    const isOnline = body.online ?? null;

    let lastOnlineAt = existing?.lastOnlineAt ?? null;
    if (isOnline === true && wasOnline !== true) {
      lastOnlineAt = now;
    }

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
      },
      update: {
        ip: body.ip ?? existing?.ip ?? minerId,
        asicType: body.asicType ?? existing?.asicType ?? null,
        firmware: body.firmware ?? existing?.firmware ?? null,
        authType: body.authType ?? existing?.authType ?? null,
        expectedHashrate:
          body.expectedHashrate ?? existing?.expectedHashrate ?? null,
        lastSeen: now,
        online: isOnline ?? existing?.online ?? null,
        readStatus: body.readStatus ?? existing?.readStatus ?? null,
        error: body.error ?? null,
        lastMetric: body,
        lastOnlineAt,
      },
    });

    const hashrateGh = resolveControlHashrateGh(body);
    const maxTempC = resolveMaxTempC(body);
    const thresholdGh = Math.max(upserted.lowHashrateThresholdGh ?? 10, 0);
    const promptCooldownMs = Math.max(settings.restartDelayMinutes, 0) * 60 * 1000;
    const postRestartGraceMs =
      Math.max(upserted.postRestartGraceMinutes ?? 10, 0) * 60 * 1000;

    const overheatThreshold = upserted.overheatShutdownTempC ?? 84;
    const overheatTriggered =
      upserted.overheatProtectionEnabled === true &&
      typeof maxTempC === "number" &&
      maxTempC >= overheatThreshold;
    const wasOverheatLocked = upserted.overheatLocked === true;
    const isOverheatLocked = wasOverheatLocked || overheatTriggered;
    if (isOverheatLocked !== wasOverheatLocked || typeof maxTempC === "number") {
      await prisma.miner.update({
        where: { id: minerId },
        data: {
          overheatLocked: isOverheatLocked,
          overheatLockedAt:
            overheatTriggered && !wasOverheatLocked ? now : upserted.overheatLockedAt ?? null,
          overheatLastTempC: typeof maxTempC === "number" ? maxTempC : upserted.overheatLastTempC,
        },
      });
    }
    if (overheatTriggered && !wasOverheatLocked) {
      const pendingSleep = await prisma.command.findFirst({
        where: { minerId, type: "SLEEP", status: "PENDING" },
      });
      if (!pendingSleep) {
        await prisma.command.create({
          data: {
            id: crypto.randomUUID(),
            minerId,
            type: "SLEEP",
            status: "PENDING",
            createdAt: now,
          },
        });
      }
      await prisma.notification.create({
        data: {
          type: NOTIFY_OVERHEAT_LOCK,
          minerId,
          action: null,
          message: `Overheat lock on ${minerId}: ${maxTempC?.toFixed(1)}C >= ${overheatThreshold.toFixed(1)}C. Manual Unlock control is required.`,
        },
      });
    }

    const isLowHashrate =
      isOnline === true &&
      typeof hashrateGh === "number" &&
      hashrateGh < thresholdGh;

    if (isLowHashrate && !isOverheatLocked) {
      const restartAnchor = upserted.lastRestartAt ?? null;
      const ready =
        !restartAnchor || now.getTime() - restartAnchor.getTime() >= postRestartGraceMs;

      if (upserted.autoRestartEnabled && !AUTO_RESTART_TEMP_DISABLED) {
        if (ready) {
          const pendingRestart = await prisma.command.findFirst({
            where: { minerId, type: "RESTART", status: "PENDING" },
          });
          if (!pendingRestart) {
            await prisma.command.create({
              data: {
                id: crypto.randomUUID(),
                minerId,
                type: "RESTART",
                status: "PENDING",
                createdAt: now,
              },
            });
            await prisma.miner.update({
              where: { id: minerId },
              data: { lastRestartAt: now },
            });

            if (settings.notifyAutoRestart) {
              await prisma.notification.create({
                data: {
                  type: NOTIFY_AUTO_RESTART,
                  minerId,
                  action: null,
                  message: `Hashrate on ${minerId} dropped to ${hashrateGh?.toFixed(2)} GH/s. Auto-restart issued.`,
                },
              });
            }
          }
        }
      } else if (!upserted.autoRestartEnabled && settings.notifyRestartPrompt) {
        const lastPromptAt = upserted.lastLowHashrateAt;
        const promptReady =
          !lastPromptAt || now.getTime() - lastPromptAt.getTime() >= promptCooldownMs;
        if (promptReady) {
          await prisma.notification.create({
            data: {
              type: NOTIFY_RESTART_PROMPT,
              minerId,
              action: "RESTART",
              message: `Hashrate on ${minerId} dropped to ${hashrateGh?.toFixed(2)} GH/s. Auto-restart is disabled. Restart now?`,
            },
          });
          await prisma.miner.update({
            where: { id: minerId },
            data: { lastLowHashrateAt: now },
          });
        }
      }
    }

    await runPowerAutomation();
    return NextResponse.json({ ok: true });
  } catch {
    const existing = minerStates.get(minerId);
    const nowIso = now.toISOString();
    const wasOnline = existing?.online ?? null;
    const isOnline = body.online ?? null;
    const lastOnlineAt =
      isOnline === true && wasOnline !== true ? nowIso : existing?.lastOnlineAt ?? null;

    minerStates.set(minerId, {
      minerId,
      lastSeen: nowIso,
      lastMetric: body,
      ip: body.ip ?? existing?.ip ?? minerId,
      asicType: body.asicType ?? existing?.asicType ?? null,
      firmware: body.firmware ?? existing?.firmware ?? null,
      authType: body.authType ?? existing?.authType ?? null,
      expectedHashrate:
        body.expectedHashrate ?? existing?.expectedHashrate ?? undefined,
      autoRestartEnabled: existing?.autoRestartEnabled ?? false,
      postRestartGraceMinutes: existing?.postRestartGraceMinutes ?? 10,
      lowHashrateThresholdGh: existing?.lowHashrateThresholdGh ?? 10,
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
      online: isOnline ?? existing?.online ?? null,
      readStatus: body.readStatus ?? existing?.readStatus ?? null,
      error: body.error ?? null,
      lastOnlineAt,
      lastRestartAt: existing?.lastRestartAt ?? null,
      lastLowHashrateAt: existing?.lastLowHashrateAt ?? null,
    });

    const hashrateGh = resolveControlHashrateGh(body);
    const maxTempC = resolveMaxTempC(body);
    const thresholdGh = Math.max(existing?.lowHashrateThresholdGh ?? 10, 0);
    const promptCooldownMs = Math.max(settings.restartDelayMinutes, 0) * 60 * 1000;
    const postRestartGraceMs =
      Math.max(existing?.postRestartGraceMinutes ?? 10, 0) * 60 * 1000;
    const overheatThreshold = existing?.overheatShutdownTempC ?? 84;
    const overheatTriggered =
      (existing?.overheatProtectionEnabled ?? true) &&
      typeof maxTempC === "number" &&
      maxTempC >= overheatThreshold;
    const wasOverheatLocked = existing?.overheatLocked ?? false;
    const isOverheatLocked = wasOverheatLocked || overheatTriggered;
    const minerAfterUpsert = minerStates.get(minerId);
    if (minerAfterUpsert) {
      minerAfterUpsert.overheatLocked = isOverheatLocked;
      if (overheatTriggered && !wasOverheatLocked) {
        minerAfterUpsert.overheatLockedAt = nowIso;
      }
      if (typeof maxTempC === "number") {
        minerAfterUpsert.overheatLastTempC = maxTempC;
      }
      minerStates.set(minerId, minerAfterUpsert);
    }
    if (overheatTriggered && !wasOverheatLocked) {
      const hasPendingSleep = commands.some(
        (c) => c.minerId === minerId && c.type === "SLEEP" && c.status === "PENDING",
      );
      if (!hasPendingSleep) {
        commands.push({
          id: crypto.randomUUID(),
          minerId,
          type: "SLEEP",
          status: "PENDING",
          createdAt: nowIso,
        });
      }
      notifications.unshift({
        id: crypto.randomUUID(),
        type: NOTIFY_OVERHEAT_LOCK,
        message: `Overheat lock on ${minerId}: ${maxTempC?.toFixed(1)}C >= ${overheatThreshold.toFixed(1)}C. Manual Unlock control is required.`,
        minerId,
        createdAt: nowIso,
      });
    }

    const isLowHashrate =
      isOnline === true &&
      typeof hashrateGh === "number" &&
      hashrateGh < thresholdGh;

    if (isLowHashrate && !isOverheatLocked) {
      const anchorIso = existing?.lastRestartAt ?? null;
      const anchor = anchorIso ? new Date(anchorIso) : null;
      const ready = !anchor || now.getTime() - anchor.getTime() >= postRestartGraceMs;

      if ((existing?.autoRestartEnabled ?? false) && !AUTO_RESTART_TEMP_DISABLED && ready) {
        const hasPending = commands.some(
          (c) => c.minerId === minerId && c.type === "RESTART" && c.status === "PENDING",
        );
        if (!hasPending) {
          commands.push({
            id: crypto.randomUUID(),
            minerId,
            type: "RESTART",
            status: "PENDING",
            createdAt: nowIso,
          });
          const miner = minerStates.get(minerId);
          if (miner) miner.lastRestartAt = nowIso;
          if (settings.notifyAutoRestart) {
            notifications.unshift({
              id: crypto.randomUUID(),
              type: NOTIFY_AUTO_RESTART,
              message: `Hashrate on ${minerId} dropped to ${hashrateGh?.toFixed(2)} GH/s. Auto-restart issued.`,
              minerId,
              createdAt: nowIso,
            });
          }
        }
      } else if (!(existing?.autoRestartEnabled ?? false) && settings.notifyRestartPrompt && ready) {
        const lastPromptAt = existing?.lastLowHashrateAt
          ? new Date(existing.lastLowHashrateAt)
          : null;
        const promptReady =
          !lastPromptAt || now.getTime() - lastPromptAt.getTime() >= promptCooldownMs;
        if (!promptReady) {
          if (notifications.length > 100) {
            notifications.length = 100;
          }
          return NextResponse.json({ ok: true, storage: "memory" });
        }
        notifications.unshift({
          id: crypto.randomUUID(),
          type: NOTIFY_RESTART_PROMPT,
          message: `Hashrate on ${minerId} dropped to ${hashrateGh?.toFixed(2)} GH/s. Auto-restart is disabled. Restart now?`,
          minerId,
          action: "RESTART",
          createdAt: nowIso,
        });
        const miner = minerStates.get(minerId);
        if (miner) miner.lastLowHashrateAt = nowIso;
      }
    }

    if (notifications.length > 100) {
      notifications.length = 100;
    }
    return NextResponse.json({ ok: true, storage: "memory" });
  }
}
