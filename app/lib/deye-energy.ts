import { prisma } from "@/app/lib/prisma";
import type { DeyeStationSnapshot } from "@/app/lib/deye-client";

export type DeyeEnergyTodaySummary = {
  consumptionKwh: number;
  generationKwh: number;
  importKwhTotal: number;
  importKwhDay: number;
  importKwhNight: number;
  exportKwh: number;
  solarCoveragePercent: number;
  estimatedNetCost: number;
};

const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 7;

function floorToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isNightHour(localHour: number): boolean {
  return localHour >= NIGHT_START_HOUR || localHour < NIGHT_END_HOUR;
}

export async function saveDeyeEnergySample(snapshot: DeyeStationSnapshot): Promise<void> {
  const minuteTs = floorToMinute(new Date());
  try {
    await prisma.deyeEnergySample.upsert({
      where: { minuteTs },
      create: {
        minuteTs,
        generationPowerKw: snapshot.generationPowerKw,
        consumptionPowerKw: snapshot.consumptionPowerKw,
        wirePowerKw: snapshot.gridPowerKw,
        batteryPowerKw: snapshot.batteryDischargePowerKw,
      },
      update: {
        generationPowerKw: snapshot.generationPowerKw,
        consumptionPowerKw: snapshot.consumptionPowerKw,
        wirePowerKw: snapshot.gridPowerKw,
        batteryPowerKw: snapshot.batteryDischargePowerKw,
      },
    });
  } catch {
    // Ignore DB write errors and keep runtime stable.
  }
}

export async function getDeyeEnergyTodaySummary(prices: {
  dayTariffPrice: number;
  nightTariffPrice: number;
  greenTariffPrice: number;
}): Promise<DeyeEnergyTodaySummary> {
  const now = new Date();
  const from = startOfDay(now);
  try {
    const rows = await prisma.deyeEnergySample.findMany({
      where: {
        minuteTs: {
          gte: from,
          lte: now,
        },
      },
      orderBy: { minuteTs: "asc" },
    });

    const minuteToHour = 1 / 60;
    let consumptionKwh = 0;
    let generationKwh = 0;
    let importKwhDay = 0;
    let importKwhNight = 0;
    let exportKwh = 0;

    for (const row of rows) {
      if (typeof row.consumptionPowerKw === "number" && Number.isFinite(row.consumptionPowerKw)) {
        consumptionKwh += Math.max(0, row.consumptionPowerKw) * minuteToHour;
      }
      if (typeof row.generationPowerKw === "number" && Number.isFinite(row.generationPowerKw)) {
        generationKwh += Math.max(0, row.generationPowerKw) * minuteToHour;
      }
      if (typeof row.wirePowerKw === "number" && Number.isFinite(row.wirePowerKw)) {
        if (row.wirePowerKw > 0) {
          if (isNightHour(row.minuteTs.getHours())) {
            importKwhNight += row.wirePowerKw * minuteToHour;
          } else {
            importKwhDay += row.wirePowerKw * minuteToHour;
          }
        } else if (row.wirePowerKw < 0) {
          exportKwh += Math.abs(row.wirePowerKw) * minuteToHour;
        }
      }
    }

    const importKwhTotal = importKwhDay + importKwhNight;
    const solarCoveragePercent =
      consumptionKwh > 0 ? Math.max(0, Math.min(100, (Math.min(consumptionKwh, generationKwh) / consumptionKwh) * 100)) : 0;
    const estimatedNetCost =
      importKwhDay * prices.dayTariffPrice +
      importKwhNight * prices.nightTariffPrice -
      exportKwh * prices.greenTariffPrice;

    return {
      consumptionKwh,
      generationKwh,
      importKwhTotal,
      importKwhDay,
      importKwhNight,
      exportKwh,
      solarCoveragePercent,
      estimatedNetCost,
    };
  } catch {
    return {
      consumptionKwh: 0,
      generationKwh: 0,
      importKwhTotal: 0,
      importKwhDay: 0,
      importKwhNight: 0,
      exportKwh: 0,
      solarCoveragePercent: 0,
      estimatedNetCost: 0,
    };
  }
}
