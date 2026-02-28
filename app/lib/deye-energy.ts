import { prisma } from "@/app/lib/prisma";
import type { DeyeEnergyTodaySummary, DeyeStationSnapshot } from "@/app/lib/deye-types";

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

function summarizeSamples(
  samples: EnergySampleLike[],
  generationDayKwh: number | null = null,
): DeyeEnergyTodaySummary | null {
  if (samples.length === 0 && generationDayKwh === null) return null;

  let generationFromSamplesKwh = 0;
  let consumptionKwh = 0;
  let importKwhTotal = 0;
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
        importKwhTotal += wireKw / 60;
      } else if (wireKw < 0) {
        exportKwh += Math.abs(wireKw) / 60;
      }
    }
  }

  const effectiveGenerationKwh = generationDayKwh ?? generationFromSamplesKwh;
  const solarCoveragePercent =
    consumptionKwh > 0 ? Math.min(100, (effectiveGenerationKwh / consumptionKwh) * 100) : 0;

  return {
    consumptionKwh: round2(consumptionKwh),
    generationKwh: round2(effectiveGenerationKwh),
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
  } catch (err) {
    console.error("[deye-energy] Failed to write energy sample to DB:", err);
  }
}

export async function getDeyeEnergyTodaySummary(
  options?: { generationDayKwh?: number | null },
): Promise<DeyeEnergyTodaySummary | null> {
  const generationDayKwh = normalizeGenerationDayKwh(options?.generationDayKwh);
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

    const fromDb = summarizeSamples(samples, generationDayKwh);
    if (fromDb) return fromDb;
  } catch (err) {
    console.error("[deye-energy] DB unavailable for energy summary, using in-memory samples:", err);
  }

  return summarizeSamples(getMemorySamplesFrom(startOfDay), generationDayKwh);
}
