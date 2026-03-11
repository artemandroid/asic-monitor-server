import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
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

    await prisma.command.create({
      data: {
        id: command.id,
        minerId: command.minerId,
        type: command.type,
        status: command.status,
        createdAt: new Date(command.createdAt),
      },
    });

    if (command.type === CommandType.RESTART || command.type === CommandType.WAKE) {
      await prisma.miner.updateMany({
        where: { id: command.minerId },
        data: { lastRestartAt: new Date() },
      });
    }
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
    if (command.type === CommandType.RESTART || command.type === CommandType.WAKE) {
      const miner = minerStates.get(command.minerId);
      if (miner) {
        miner.lastRestartAt = new Date().toISOString();
      }
    }
  }

  return NextResponse.json(command);
}
