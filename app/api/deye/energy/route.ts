import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { prisma } from "@/app/lib/prisma";
import { getDeyeEnergySummaryForRange } from "@/app/lib/deye-energy";
import { fetchDeyeHistoryDaySummary } from "@/app/lib/deye-client";
import type { DeyeEnergyTodaySummary } from "@/app/lib/deye-types";

function round2(v: number): number {
  return Number(v.toFixed(2));
}

/** Returns YYYY-MM-DD keys for every calendar day from fromStr to toStr (inclusive). */
function getDayKeys(fromStr: string, toStr: string): string[] {
  const keys: string[] = [];
  // Use T12:00:00 to avoid DST boundary shifting the date.
  const cur = new Date(fromStr + "T12:00:00");
  const end = new Date(toStr + "T12:00:00");
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    keys.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = fromParam ? new Date(fromParam) : today;
  from.setHours(0, 0, 0, 0);

  let to: Date;
  if (toParam) {
    to = new Date(toParam);
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 1); // exclusive upper bound: start of next day
  } else {
    to = new Date(today);
    to.setDate(to.getDate() + 1);
  }

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid from/to date params" }, { status: 400 });
  }

  let activeTariff = null;
  try {
    const tariffDate = new Date(to);
    tariffDate.setDate(tariffDate.getDate() - 1); // last day of range
    tariffDate.setHours(0, 0, 0, 0);
    activeTariff = await prisma.electricityTariff.findFirst({
      where: { effectiveFrom: { lte: tariffDate } },
      orderBy: { effectiveFrom: "desc" },
    });
  } catch {
    // tariff table unavailable — proceed without tariff
  }

  // Use the raw query params as dayKeys (YYYY-MM-DD in station/local timezone).
  // Do NOT derive from Date.toISOString() which converts to UTC (wrong day at UTC+2).
  const stationTimeZone =
    process.env.DEYE_HISTORY_DAY_TIME_ZONE ||
    process.env.APP_TIME_ZONE ||
    process.env.TZ ||
    "Europe/Kiev";
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: stationTimeZone }).format(new Date());
  const effectiveFrom = fromParam ?? todayKey;
  const effectiveTo = toParam ?? effectiveFrom;

  let summary: DeyeEnergyTodaySummary | null = null;

  // Try Deye history API for all ranges (single day or multi-day).
  // Past-day results are cached 1 h so a 30-day query is fast on repeated calls.
  try {
    const dayKeys = getDayKeys(effectiveFrom, effectiveTo);
    const dayResults = await Promise.all(dayKeys.map((k) => fetchDeyeHistoryDaySummary(k)));

    let totalGen = 0;
    let totalConsumption = 0;
    let totalImportDay = 0;
    let totalImportNight = 0;
    let totalExport = 0;
    let anyData = false;

    for (const day of dayResults) {
      if (day) {
        anyData = true;
        totalGen += day.generationKwh ?? 0;
        totalConsumption += day.consumptionKwh ?? 0;
        totalImportDay += day.importKwhDay ?? 0;
        totalImportNight += day.importKwhNight ?? 0;
        totalExport += day.exportKwh ?? 0;
      }
    }

    if (anyData) {
      const importKwhTotal = totalImportDay + totalImportNight;
      const solarToHouseKwh = Math.max(0, totalGen - totalExport);
      const solarCoveragePercent =
        totalConsumption > 0 ? Math.min(100, (solarToHouseKwh / totalConsumption) * 100) : 0;

      let estimatedNetCost: number | null = null;
      let estimatedNetCostWithGreen: number | null = null;
      if (activeTariff) {
        const importCost = round2(
          totalImportDay * activeTariff.dayRateUah + totalImportNight * activeTariff.nightRateUah,
        );
        estimatedNetCost = importCost;
        if (activeTariff.greenRateUah > 0) {
          estimatedNetCostWithGreen = round2(importCost - totalExport * activeTariff.greenRateUah);
        }
      }

      summary = {
        generationKwh: round2(totalGen),
        consumptionKwh: round2(totalConsumption),
        importKwhTotal: round2(importKwhTotal),
        importKwhDay: round2(totalImportDay),
        importKwhNight: round2(totalImportNight),
        exportKwh: round2(totalExport),
        solarCoveragePercent: round2(solarCoveragePercent),
        estimatedNetCost,
        estimatedNetCostWithGreen,
      };
    }
  } catch {
    // Deye history unavailable — fall through to DB
  }

  // Fall back to DB samples if Deye history was unavailable
  if (!summary) {
    try {
      summary = await getDeyeEnergySummaryForRange(from, to, activeTariff ?? undefined);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ summary, from: from.toISOString(), to: to.toISOString() });
}
