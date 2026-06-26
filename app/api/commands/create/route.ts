import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { Command, CommandStatus, CommandType } from "@/app/lib/types";
import { prisma } from "@/app/lib/prisma";
import { commands, minerStates } from "@/app/lib/store";
import { canAccessMiner } from "@/app/lib/access-config";
import { requireWebAuth } from "@/app/lib/web-auth";

type CreateBody = {
  minerId?: string;
  type?: CommandType;
};

const allowedTypes = Object.values(CommandType);

export async function POST(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.minerId) {
    return NextResponse.json({ error: "minerId is required" }, { status: 400 });
  }
  if (!body?.type || !allowedTypes.includes(body.type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  try {
    const allMinerIds = (await prisma.miner.findMany({ select: { id: true } })).map(
      (m: { id: string }) => m.id,
    );
    if (!canAccessMiner(auth.email, body.minerId, allMinerIds)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    if (!canAccessMiner(auth.email, body.minerId, Array.from(minerStates.keys()))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const command: Command = {
    id: crypto.randomUUID(),
    minerId: body.minerId,
    type: body.type,
    status: CommandStatus.PENDING,
    createdAt: new Date().toISOString(),
  };
  try {
    const miner = await prisma.miner.findUnique({
      where: { id: command.minerId },
      select: { overheatLocked: true, manualPowerHold: true },
    });
    if (
      miner?.manualPowerHold &&
      (command.type === CommandType.RESTART ||
        command.type === CommandType.SLEEP ||
        command.type === CommandType.WAKE)
    ) {
      console.info("[command-create] blocked_by_manual_power_hold", {
        minerId: command.minerId,
        type: command.type,
        by: auth.email,
      });
      return NextResponse.json(
        { error: "Manual OFF hold is active. Turn ON first." },
        { status: 409 },
      );
    }
    if (miner?.overheatLocked && (command.type === CommandType.RESTART || command.type === CommandType.WAKE)) {
      return NextResponse.json(
        { error: "Overheat lock is active. Unlock control first." },
        { status: 409 },
      );
    }

    // Persist the command row and the manual-pause flag atomically: if the flag
    // write failed after the row committed, a SLEEP would leave automation un-frozen
    // (or a WAKE would leave it frozen forever). $transaction commits both or neither.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.command.create({
        data: {
          id: command.id,
          minerId: command.minerId,
          type: command.type,
          status: command.status,
          createdAt: new Date(command.createdAt),
        },
      }),
    ];
    if (command.type === CommandType.RESTART || command.type === CommandType.WAKE) {
      // A manual RESTART / WAKE resumes the miner: lift the manual-pause hold and
      // clear any in-flight protective shutdown — a manual resume supersedes it.
      ops.push(
        prisma.miner.updateMany({
          where: { id: command.minerId },
          data: {
            lastRestartAt: new Date(),
            manualPauseHold: false,
            protectiveShutdownAt: null,
            protectiveShutdownReason: null,
            protectiveShutdownPhase: null,
            pendingWakeAfterPowerOn: false,
          },
        }),
      );
    } else if (command.type === CommandType.SLEEP) {
      // A manual SLEEP is an operator pause: freeze automation for this miner until
      // a manual WAKE / power ON (see deriveControlMode -> MANUAL_PAUSE).
      ops.push(
        prisma.miner.updateMany({
          where: { id: command.minerId },
          data: { manualPauseHold: true },
        }),
      );
    }
    await prisma.$transaction(ops);
  } catch {
    const miner = minerStates.get(command.minerId);
    if (
      miner?.manualPowerHold &&
      (command.type === CommandType.RESTART ||
        command.type === CommandType.SLEEP ||
        command.type === CommandType.WAKE)
    ) {
      console.info("[command-create] blocked_by_manual_power_hold_memory", {
        minerId: command.minerId,
        type: command.type,
        by: auth.email,
      });
      return NextResponse.json(
        { error: "Manual OFF hold is active. Turn ON first." },
        { status: 409 },
      );
    }
    if (miner?.overheatLocked && (command.type === CommandType.RESTART || command.type === CommandType.WAKE)) {
      return NextResponse.json(
        { error: "Overheat lock is active. Unlock control first." },
        { status: 409 },
      );
    }

    commands.push(command);
    const memMiner = minerStates.get(command.minerId);
    if (memMiner) {
      if (command.type === CommandType.RESTART || command.type === CommandType.WAKE) {
        memMiner.lastRestartAt = new Date().toISOString();
        memMiner.manualPauseHold = false;
      } else if (command.type === CommandType.SLEEP) {
        memMiner.manualPauseHold = true;
      }
    }
  }

  return NextResponse.json(command);
}
