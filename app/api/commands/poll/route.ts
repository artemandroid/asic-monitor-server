import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = requireAgentAuth(request);
  if (auth) return auth;

  const minerId = request.nextUrl.searchParams.get("minerId");
  if (!minerId) {
    return NextResponse.json({ error: "minerId is required" }, { status: 400 });
  }

  const command = await prisma.command.findFirst({
    where: { minerId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

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
