import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { prisma } from "@/app/lib/prisma";
import {
  calculateConsumptionCost,
  calculateEstimatedCostWithoutAsics,
  calculateSolarCoveragePercent,
  calculateTariffCosts,
  getDeyeEnergySummaryForRange,
} from "@/app/lib/deye-energy";
import { fetchDeyeHistoryDaySummary } from "@/app/lib/deye-client";
import { getSettings } from "@/app/lib/settings";
import type { DeyeEnergyTodaySummary } from "@/app/lib/deye-types";

function round2(v: number): number {
  return Number(v.toFixed(2));
}

function toUtcDateInputValue(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

  const settings = await getSettings();
  const useNetMeteringForGreenTariff = settings.useNetMeteringForGreenTariff === true;
  const miningStartDate = toUtcDateInputValue(
    (settings as { miningStartDate?: Date | string | null }).miningStartDate,
  );

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
    let totalConsumptionDay = 0;
    let totalConsumptionNight = 0;
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
        const fallbackSplit = splitConsumptionByImportShare(
          day.consumptionKwh ?? 0,
          day.importKwhDay ?? 0,
          day.importKwhNight ?? 0,
        );
        if (typeof day.consumptionKwhDay === "number" && Number.isFinite(day.consumptionKwhDay)) {
          totalConsumptionDay += day.consumptionKwhDay;
        } else {
          totalConsumptionDay += fallbackSplit.day;
        }
        if (typeof day.consumptionKwhNight === "number" && Number.isFinite(day.consumptionKwhNight)) {
          totalConsumptionNight += day.consumptionKwhNight;
        } else {
          totalConsumptionNight += fallbackSplit.night;
        }
      }
    }

    if (anyData) {
      const importKwhTotal = totalImportDay + totalImportNight;
      const solarCoveragePercent = calculateSolarCoveragePercent(
        round2(totalConsumption),
        round2(totalGen),
        round2(totalImportDay),
        round2(totalImportNight),
        round2(totalExport),
        { useNetMetering: useNetMeteringForGreenTariff },
      );

      let estimatedNetCost: number | null = null;
      let estimatedNetCostWithGreen: number | null = null;
      let estimatedCostWithoutAsics: number | null = null;
      if (activeTariff) {
        estimatedNetCost = calculateConsumptionCost(
          round2(totalConsumptionDay),
          round2(totalConsumptionNight),
          activeTariff,
        );
        const costs = calculateTariffCosts(
          round2(totalImportDay),
          round2(totalImportNight),
          round2(totalExport),
          activeTariff,
          { useNetMetering: useNetMeteringForGreenTariff },
        );
        estimatedNetCostWithGreen = costs.estimatedNetCostWithGreen;
        estimatedCostWithoutAsics = calculateEstimatedCostWithoutAsics(
          round2(totalGen),
          activeTariff,
        );
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
        estimatedCostWithoutAsics,
      };
    }
  } catch {
    // Deye history unavailable — fall through to DB
  }

  // Fall back to DB samples if Deye history was unavailable
  if (!summary) {
    try {
      summary = await getDeyeEnergySummaryForRange(from, to, activeTariff ?? undefined, {
        useNetMetering: useNetMeteringForGreenTariff,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    summary,
    from: from.toISOString(),
    to: to.toISOString(),
    useNetMeteringForGreenTariff,
    miningStartDate,
  });
}
