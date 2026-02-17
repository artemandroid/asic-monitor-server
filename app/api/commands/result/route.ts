import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { CommandStatus } from "@/app/lib/types";
import { prisma } from "@/app/lib/prisma";

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

  return NextResponse.json({ ok: true });
}
