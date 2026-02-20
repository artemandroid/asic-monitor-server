import { prisma } from "@/app/lib/prisma";
import type { DeyeStationSnapshot } from "@/app/lib/deye-client";

function floorToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
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
