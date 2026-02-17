import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Command, CommandType } from "@/app/lib/types";
import { prisma } from "@/app/lib/prisma";

type CreateBody = {
  minerId?: string;
  type?: CommandType;
};

const allowedTypes: CommandType[] = ["RESTART", "SLEEP", "WAKE", "RELOAD_CONFIG"];

export async function POST(request: NextRequest) {
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

  const command: Command = {
    id: crypto.randomUUID(),
    minerId: body.minerId,
    type: body.type,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  await prisma.command.create({
    data: {
      id: command.id,
      minerId: command.minerId,
      type: command.type,
      status: command.status,
      createdAt: new Date(command.createdAt),
    },
  });

  if (command.type === "RESTART") {
    await prisma.miner.updateMany({
      where: { id: command.minerId },
      data: { lastRestartAt: new Date() },
    });
  }

  return NextResponse.json(command);
}
