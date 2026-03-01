import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import {
  fetchDeyeStationSnapshot,
  fetchDeyeTodayGenerationKwhFromHistory,
  fetchDeyeHistoryDaySummary,
} from "@/app/lib/deye-client";
import { getDeyeEnergyTodaySummary, saveDeyeEnergySample } from "@/app/lib/deye-energy";
import { prisma } from "@/app/lib/prisma";
import type { DeyeEnergyTodaySummary } from "@/app/lib/deye-types";

function round2(v: number): number {
  return Number(v.toFixed(2));
}

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = await fetchDeyeStationSnapshot();
    await saveDeyeEnergySample(parsed);
    const generationDayKwh = parsed.generationDayKwh ?? (await fetchDeyeTodayGenerationKwhFromHistory());

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let activeTariff = null;
    try {
      activeTariff = await prisma.electricityTariff.findFirst({
        where: { effectiveFrom: { lte: todayStart } },
        orderBy: { effectiveFrom: "desc" },
      });
    } catch {
      // tariff table unavailable — proceed without tariff
    }

    // Try Deye history API for today's full-day consumption and grid data.
    // Use the station timezone (Kiev) to compute today's date key, not UTC.
    let energyToday: DeyeEnergyTodaySummary | null | undefined;
    const stationTimeZone =
      process.env.DEYE_HISTORY_DAY_TIME_ZONE ||
      process.env.APP_TIME_ZONE ||
      process.env.TZ ||
      "Europe/Kiev";
    const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: stationTimeZone }).format(new Date());
    try {
      const deyeDay = await fetchDeyeHistoryDaySummary(todayKey);
      if (deyeDay) {
        const effectiveGeneration = generationDayKwh ?? deyeDay.generationKwh ?? 0;
        const importKwhDay = deyeDay.importKwhDay ?? 0;
        const importKwhNight = deyeDay.importKwhNight ?? 0;
        const exportKwh = deyeDay.exportKwh ?? 0;
        const consumptionKwh = deyeDay.consumptionKwh ?? 0;
        const importKwhTotal = importKwhDay + importKwhNight;
        // Solar coverage = what % of consumption is covered by locally-used solar (not exported).
        const solarToHouseKwh = Math.max(0, effectiveGeneration - exportKwh);
        const solarCoveragePercent =
          consumptionKwh > 0 ? Math.min(100, (solarToHouseKwh / consumptionKwh) * 100) : 0;

        let estimatedNetCost: number | null = null;
        let estimatedNetCostWithGreen: number | null = null;
        if (activeTariff) {
          const importCost = round2(importKwhDay * activeTariff.dayRateUah + importKwhNight * activeTariff.nightRateUah);
          estimatedNetCost = importCost;
          if (activeTariff.greenRateUah > 0) {
            estimatedNetCostWithGreen = round2(importCost - exportKwh * activeTariff.greenRateUah);
          }
        }

        energyToday = {
          generationKwh: round2(effectiveGeneration),
          consumptionKwh: round2(consumptionKwh),
          importKwhTotal: round2(importKwhTotal),
          importKwhDay: round2(importKwhDay),
          importKwhNight: round2(importKwhNight),
          exportKwh: round2(exportKwh),
          solarCoveragePercent: round2(solarCoveragePercent),
          estimatedNetCost,
          estimatedNetCostWithGreen,
        };
      }
    } catch {
      // Deye history unavailable — fall through to DB samples
    }

    // Fall back to DB samples if Deye history was unavailable
    if (!energyToday) {
      energyToday = await getDeyeEnergyTodaySummary({
        generationDayKwh,
        tariff: activeTariff ?? undefined,
      });
    }

    return NextResponse.json({
      ...parsed,
      generationDayKwh,
      energyToday: energyToday ?? undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Deye API error" },
      { status: 502 },
    );
  }
}
