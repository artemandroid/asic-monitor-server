import { prisma } from "@/app/lib/prisma";
import { NIGHT_TARIFF_END_HOUR, NIGHT_TARIFF_START_HOUR } from "@/app/lib/constants";
import type { DeyeEnergyTodaySummary, DeyeStationSnapshot } from "@/app/lib/deye-types";

type EnergySampleLike = {
  minuteTs: Date;
  generationPowerKw: number | null;
  consumptionPowerKw: number | null;
  wirePowerKw: number | null;
};

type TariffLike = {
  dayRateUah: number;
  nightRateUah: number;
  greenRateUah: number;
};

type DeyeEnergyMemoryState = {
  dayKey: string;
  byMinuteTs: Map<number, Omit<EnergySampleLike, "minuteTs">>;
};

const globalState = globalThis as unknown as {
  __deyeEnergyMemoryState?: DeyeEnergyMemoryState;
};

function floorToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeGenerationDayKwh(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function getDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMemoryState(now: Date): DeyeEnergyMemoryState {
  const expectedDayKey = getDayKey(now);
  const current = globalState.__deyeEnergyMemoryState;
  if (current && current.dayKey === expectedDayKey) return current;

  const fresh: DeyeEnergyMemoryState = {
    dayKey: expectedDayKey,
    byMinuteTs: new Map(),
  };
  globalState.__deyeEnergyMemoryState = fresh;
  return fresh;
}

function saveSampleToMemory(
  minuteTs: Date,
  sample: Omit<EnergySampleLike, "minuteTs">,
): void {
  const state = getMemoryState(minuteTs);
  state.byMinuteTs.set(minuteTs.getTime(), sample);
}

function getMemorySamplesFrom(startOfDay: Date): EnergySampleLike[] {
  const state = getMemoryState(new Date());
  const threshold = startOfDay.getTime();
  const samples: EnergySampleLike[] = [];
  for (const [minuteTsMs, sample] of state.byMinuteTs.entries()) {
    if (minuteTsMs >= threshold) {
      samples.push({ minuteTs: new Date(minuteTsMs), ...sample });
    }
  }
  return samples;
}

/** Returns true if the given hour falls in the night tariff zone (23:00–07:00). */
function isNightHour(hour: number): boolean {
  // Night wraps across midnight: [NIGHT_TARIFF_START_HOUR, 24) ∪ [0, NIGHT_TARIFF_END_HOUR)
  return hour >= NIGHT_TARIFF_START_HOUR || hour < NIGHT_TARIFF_END_HOUR;
}

function summarizeSamples(
  samples: EnergySampleLike[],
  generationDayKwh: number | null = null,
  tariff?: TariffLike,
): DeyeEnergyTodaySummary | null {
  if (samples.length === 0 && generationDayKwh === null) return null;

  let generationFromSamplesKwh = 0;
  let consumptionKwh = 0;
  let importKwhDay = 0;
  let importKwhNight = 0;
  let exportKwh = 0;

  for (const sample of samples) {
    const generationKw = sample.generationPowerKw;
    if (typeof generationKw === "number" && Number.isFinite(generationKw) && generationKw > 0) {
      generationFromSamplesKwh += generationKw / 60;
    }

    const consumptionKw = sample.consumptionPowerKw;
    if (typeof consumptionKw === "number" && Number.isFinite(consumptionKw) && consumptionKw > 0) {
      consumptionKwh += consumptionKw / 60;
    }

    const wireKw = sample.wirePowerKw;
    if (typeof wireKw === "number" && Number.isFinite(wireKw)) {
      if (wireKw > 0) {
        if (isNightHour(sample.minuteTs.getHours())) {
          importKwhNight += wireKw / 60;
        } else {
          importKwhDay += wireKw / 60;
        }
      } else if (wireKw < 0) {
        exportKwh += Math.abs(wireKw) / 60;
      }
    }
  }

  const importKwhTotal = importKwhDay + importKwhNight;
  const effectiveGenerationKwh = generationDayKwh ?? generationFromSamplesKwh;
  const solarCoveragePercent =
    consumptionKwh > 0 ? Math.min(100, (effectiveGenerationKwh / consumptionKwh) * 100) : 0;

  let estimatedNetCost: number | null = null;
  let estimatedNetCostWithGreen: number | null = null;

  if (tariff) {
    const importCost =
      round2(importKwhDay) * tariff.dayRateUah + round2(importKwhNight) * tariff.nightRateUah;
    estimatedNetCost = round2(importCost);

    const exportEarnings = round2(exportKwh) * tariff.greenRateUah;
    estimatedNetCostWithGreen =
      tariff.greenRateUah > 0 ? round2(importCost - exportEarnings) : null;
  }

  return {
    consumptionKwh: round2(consumptionKwh),
    generationKwh: round2(effectiveGenerationKwh),
    importKwhTotal: round2(importKwhTotal),
    importKwhDay: round2(importKwhDay),
    importKwhNight: round2(importKwhNight),
    exportKwh: round2(exportKwh),
    solarCoveragePercent: round2(solarCoveragePercent),
    estimatedNetCost,
    estimatedNetCostWithGreen,
  };
}

export async function saveDeyeEnergySample(snapshot: DeyeStationSnapshot): Promise<void> {
  const minuteTs = floorToMinute(new Date());
  const sampleData = {
    generationPowerKw: snapshot.generationPowerKw,
    consumptionPowerKw: snapshot.consumptionPowerKw,
    wirePowerKw: snapshot.gridPowerKw,
  };
  saveSampleToMemory(minuteTs, sampleData);
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
  } catch (err) {
    console.error("[deye-energy] Failed to write energy sample to DB:", err);
  }
}

export async function getDeyeEnergySummaryForRange(
  from: Date,
  to: Date,
  tariff?: TariffLike,
): Promise<DeyeEnergyTodaySummary | null> {
  const isToday =
    getDayKey(from) === getDayKey(new Date()) &&
    getDayKey(to) > getDayKey(new Date());

  try {
    const rows = await prisma.deyeEnergySample.findMany({
      where: { minuteTs: { gte: from, lt: to } },
      orderBy: { minuteTs: "asc" },
      select: {
        minuteTs: true,
        generationPowerKw: true,
        consumptionPowerKw: true,
        wirePowerKw: true,
      },
    });
    return summarizeSamples(rows, null, tariff);
  } catch (err) {
    console.error("[deye-energy] DB unavailable for range summary:", err);
    if (!isToday) return null;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return summarizeSamples(getMemorySamplesFrom(startOfDay), null, tariff);
  }
}

export async function getDeyeEnergyTodaySummary(options?: {
  generationDayKwh?: number | null;
  tariff?: TariffLike;
}): Promise<DeyeEnergyTodaySummary | null> {
  const generationDayKwh = normalizeGenerationDayKwh(options?.generationDayKwh);
  const tariff = options?.tariff;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  try {
    const rows = await prisma.deyeEnergySample.findMany({
      where: { minuteTs: { gte: startOfDay } },
      orderBy: { minuteTs: "asc" },
      select: {
        minuteTs: true,
        generationPowerKw: true,
        consumptionPowerKw: true,
        wirePowerKw: true,
      },
    });

    const fromDb = summarizeSamples(rows, generationDayKwh, tariff);
    if (fromDb) return fromDb;
  } catch (err) {
    console.error("[deye-energy] DB unavailable for energy summary, using in-memory samples:", err);
  }

  return summarizeSamples(getMemorySamplesFrom(startOfDay), generationDayKwh, tariff);
}
