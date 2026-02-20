import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireWebAuth } from "@/app/lib/web-auth";
import { fetchDeyeStationSnapshot } from "@/app/lib/deye-client";
import { getSettings } from "@/app/lib/settings";
import { getDeyeEnergyTodaySummary, saveDeyeEnergySample } from "@/app/lib/deye-energy";

export async function GET(request: NextRequest) {
  const auth = requireWebAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = await fetchDeyeStationSnapshot();
    await saveDeyeEnergySample(parsed);
    const settings = await getSettings();
    const energyToday = await getDeyeEnergyTodaySummary({
      dayTariffPrice: settings.dayTariffPrice,
      nightTariffPrice: settings.nightTariffPrice,
      greenTariffPrice: settings.greenTariffPrice,
    });
    return NextResponse.json({
      ...parsed,
      energyToday,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Deye API error" },
      { status: 502 },
    );
  }
}
