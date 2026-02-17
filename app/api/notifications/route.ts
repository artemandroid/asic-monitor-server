import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    notifications.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      minerId: n.minerId ?? undefined,
      action: n.action ?? undefined,
      createdAt: n.createdAt.toISOString(),
    })),
  );
}
