"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthState } from "@/app/lib/auth-client";
import {
  CommandType,
  MinerControlPhase,
  type MinerControlState,
  type MinerState,
  type Notification,
} from "@/app/lib/types";
import { LOW_HASHRATE_RESTART_GRACE_MS } from "@/app/lib/constants";
import {
  computeNextControlStates,
  extractBoardCount,
  isHashrateReady,
} from "@/app/lib/miner-control-utils";

type UseMinerSyncOptions = {
  pushNotification: (msg: string) => void;
  playAlertBeep: () => void;
};

export function useMinerSync({ pushNotification, playAlertBeep }: UseMinerSyncOptions) {
  const router = useRouter();
  const [miners, setMiners] = useState<MinerState[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const [pendingActionByMiner, setPendingActionByMiner] = useState<
    Record<string, CommandType | undefined>
  >({});
  const [minerControlStates, setMinerControlStates] = useState<Record<string, MinerControlState>>(
    {},
  );
  const [boardCountByMiner, setBoardCountByMiner] = useState<Record<string, number>>({});
  const [tuyaBindingByMiner, setTuyaBindingByMiner] = useState<Record<string, string>>({});

  const lastSeenRef = useRef<Map<string, string | null>>(new Map());

  const fetchMiners = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/miners");
      if (!res.ok) {
        throw new Error(`Failed to fetch miners: ${res.status}`);
      }
      const data = (await res.json()) as MinerState[];
      const now = Date.now();
      let shouldBeep = false;
      for (const miner of data) {
        const previousSeen = lastSeenRef.current.get(miner.minerId) ?? null;
        const currentSeen = miner.lastSeen ?? null;
        lastSeenRef.current.set(miner.minerId, currentSeen);
        if (!currentSeen || currentSeen === previousSeen) continue;
        const metric = (miner.lastMetric ?? {}) as {
          online?: boolean;
          hashrate?: number;
          expectedHashrate?: number;
        };
        if (metric.online !== true) continue;
        if (
          typeof metric.hashrate !== "number" ||
          typeof metric.expectedHashrate !== "number" ||
          metric.expectedHashrate <= 0
        ) {
          continue;
        }
        if (metric.hashrate >= metric.expectedHashrate) continue;
        if (miner.lastRestartAt) {
          const restartMs = new Date(miner.lastRestartAt).getTime();
          if (Number.isFinite(restartMs) && now - restartMs < LOW_HASHRATE_RESTART_GRACE_MS) {
            continue;
          }
        }
        shouldBeep = true;
      }
      setMiners(data);
      setBoardCountByMiner((prev) => {
        const next = { ...prev };
        for (const miner of data) {
          const count = extractBoardCount(miner.lastMetric);
          if (count > 0) {
            next[miner.minerId] = Math.max(next[miner.minerId] ?? 0, count);
          }
        }
        return next;
      });
      setTuyaBindingByMiner(() => {
        const next: Record<string, string> = {};
        for (const miner of data) {
          if (typeof miner.boundTuyaDeviceId === "string" && miner.boundTuyaDeviceId) {
            next[miner.minerId] = miner.boundTuyaDeviceId;
          }
        }
        return next;
      });
      setMinerControlStates((prev) => computeNextControlStates(prev, data));
      if (shouldBeep) {
        playAlertBeep();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushNotification(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) {
        throw new Error(`Failed to fetch notifications: ${res.status}`);
      }
      const data = (await res.json()) as Notification[];
      setNotifications(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushNotification(message);
    }
  };

  const createCommand = async (minerId: string, type: CommandType) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      setPendingActionByMiner((prev) => ({ ...prev, [minerId]: type }));
      const res = await fetch("/api/commands/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minerId, type }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to create command: ${res.status}`);
      }
      if (type === CommandType.SLEEP) {
        setMinerControlStates((prev) => ({
          ...prev,
          [minerId]: { phase: MinerControlPhase.SLEEPING, since: Date.now() },
        }));
      } else if (type === CommandType.RESTART || type === CommandType.WAKE) {
        const phase: MinerControlPhase =
          type === CommandType.RESTART ? MinerControlPhase.RESTARTING : MinerControlPhase.WAKING;
        setMinerControlStates((prev) => ({
          ...prev,
          [minerId]: { phase, since: Date.now(), source: type },
        }));
      }
      await fetchMiners();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushNotification(message);
    } finally {
      setPendingActionByMiner((prev) => {
        const next = { ...prev };
        delete next[minerId];
        return next;
      });
    }
  };

  const reloadConfig = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    if (miners.length === 0) {
      pushNotification("No miners to reload.");
      return;
    }
    try {
      const type: CommandType = CommandType.RELOAD_CONFIG;
      for (const miner of miners) {
        const res = await fetch("/api/commands/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minerId: miner.minerId, type }),
        });
        if (!res.ok) {
          throw new Error(`Failed to create reload command: ${res.status}`);
        }
      }
      await fetchMiners();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushNotification(message);
    }
  };

  return {
    miners,
    notifications,
    loading,
    reloadPending,
    setReloadPending,
    pendingActionByMiner,
    minerControlStates,
    setMinerControlStates,
    boardCountByMiner,
    setBoardCountByMiner,
    tuyaBindingByMiner,
    setTuyaBindingByMiner,
    fetchMiners,
    fetchNotifications,
    createCommand,
    reloadConfig,
    isHashrateReady,
  };
}
