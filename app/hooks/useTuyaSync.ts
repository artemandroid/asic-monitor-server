"use client";

import { type MutableRefObject, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthState } from "@/app/lib/auth-client";
import { CommandType, MinerControlPhase, type MinerControlState } from "@/app/lib/types";

type TuyaDevice = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  switchCode: string | null;
  powerW: number | null;
  energyTodayKwh: number | null;
  energyTotalKwh: number | null;
  category: string | null;
  productName: string | null;
};

type TuyaSnapshot = {
  updatedAt: string;
  total: number;
  devices: TuyaDevice[];
  error?: string;
};

type UseTuyaSyncOptions = {
  pushNotification: (msg: string) => void;
  /** Ref to the current tuyaBindingByMiner record — avoids stale closures in async handlers. */
  tuyaBindingRef: MutableRefObject<Record<string, string>>;
  /** Ref to the current fetchMiners function — avoids stale closures in async handlers. */
  fetchMinersRef: MutableRefObject<() => Promise<void>>;
  setMinerControlStates: (
    updater: (prev: Record<string, MinerControlState>) => Record<string, MinerControlState>,
  ) => void;
};

export function useTuyaSync({
  pushNotification,
  tuyaBindingRef,
  fetchMinersRef,
  setMinerControlStates,
}: UseTuyaSyncOptions) {
  const router = useRouter();
  const [tuyaData, setTuyaData] = useState<TuyaSnapshot | null>(null);
  const [tuyaLoading, setTuyaLoading] = useState(false);
  const [pendingTuyaByDevice, setPendingTuyaByDevice] = useState<
    Record<string, "ON" | "OFF" | undefined>
  >({});

  const fetchTuyaDevices = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setTuyaLoading(true);
    try {
      const res = await fetch("/api/tuya/devices", { cache: "no-store" });
      const payload = (await res.json()) as TuyaSnapshot | { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof payload === "object" && payload && "error" in payload && payload.error
            ? String(payload.error)
            : `Failed to fetch Tuya devices: ${res.status}`,
        );
      }
      setTuyaData(payload as TuyaSnapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setTuyaData((prev) => ({
        updatedAt: new Date().toISOString(),
        total: prev?.total ?? 0,
        devices: prev?.devices ?? [],
        error: message,
      }));
      pushNotification(message);
    } finally {
      setTuyaLoading(false);
    }
  };

  const setTuyaSwitch = async (device: TuyaDevice, on: boolean) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    const binding = tuyaBindingRef.current;
    const linkedMinerId =
      Object.entries(binding).find(([, devId]) => devId === device.id)?.[0] ?? null;
    try {
      setPendingTuyaByDevice((prev) => ({ ...prev, [device.id]: on ? "ON" : "OFF" }));
      const res = await fetch("/api/tuya/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: device.id,
          on,
          code: device.switchCode ?? undefined,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to switch device: ${res.status}`);
      }
      // If this automat is bound to a miner, reflect expected miner power state
      // immediately so control buttons stay locked during power/warm-up transitions.
      if (linkedMinerId) {
        setMinerControlStates((prev) => ({
          ...prev,
          [linkedMinerId]: {
            phase: on ? MinerControlPhase.WARMING_UP : MinerControlPhase.SLEEPING,
            since: Date.now(),
            source: on ? "POWER_ON" : undefined,
          },
        }));
      }
      await fetchTuyaDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (linkedMinerId) {
        const fallbackType: CommandType = on ? CommandType.WAKE : CommandType.SLEEP;
        try {
          const fallbackRes = await fetch("/api/commands/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ minerId: linkedMinerId, type: fallbackType }),
          });
          if (fallbackRes.ok) {
            pushNotification(
              `Tuya is unavailable. Fallback ${fallbackType} command queued for ${linkedMinerId}.`,
            );
            if (fallbackType === CommandType.SLEEP) {
              setMinerControlStates((prev) => ({
                ...prev,
                [linkedMinerId]: { phase: MinerControlPhase.SLEEPING, since: Date.now() },
              }));
            } else {
              setMinerControlStates((prev) => ({
                ...prev,
                [linkedMinerId]: {
                  phase: MinerControlPhase.WAKING,
                  since: Date.now(),
                  source: "WAKE",
                },
              }));
            }
            await fetchMinersRef.current();
            return;
          }
        } catch {
          // Fall through and report original Tuya error below.
        }
      }
      pushNotification(message);
    } finally {
      setPendingTuyaByDevice((prev) => {
        const next = { ...prev };
        delete next[device.id];
        return next;
      });
    }
  };

  return {
    tuyaData,
    tuyaLoading,
    pendingTuyaByDevice,
    fetchTuyaDevices,
    setTuyaSwitch,
  };
}
