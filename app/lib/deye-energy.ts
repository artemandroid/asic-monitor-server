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

type EnergySampleLike = {
  generationPowerKw: number | null;
  consumptionPowerKw: number | null;
  wirePowerKw: number | null;
};

type DeyeEnergyMemoryState = {
  dayKey: string;
  byMinuteTs: Map<number, EnergySampleLike>;
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

function saveSampleToMemory(minuteTs: Date, sample: EnergySampleLike): void {
  const state = getMemoryState(minuteTs);
  state.byMinuteTs.set(minuteTs.getTime(), sample);
}

function getMemorySamplesFrom(startOfDay: Date): EnergySampleLike[] {
  const state = getMemoryState(new Date());
  const threshold = startOfDay.getTime();
  const samples: EnergySampleLike[] = [];
  for (const [minuteTsMs, sample] of state.byMinuteTs.entries()) {
    if (minuteTsMs >= threshold) samples.push(sample);
  }
  return samples;
}

function summarizeSamples(samples: EnergySampleLike[]): DeyeEnergyTodaySummary | null {
  if (samples.length === 0) return null;

  let generationKwh = 0;
  let consumptionKwh = 0;
  let importKwhTotal = 0;
  let exportKwh = 0;

  for (const sample of samples) {
    const generationKw = sample.generationPowerKw;
    if (typeof generationKw === "number" && Number.isFinite(generationKw) && generationKw > 0) {
      generationKwh += generationKw / 60;
    }

    const consumptionKw = sample.consumptionPowerKw;
    if (typeof consumptionKw === "number" && Number.isFinite(consumptionKw) && consumptionKw > 0) {
      consumptionKwh += consumptionKw / 60;
    }

    const wireKw = sample.wirePowerKw;
    if (typeof wireKw === "number" && Number.isFinite(wireKw)) {
      if (wireKw > 0) {
        importKwhTotal += wireKw / 60;
      } else if (wireKw < 0) {
        exportKwh += Math.abs(wireKw) / 60;
      }
    }
  }

  const solarCoveragePercent =
    consumptionKwh > 0 ? Math.min(100, (generationKwh / consumptionKwh) * 100) : 0;

  return {
    consumptionKwh: round2(consumptionKwh),
    generationKwh: round2(generationKwh),
    importKwhTotal: round2(importKwhTotal),
    importKwhDay: round2(importKwhTotal),
    importKwhNight: 0,
    exportKwh: round2(exportKwh),
    solarCoveragePercent: round2(solarCoveragePercent),
    estimatedNetCost: 0,
  };
}

export async function saveDeyeEnergySample(snapshot: DeyeStationSnapshot): Promise<void> {
  const minuteTs = floorToMinute(new Date());
  saveSampleToMemory(minuteTs, {
    generationPowerKw: snapshot.generationPowerKw,
    consumptionPowerKw: snapshot.consumptionPowerKw,
    wirePowerKw: snapshot.gridPowerKw,
  });
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

export async function getDeyeEnergyTodaySummary(): Promise<DeyeEnergyTodaySummary | null> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  try {
    const samples = await prisma.deyeEnergySample.findMany({
      where: { minuteTs: { gte: startOfDay } },
      orderBy: { minuteTs: "asc" },
      select: {
        generationPowerKw: true,
        consumptionPowerKw: true,
        wirePowerKw: true,
      },
    });

    const fromDb = summarizeSamples(samples);
    if (fromDb) return fromDb;
  } catch {
    // If DB is temporarily unavailable, keep UI metrics from in-memory samples.
  }

  return summarizeSamples(getMemorySamplesFrom(startOfDay));
}
