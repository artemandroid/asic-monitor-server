import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { prisma } from "@/app/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const periods = await prisma.electricityTariff.findMany({
      orderBy: { effectiveFrom: "desc" },
    });
    return NextResponse.json({ periods });
  } catch (err) {
    console.error("[tariff] Failed to fetch tariff periods:", err);
    return NextResponse.json({ error: "Failed to fetch tariff periods" }, { status: 500 });
  }
}

type TariffPeriodInput = {
  effectiveFrom: string;
  dayRateUah: number;
  nightRateUah: number;
  greenRateUah: number;
};

export async function PUT(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => null)) as {
    periods?: TariffPeriodInput[];
  } | null;

  if (!body || !Array.isArray(body.periods) || body.periods.length === 0) {
    return NextResponse.json(
      { error: "periods must be a non-empty array" },
      { status: 400 },
    );
  }

  for (const p of body.periods) {
    const date = new Date(p.effectiveFrom);
    if (isNaN(date.getTime())) {
      return NextResponse.json(
        { error: `Invalid effectiveFrom date: ${p.effectiveFrom}` },
        { status: 400 },
      );
    }
    if (
      typeof p.dayRateUah !== "number" || p.dayRateUah < 0 ||
      typeof p.nightRateUah !== "number" || p.nightRateUah < 0 ||
      typeof p.greenRateUah !== "number" || p.greenRateUah < 0
    ) {
      return NextResponse.json(
        { error: "dayRateUah, nightRateUah, greenRateUah must be non-negative numbers" },
        { status: 400 },
      );
    }
  }

  try {
    await prisma.$transaction([
      prisma.electricityTariff.deleteMany(),
      ...body.periods.map((p) =>
        prisma.electricityTariff.create({
          data: {
            effectiveFrom: new Date(p.effectiveFrom),
            dayRateUah: p.dayRateUah,
            nightRateUah: p.nightRateUah,
            greenRateUah: p.greenRateUah,
          },
        }),
      ),
    ]);
    const periods = await prisma.electricityTariff.findMany({
      orderBy: { effectiveFrom: "desc" },
    });
    return NextResponse.json({ periods });
  } catch (err) {
    console.error("[tariff] Failed to save tariff periods:", err);
    return NextResponse.json({ error: "Failed to save tariff periods" }, { status: 500 });
  }
}
