import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { canAccessMiner } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";
import { CommandStatus, CommandType } from "@/app/lib/types";
import { commands, minerStates, notifications } from "@/app/lib/store";
import { getTuyaSnapshotCached, patchTuyaDeviceSwitchState } from "@/app/lib/tuya-cache";
import { setTuyaSwitch } from "@/app/lib/tuya-client";

type Params = { params: Promise<{ minerId: string }> };

type Body = {
  on?: boolean;
};

const CONTROL_COMMAND_TYPES = [CommandType.RESTART, CommandType.SLEEP, CommandType.WAKE] as const;
const NOTIFY_TYPE = "MANUAL_POWER_CONTROL";
const LOG_PREFIX = "[manual-power-control]";

async function resolveSwitchCode(deviceId: string): Promise<string | null> {
  try {
    const tuya = await getTuyaSnapshotCached({ force: true });
    const device = tuya.snapshot.devices.find((d) => d.id === deviceId);
    return device?.switchCode ?? null;
  } catch {
    return null;
  }
}

async function setDevicePower(deviceId: string | null, on: boolean): Promise<void> {
  if (!deviceId) return;
  const switchCode = await resolveSwitchCode(deviceId);
  await setTuyaSwitch(deviceId, on, switchCode);
  await patchTuyaDeviceSwitchState(deviceId, on);
}

function powerControlErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to switch bound automat.";
}

function buildSuccessMessage(params: {
  minerId: string;
  holdEnabled: boolean;
  hasBoundAutomat: boolean;
  cancelledCount: number;
}): string {
  const { minerId, holdEnabled, hasBoundAutomat, cancelledCount } = params;
  if (holdEnabled) {
    const prefix = hasBoundAutomat
      ? `Manual OFF on ${minerId}: bound automat switched OFF; automation paused until manual ON.`
      : `Manual OFF on ${minerId}: no bound automat; automation paused until manual ON.`;
    return `${prefix} Pending control commands cancelled: ${cancelledCount}.`;
  }
  return hasBoundAutomat
    ? `Manual ON on ${minerId}: bound automat switched ON; automation resumed.`
    : `Manual ON on ${minerId}: no bound automat; automation resumed.`;
}

function buildFailureMessage(minerId: string, reason: string): string {
  return `Manual power control failed on ${minerId}: ${reason}`;
}

function logInfo(event: string, details: Record<string, unknown>) {
  console.info(`${LOG_PREFIX} ${event}`, details);
}

function logError(event: string, details: Record<string, unknown>, error?: unknown) {
  console.error(`${LOG_PREFIX} ${event}`, details, error);
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { minerId } = await params;
  const id = decodeURIComponent(minerId);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "on is required" }, { status: 400 });
  }
  const turnOn = body.on;
  const holdEnabled = !turnOn;
  const requestedBy = auth.email;
  const requestedAt = new Date().toISOString();
  let powerSwitchAppliedInDbPath = false;

  logInfo("request_received", {
    minerId: id,
    requestedBy,
    requestedAt,
    turnOn,
    holdEnabled,
  });

  try {
    const allMinerIds = (await prisma.miner.findMany({ select: { id: true } })).map(
      (m: { id: string }) => m.id,
    );
    if (!canAccessMiner(auth.email, id, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const miner = await prisma.miner.findUnique({
      where: { id },
      select: { id: true, boundTuyaDeviceId: true },
    });
    if (!miner) {
      return NextResponse.json({ error: "Miner not found" }, { status: 404 });
    }

    const hasBoundAutomat = Boolean(miner.boundTuyaDeviceId);
    try {
      await setDevicePower(miner.boundTuyaDeviceId ?? null, turnOn);
      powerSwitchAppliedInDbPath = true;
    } catch (error) {
      const reason = powerControlErrorMessage(error);
      const message = buildFailureMessage(id, reason);
      await prisma.notification.create({
        data: {
          type: NOTIFY_TYPE,
          minerId: id,
          action: null,
          message,
        },
      });
      logError(
        "tuya_switch_failed_db",
        { minerId: id, requestedBy, turnOn, holdEnabled, hasBoundAutomat, requestedAt, reason },
        error,
      );
      return NextResponse.json({ error: reason }, { status: 502 });
    }
    await prisma.miner.update({
      where: { id },
      data: { manualPowerHold: holdEnabled },
    });

    let cancelledCount = 0;
    if (holdEnabled) {
      const cancelled = await prisma.command.updateMany({
        where: {
          minerId: id,
          status: CommandStatus.PENDING,
          type: { in: [...CONTROL_COMMAND_TYPES] },
        },
        data: {
          status: CommandStatus.FAILED,
          executedAt: new Date(),
          error: "Cancelled by manual OFF hold.",
        },
      });
      cancelledCount = cancelled.count;
    }

    const message = buildSuccessMessage({
      minerId: id,
      holdEnabled,
      hasBoundAutomat,
      cancelledCount,
    });
    await prisma.notification.create({
      data: {
        type: NOTIFY_TYPE,
        minerId: id,
        action: null,
        message,
      },
    });

    logInfo("request_completed_db", {
      minerId: id,
      requestedBy,
      requestedAt,
      turnOn,
      holdEnabled,
      hasBoundAutomat,
      cancelledCount,
    });

    return NextResponse.json({
      ok: true,
      minerId: id,
      manualPowerHold: holdEnabled,
      powerOnRequested: turnOn,
      hasBoundAutomat,
      cancelledCount,
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

    const hasBoundAutomat = Boolean(miner.boundTuyaDeviceId);
    if (!powerSwitchAppliedInDbPath) {
      try {
        await setDevicePower(miner.boundTuyaDeviceId ?? null, turnOn);
      } catch (error) {
        const reason = powerControlErrorMessage(error);
        const message = buildFailureMessage(id, reason);
        notifications.unshift({
          id: crypto.randomUUID(),
          type: NOTIFY_TYPE,
          minerId: id,
          message,
          createdAt: new Date().toISOString(),
        });
        if (notifications.length > 100) notifications.length = 100;
        logError(
          "tuya_switch_failed_memory",
          { minerId: id, requestedBy, turnOn, holdEnabled, hasBoundAutomat, requestedAt, reason },
          error,
        );
        return NextResponse.json({ error: reason }, { status: 502 });
      }
    } else {
      logInfo("memory_fallback_skipped_power_switch", {
        minerId: id,
        requestedBy,
        requestedAt,
        turnOn,
      });
    }
    miner.manualPowerHold = holdEnabled;
    minerStates.set(id, miner);

    let cancelledCount = 0;
    if (holdEnabled) {
      const nowIso = new Date().toISOString();
      for (let i = 0; i < commands.length; i += 1) {
        const cmd = commands[i];
        if (
          cmd.minerId === id &&
          cmd.status === CommandStatus.PENDING &&
          (CONTROL_COMMAND_TYPES as readonly CommandType[]).includes(cmd.type)
        ) {
          cancelledCount += 1;
          commands[i] = {
            ...cmd,
            status: CommandStatus.FAILED,
            executedAt: nowIso,
            error: "Cancelled by manual OFF hold.",
          };
        }
      }
    }

    const message = buildSuccessMessage({
      minerId: id,
      holdEnabled,
      hasBoundAutomat,
      cancelledCount,
    });
    notifications.unshift({
      id: crypto.randomUUID(),
      type: NOTIFY_TYPE,
      minerId: id,
      message,
      createdAt: new Date().toISOString(),
    });
    if (notifications.length > 100) notifications.length = 100;

    logInfo("request_completed_memory", {
      minerId: id,
      requestedBy,
      requestedAt,
      turnOn,
      holdEnabled,
      hasBoundAutomat,
      cancelledCount,
    });

    return NextResponse.json({
      ok: true,
      minerId: id,
      manualPowerHold: holdEnabled,
      powerOnRequested: turnOn,
      hasBoundAutomat,
      cancelledCount,
      storage: "memory",
    });
  }
}
