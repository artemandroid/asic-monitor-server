import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import {
  fetchDeyeStationSnapshot,
  fetchDeyeTodayGenerationKwhFromHistory,
  fetchDeyeHistoryDaySummary,
} from "@/app/lib/deye-client";
import {
  calculateConsumptionCost,
  calculateEstimatedCostWithoutAsics,
  calculateSolarCoveragePercent,
  calculateTariffCosts,
  getDeyeEnergyTodaySummary,
  saveDeyeEnergySample,
} from "@/app/lib/deye-energy";
import { prisma } from "@/app/lib/prisma";
import { getSettings } from "@/app/lib/settings";
import type { DeyeEnergyTodaySummary } from "@/app/lib/deye-types";

function round2(v: number): number {
  return Number(v.toFixed(2));
}

function splitConsumptionByImportShare(
  consumptionKwhRaw: number,
  importKwhDayRaw: number,
  importKwhNightRaw: number,
): { day: number; night: number } {
  const consumptionKwh =
    typeof consumptionKwhRaw === "number" && Number.isFinite(consumptionKwhRaw) && consumptionKwhRaw > 0
      ? consumptionKwhRaw
      : 0;
  const importKwhDay =
    typeof importKwhDayRaw === "number" && Number.isFinite(importKwhDayRaw) && importKwhDayRaw > 0
      ? importKwhDayRaw
      : 0;
  const importKwhNight =
    typeof importKwhNightRaw === "number" && Number.isFinite(importKwhNightRaw) && importKwhNightRaw > 0
      ? importKwhNightRaw
      : 0;
  const importTotal = importKwhDay + importKwhNight;
  if (consumptionKwh <= 0) return { day: 0, night: 0 };
  if (importTotal <= 0) return { day: consumptionKwh / 2, night: consumptionKwh / 2 };
  const day = consumptionKwh * (importKwhDay / importTotal);
  return { day, night: Math.max(0, consumptionKwh - day) };
}

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = await fetchDeyeStationSnapshot();
    await saveDeyeEnergySample(parsed);
    const generationDayKwh = parsed.generationDayKwh ?? (await fetchDeyeTodayGenerationKwhFromHistory());
    const settings = await getSettings();
    const useNetMeteringForGreenTariff = settings.useNetMeteringForGreenTariff === true;

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
        const fallbackSplit = splitConsumptionByImportShare(consumptionKwh, importKwhDay, importKwhNight);
        const consumptionKwhDay = deyeDay.consumptionKwhDay ?? fallbackSplit.day;
        const consumptionKwhNight = deyeDay.consumptionKwhNight ?? fallbackSplit.night;
        const importKwhTotal = importKwhDay + importKwhNight;
        const solarCoveragePercent = calculateSolarCoveragePercent(
          round2(consumptionKwh),
          round2(effectiveGeneration),
          round2(importKwhDay),
          round2(importKwhNight),
          round2(exportKwh),
          { useNetMetering: useNetMeteringForGreenTariff },
        );

        let estimatedNetCost: number | null = null;
        let estimatedNetCostWithGreen: number | null = null;
        let estimatedCostWithoutAsics: number | null = null;
        if (activeTariff) {
          estimatedNetCost = calculateConsumptionCost(
            round2(consumptionKwhDay),
            round2(consumptionKwhNight),
            activeTariff,
          );
          const costs = calculateTariffCosts(
            round2(importKwhDay),
            round2(importKwhNight),
            round2(exportKwh),
            activeTariff,
            { useNetMetering: useNetMeteringForGreenTariff },
          );
          estimatedNetCostWithGreen = costs.estimatedNetCostWithGreen;
          estimatedCostWithoutAsics = calculateEstimatedCostWithoutAsics(
            round2(effectiveGeneration),
            activeTariff,
          );
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
          estimatedCostWithoutAsics,
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
        useNetMetering: useNetMeteringForGreenTariff,
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
