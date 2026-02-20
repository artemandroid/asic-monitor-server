import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { CommandStatus } from "@/app/lib/types";
import { prisma } from "@/app/lib/prisma";
import { commands, notifications } from "@/app/lib/store";

type ResultBody = {
  id?: string;
  status?: CommandStatus;
  error?: string;
};

const allowedStatuses: CommandStatus[] = ["DONE", "FAILED"];

export async function POST(request: NextRequest) {
  let body: ResultBody;
  try {
    body = (await request.json()) as ResultBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!body?.status || !allowedStatuses.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const command = await prisma.command.findUnique({
      where: { id: body.id },
    });
    if (!command) {
      return NextResponse.json({ error: "Command not found" }, { status: 404 });
    }

    await prisma.command.update({
      where: { id: body.id },
      data: {
        status: body.status,
        executedAt: new Date(),
        error: body.error ?? undefined,
      },
    });

    const message =
      body.status === "DONE"
        ? `Command ${command.type} succeeded on ${command.minerId}.`
        : `Command ${command.type} failed on ${command.minerId}${body.error ? `: ${body.error}` : "."}`;
    await prisma.notification.create({
      data: {
        type: "COMMAND_RESULT",
        minerId: command.minerId,
        action: null,
        message,
      },
    });
  } catch {
    const idx = commands.findIndex((c) => c.id === body.id);
    if (idx < 0) {
      return NextResponse.json({ error: "Command not found" }, { status: 404 });
    }
    const command = commands[idx];
    commands[idx] = {
      ...commands[idx],
      status: body.status,
      executedAt: new Date().toISOString(),
      error: body.error,
    };
    const message =
      body.status === "DONE"
        ? `Command ${command.type} succeeded on ${command.minerId}.`
        : `Command ${command.type} failed on ${command.minerId}${body.error ? `: ${body.error}` : "."}`;
    notifications.unshift({
      id: crypto.randomUUID(),
      type: "COMMAND_RESULT",
      message,
      minerId: command.minerId,
      createdAt: new Date().toISOString(),
    });
    if (notifications.length > 100) notifications.length = 100;
  }

  return NextResponse.json({ ok: true });
}
