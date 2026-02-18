import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { commands } from "@/app/lib/store";

export async function GET(request: NextRequest) {
  const auth = requireAgentAuth(request);
  if (auth) return auth;

  const minerId = request.nextUrl.searchParams.get("minerId");
  if (!minerId) {
    return NextResponse.json({ error: "minerId is required" }, { status: 400 });
  }

  let command:
    | {
        id: string;
        minerId: string;
        type: string;
        status: string;
        createdAt: Date;
        executedAt: Date | null;
        error: string | null;
      }
    | undefined;
  try {
    const dbCommand = await prisma.command.findFirst({
      where: { minerId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (dbCommand) {
      command = {
        id: dbCommand.id,
        minerId: dbCommand.minerId,
        type: dbCommand.type,
        status: dbCommand.status,
        createdAt: dbCommand.createdAt,
        executedAt: dbCommand.executedAt,
        error: dbCommand.error,
      };
    }
  } catch {
    const memCommand = commands
      .filter((c) => c.minerId === minerId && c.status === "PENDING")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (memCommand) {
      command = {
        id: memCommand.id,
        minerId: memCommand.minerId,
        type: memCommand.type,
        status: memCommand.status,
        createdAt: new Date(memCommand.createdAt),
        executedAt: memCommand.executedAt ? new Date(memCommand.executedAt) : null,
        error: memCommand.error ?? null,
      };
    }
  }

  if (!command) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({
    id: command.id,
    minerId: command.minerId,
    type: command.type,
    status: command.status,
    createdAt: command.createdAt.toISOString(),
    executedAt: command.executedAt?.toISOString(),
    error: command.error ?? undefined,
  });
}
