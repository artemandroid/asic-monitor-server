"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthState } from "@/app/lib/auth-client";
import { normalizeDeyeStationAutomatBindings } from "@/app/lib/miner-control-utils";
import type { DeyeStationSnapshot } from "@/app/lib/deye-types";

export function useDeyeSync(pushNotification: (msg: string) => void) {
  const router = useRouter();
  const [deyeStation, setDeyeStation] = useState<DeyeStationSnapshot | null>(null);
  const [deyeLoading, setDeyeLoading] = useState(false);
  const [deyeAutomatsByStation, setDeyeAutomatsByStation] = useState<Record<string, string[]>>({});
  const [deyeAutomatsLoaded, setDeyeAutomatsLoaded] = useState(false);
  const [deyeAutomatsSaving, setDeyeAutomatsSaving] = useState(false);

  const fetchDeyeStationAutomats = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch("/api/deye/station-automats", { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        bindingsByStation?: Record<string, string[]>;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to fetch Deye station automats: ${res.status}`);
      }
      setDeyeAutomatsByStation(normalizeDeyeStationAutomatBindings(payload.bindingsByStation));
      setDeyeAutomatsLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushNotification(message);
    }
  };

  const fetchDeyeStation = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setDeyeLoading(true);
    try {
      const res = await fetch("/api/deye/station");
      const payload = (await res.json()) as DeyeStationSnapshot | { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof payload === "object" && payload && "error" in payload && payload.error
            ? String(payload.error)
            : `Failed to fetch Deye station: ${res.status}`,
        );
      }
      setDeyeStation(payload as DeyeStationSnapshot);
      await fetchDeyeStationAutomats();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setDeyeStation((prev) => ({
        stationId: prev?.stationId ?? 0,
        gridOnline: prev?.gridOnline ?? null,
        gridStateText: prev?.gridStateText ?? null,
        gridPowerKw: prev?.gridPowerKw ?? null,
        gridSignals: prev?.gridSignals ?? {
          source: "none",
          flag: { key: null, raw: null, parsed: null },
          text: { key: null, value: null, parsed: null },
          power: { key: null, raw: null, kw: null, parsed: null },
          chargingFallbackParsed: null,
          dischargingFallbackParsed: null,
        },
        batterySoc: prev?.batterySoc ?? null,
        batteryStatus: prev?.batteryStatus ?? null,
        batteryDischargePowerKw: prev?.batteryDischargePowerKw ?? null,
        generationPowerKw: prev?.generationPowerKw ?? null,
        generationDayKwh: prev?.generationDayKwh ?? null,
        consumptionPowerKw: prev?.consumptionPowerKw ?? null,
        energyToday: prev?.energyToday,
        apiSignals: prev?.apiSignals ?? [],
        updatedAt: new Date().toISOString(),
        error: message,
      }));
      pushNotification(message);
    } finally {
      setDeyeLoading(false);
    }
  };

  const saveDeyeStationAutomatBinding = async (
    stationId: number,
    deviceId: string,
    bind: boolean,
  ) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    if (!Number.isFinite(stationId) || stationId <= 0) return;
    const normalizedDeviceId = deviceId.trim();
    if (!normalizedDeviceId) return;

    setDeyeAutomatsSaving(true);
    try {
      const res = await fetch("/api/deye/station-automats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationId: Math.trunc(stationId),
          deviceId: normalizedDeviceId,
          bind,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        bindingsByStation?: Record<string, string[]>;
      };
      if (!res.ok) {
        throw new Error(
          payload.error ?? `Failed to update Deye station automats: ${res.status}`,
        );
      }
      setDeyeAutomatsByStation(normalizeDeyeStationAutomatBindings(payload.bindingsByStation));
      setDeyeAutomatsLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushNotification(message);
    } finally {
      setDeyeAutomatsSaving(false);
    }
  };

  const bindAutomatToCurrentDeyeStation = async (deviceId: string) => {
    if (typeof deyeStation?.stationId !== "number" || !Number.isFinite(deyeStation.stationId)) {
      pushNotification("Deye station is not available.");
      return;
    }
    await saveDeyeStationAutomatBinding(deyeStation.stationId, deviceId, true);
  };

  const unbindAutomatFromCurrentDeyeStation = async (deviceId: string) => {
    if (typeof deyeStation?.stationId !== "number" || !Number.isFinite(deyeStation.stationId)) {
      pushNotification("Deye station is not available.");
      return;
    }
    await saveDeyeStationAutomatBinding(deyeStation.stationId, deviceId, false);
  };

  return {
    deyeStation,
    deyeLoading,
    deyeAutomatsByStation,
    deyeAutomatsLoaded,
    deyeAutomatsSaving,
    fetchDeyeStation,
    fetchDeyeStationAutomats,
    saveDeyeStationAutomatBinding,
    bindAutomatToCurrentDeyeStation,
    unbindAutomatFromCurrentDeyeStation,
  };
}
