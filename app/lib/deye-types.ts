export type DeyeGridSignalSource =
  | "wire_power"
  | "flag"
  | "text"
  | "power"
  | "charging_fallback"
  | "discharging_fallback"
  | "cached_previous"
  | "none";

export type DeyeGridSignals = {
  source: DeyeGridSignalSource;
  flag: {
    key: string | null;
    raw: string | number | boolean | null;
    parsed: boolean | null;
  };
  text: {
    key: string | null;
    value: string | null;
    parsed: boolean | null;
  };
  power: {
    key: string | null;
    raw: number | null;
    kw: number | null;
    parsed: boolean | null;
  };
  chargingFallbackParsed: boolean | null;
  dischargingFallbackParsed: boolean | null;
};

export type DeyeApiSignal = {
  key: string;
  value: string | number | boolean | null;
};

export type DeyeEnergyTodaySummary = {
  consumptionKwh: number;
  generationKwh: number;
  importKwhTotal: number;
  importKwhDay: number;
  importKwhNight: number;
  exportKwh: number;
  solarCoveragePercent: number;
  /** Hypothetical cost of total consumption without green tariff (dayRate × consumptionDay + nightRate × consumptionNight). Null when no tariff is configured. */
  estimatedNetCost: number | null;
  /**
   * Cost with green tariff according to current settings:
   * - net-metering ON: exported kWh first offsets imported kWh 1:1;
   * - net-metering OFF: import cost − exported kWh × greenRate.
   * Null when no tariff or greenRate=0.
   */
  estimatedNetCostWithGreen: number | null;
  /**
   * Hypothetical cost/profit "without ASICs": all generated kWh are treated as sold by green tariff.
   * Computed as -generationKwh * greenRate.
   */
  estimatedCostWithoutAsics: number | null;
};

export type DeyeStationSnapshot = {
  stationId: number;
  gridOnline: boolean | null;
  gridStateText: string | null;
  gridPowerKw: number | null;
  gridSignals: DeyeGridSignals;
  batterySoc: number | null;
  batteryStatus: string | null;
  batteryDischargePowerKw: number | null;
  generationPowerKw: number | null;
  generationDayKwh: number | null;
  consumptionPowerKw: number | null;
  energyToday?: DeyeEnergyTodaySummary;
  apiSignals: DeyeApiSignal[];
  updatedAt: string;
  raw?: unknown;
  error?: string;
};
