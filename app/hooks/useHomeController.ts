"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthState, getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, t, type UiLang, writeUiLang } from "@/app/lib/ui-lang";
import type {
  CommandType,
  MinerState,
  Notification,
} from "@/app/lib/types";

const DEFAULT_MINER_SYNC_MS = 60_000;
const DEFAULT_DEYE_SYNC_MS = 60_000;
const DEFAULT_TUYA_SYNC_MS = 60_000;
const LOW_HASHRATE_RESTART_GRACE_MS = 10 * 60 * 1000;
const CONTROL_ACTION_LOCK_MS = 10 * 60 * 1000;
const NOTIFICATION_VISIBLE_COUNT_KEY = "mc_notification_visible_count";
const BOARD_COUNT_BY_MINER_KEY = "mc_board_count_by_miner";

type MinerControlPhase = "RESTARTING" | "SLEEPING" | "WAKING" | "WARMING_UP";
type MinerControlState = {
  phase: MinerControlPhase;
  since: number;
  source?: "RESTART" | "WAKE" | "POWER_ON";
};

type GeneralSettings = {
  minerSyncIntervalSec: number;
  deyeSyncIntervalSec: number;
  tuyaSyncIntervalSec: number;
  restartDelayMinutes: number;
  hashrateDeviationPercent: number;
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
  notificationVisibleCount: number;
  criticalBatteryOffPercent: number;
};

type MinerSettingsPanel = {
  minerId: string;
  autoRestartEnabled: boolean;
  postRestartGraceMinutes: number;
  lowHashrateThresholdGh: number;
  autoPowerOnGridRestore: boolean;
  autoPowerOffGridLoss: boolean;
  autoPowerOffGenerationBelowKw: number | null;
  autoPowerOnGenerationAboveKw: number | null;
  autoPowerOffBatteryBelowPercent: number | null;
  autoPowerOnBatteryAbovePercent: number | null;
  autoPowerRestoreDelayMinutes: number;
  overheatProtectionEnabled: boolean;
  overheatShutdownTempC: number;
  overheatLocked: boolean;
  overheatLockedAt: string | null;
  overheatLastTempC: number | null;
  expectedHashrate: number | null;
};

type DeyeStationSnapshot = {
  stationId: number;
  gridOnline: boolean | null;
  gridStateText: string | null;
  gridPowerKw: number | null;
  gridSignals: {
    source:
      | "wire_power"
      | "flag"
      | "text"
      | "power"
      | "charging_fallback"
      | "discharging_fallback"
      | "cached_previous"
      | "none";
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
  batterySoc: number | null;
  batteryStatus: string | null;
  batteryDischargePowerKw: number | null;
  generationPowerKw: number | null;
  consumptionPowerKw: number | null;
  energyToday?: {
    consumptionKwh: number;
    generationKwh: number;
    importKwhTotal: number;
    importKwhDay: number;
    importKwhNight: number;
    exportKwh: number;
    solarCoveragePercent: number;
    estimatedNetCost: number;
  };
  apiSignals: Array<{
    key: string;
    value: string | number | boolean | null;
  }>;
  updatedAt: string;
  error?: string;
};

type TuyaDevice = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  switchCode: string | null;
  powerW: number | null;
  category: string | null;
  productName: string | null;
};

type TuyaSnapshot = {
  updatedAt: string;
  total: number;
  devices: TuyaDevice[];
  error?: string;
};

type PendingConfirmAction =
  | { kind: "MINER_COMMAND"; minerId: string; command: CommandType }
  | { kind: "TUYA_SWITCH"; device: TuyaDevice; on: boolean };

function extractBoardCount(metric: unknown): number {
  if (!metric || typeof metric !== "object") return 0;
  const m = metric as {
    boardChips?: unknown[];
    boardHwErrors?: unknown[];
    boardFreqs?: unknown[];
    boardHashrates?: unknown[];
    boardTheoreticalHashrates?: unknown[];
    boardInletTemps?: unknown[];
    boardOutletTemps?: unknown[];
    boardStates?: unknown[];
  };

  const chainIndexMax = Array.isArray(m.boardStates)
    ? m.boardStates.reduce((max, state) => {
        if (typeof state !== "string") return max;
        const hit = /^chain(\d+):/i.exec(state.trim());
        if (!hit) return max;
        const idx = Number.parseInt(hit[1], 10);
        return Number.isFinite(idx) ? Math.max(max, idx + 1) : max;
      }, 0)
    : 0;

  return Math.max(
    Array.isArray(m.boardChips) ? m.boardChips.length : 0,
    Array.isArray(m.boardHwErrors) ? m.boardHwErrors.length : 0,
    Array.isArray(m.boardFreqs) ? m.boardFreqs.length : 0,
    Array.isArray(m.boardHashrates) ? m.boardHashrates.length : 0,
    Array.isArray(m.boardTheoreticalHashrates) ? m.boardTheoreticalHashrates.length : 0,
    Array.isArray(m.boardInletTemps) ? m.boardInletTemps.length : 0,
    Array.isArray(m.boardOutletTemps) ? m.boardOutletTemps.length : 0,
    chainIndexMax,
  );
}

export function useHomeController() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [uiLang, setUiLang] = useState<UiLang>("en");
  const lastSeenRef = useRef<Map<string, string | null>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [miners, setMiners] = useState<MinerState[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [clientNotifications, setClientNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const [groupNotifications, setGroupNotifications] = useState(false);
  const [groupedKeys, setGroupedKeys] = useState<string[]>([]);
  const [groupingLoaded, setGroupingLoaded] = useState(false);
  const [minerOrder, setMinerOrder] = useState<string[]>([]);
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [minerAliases, setMinerAliases] = useState<Record<string, string>>({});
  const [aliasesLoaded, setAliasesLoaded] = useState(false);
  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [minerControlStates, setMinerControlStates] = useState<Record<string, MinerControlState>>(
    {},
  );
  const [controlStateLoaded, setControlStateLoaded] = useState(false);
  const [showGeneralSettings, setShowGeneralSettings] = useState(false);
  const [generalSettingsDraft, setGeneralSettingsDraft] = useState<GeneralSettings | null>(null);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [notificationVisibleCount, setNotificationVisibleCount] = useState(2);
  const [minerSyncMs, setMinerSyncMs] = useState(DEFAULT_MINER_SYNC_MS);
  const [deyeSyncMs, setDeyeSyncMs] = useState(DEFAULT_DEYE_SYNC_MS);
  const [tuyaSyncMs, setTuyaSyncMs] = useState(DEFAULT_TUYA_SYNC_MS);
  const [boardCountByMiner, setBoardCountByMiner] = useState<Record<string, number>>({});
  const [boardCountLoaded, setBoardCountLoaded] = useState(false);
  const [activeMinerSettingsId, setActiveMinerSettingsId] = useState<string | null>(null);
  const [minerSettingsDraft, setMinerSettingsDraft] = useState<MinerSettingsPanel | null>(null);
  const [minerSettingsSaving, setMinerSettingsSaving] = useState(false);
  const [pendingActionByMiner, setPendingActionByMiner] = useState<Record<string, CommandType | undefined>>({});
  const [deyeStation, setDeyeStation] = useState<DeyeStationSnapshot | null>(null);
  const [deyeLoading, setDeyeLoading] = useState(false);
  const [tuyaData, setTuyaData] = useState<TuyaSnapshot | null>(null);
  const [tuyaLoading, setTuyaLoading] = useState(false);
  const [tuyaBindingByMiner, setTuyaBindingByMiner] = useState<Record<string, string>>({});
  const [pendingTuyaByDevice, setPendingTuyaByDevice] = useState<Record<string, "ON" | "OFF" | undefined>>({});
  const [hideUnboundAutomats, setHideUnboundAutomats] = useState(false);
  const [hideUnboundLoaded, setHideUnboundLoaded] = useState(false);
  const [deyeCollapsed, setDeyeCollapsed] = useState(false);
  const [tuyaCollapsed, setTuyaCollapsed] = useState(false);
  const [notificationsCollapsed, setNotificationsCollapsed] = useState(false);
  const [sectionCollapseLoaded, setSectionCollapseLoaded] = useState(false);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<PendingConfirmAction | null>(
    null,
  );
  const minerGridRef = useRef<HTMLDivElement | null>(null);
  const [statusBadgesVertical, setStatusBadgesVertical] = useState(false);
  const refreshMainRef = useRef<() => Promise<void>>(async () => {});
  const fetchDeyeStationRef = useRef<() => Promise<void>>(async () => {});
  const fetchTuyaDevicesRef = useRef<() => Promise<void>>(async () => {});
  const processedCommandResultIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setUiLang(readUiLang());
  }, []);

  useEffect(() => {
    const verify = async () => {
      const state = getAuthState();
      if (state) {
        setAuthChecked(true);
        return;
      }
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) {
          router.replace("/auth");
          return;
        }
        const payload = (await res.json()) as { email: string; expiresAt: number };
        setAuthState(payload, true);
        setAuthChecked(true);
      } catch {
        router.replace("/auth");
      }
    };
    void verify();
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_notification_grouping");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        groupAll?: boolean;
        groupedKeys?: string[];
      };
      if (typeof parsed.groupAll === "boolean") {
        setGroupNotifications(parsed.groupAll);
      }
      if (Array.isArray(parsed.groupedKeys)) {
        setGroupedKeys(parsed.groupedKeys.filter((key) => typeof key === "string"));
      }
    } catch {
      // ignore corrupted storage
    }
    setGroupingLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_miner_order");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        setMinerOrder(parsed.filter((id) => typeof id === "string"));
      }
    } catch {
      // ignore corrupted storage
    }
    setOrderLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_miner_aliases");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === "object") {
        setMinerAliases(parsed);
      }
    } catch {
      // ignore corrupted storage
    }
    setAliasesLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_miner_control_states");
    if (!raw) {
      setControlStateLoaded(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, MinerControlState>;
      if (parsed && typeof parsed === "object") {
        setMinerControlStates(parsed);
      }
    } catch {
      // ignore corrupted storage
    }
    setControlStateLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!groupingLoaded) return;
    const payload = JSON.stringify({
      groupAll: groupNotifications,
      groupedKeys,
    });
    window.localStorage.setItem("mc_notification_grouping", payload);
  }, [groupNotifications, groupedKeys, groupingLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!orderLoaded) return;
    window.localStorage.setItem("mc_miner_order", JSON.stringify(minerOrder));
  }, [minerOrder, orderLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!aliasesLoaded) return;
    window.localStorage.setItem("mc_miner_aliases", JSON.stringify(minerAliases));
  }, [minerAliases, aliasesLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!controlStateLoaded) return;
    window.localStorage.setItem("mc_miner_control_states", JSON.stringify(minerControlStates));
  }, [minerControlStates, controlStateLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_hide_unbound_automats");
    if (raw === "1") {
      setHideUnboundAutomats(true);
    }
    setHideUnboundLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hideUnboundLoaded) return;
    window.localStorage.setItem("mc_hide_unbound_automats", hideUnboundAutomats ? "1" : "0");
  }, [hideUnboundAutomats, hideUnboundLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_section_collapsed");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { deye?: boolean; tuya?: boolean; notifications?: boolean };
        if (typeof parsed.deye === "boolean") setDeyeCollapsed(parsed.deye);
        if (typeof parsed.tuya === "boolean") setTuyaCollapsed(parsed.tuya);
        if (typeof parsed.notifications === "boolean") setNotificationsCollapsed(parsed.notifications);
      } catch {
        // ignore corrupted storage
      }
    }
    setSectionCollapseLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sectionCollapseLoaded) return;
    window.localStorage.setItem(
      "mc_section_collapsed",
      JSON.stringify({ deye: deyeCollapsed, tuya: tuyaCollapsed, notifications: notificationsCollapsed }),
    );
  }, [deyeCollapsed, tuyaCollapsed, notificationsCollapsed, sectionCollapseLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(NOTIFICATION_VISIBLE_COUNT_KEY);
    if (!raw) return;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setNotificationVisibleCount(parsed);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      NOTIFICATION_VISIBLE_COUNT_KEY,
      String(Math.max(1, Math.floor(notificationVisibleCount))),
    );
  }, [notificationVisibleCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(BOARD_COUNT_BY_MINER_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (parsed && typeof parsed === "object") {
          const next: Record<string, number> = {};
          for (const [minerId, count] of Object.entries(parsed)) {
            const num = Number(count);
            if (Number.isFinite(num) && num > 0) {
              next[minerId] = Math.floor(num);
            }
          }
          setBoardCountByMiner(next);
        }
      } catch {
        // ignore corrupted storage
      }
    }
    setBoardCountLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!boardCountLoaded) return;
    window.localStorage.setItem(BOARD_COUNT_BY_MINER_KEY, JSON.stringify(boardCountByMiner));
  }, [boardCountByMiner, boardCountLoaded]);

  useEffect(() => {
    const grid = minerGridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const estimatedCardWidth = (width - 20) / 3;
      setStatusBadgesVertical(estimatedCardWidth < 600);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    const id = setInterval(() => {
      const state = getAuthState();
      if (!state) {
        router.replace("/auth");
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [authChecked, router]);

  useEffect(() => {
    if (!authChecked) return;
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          notificationVisibleCount?: number;
          minerSyncIntervalSec?: number;
          deyeSyncIntervalSec?: number;
          tuyaSyncIntervalSec?: number;
        };
        if (typeof data.notificationVisibleCount === "number" && data.notificationVisibleCount >= 1) {
          setNotificationVisibleCount(Math.floor(data.notificationVisibleCount));
        }
        if (typeof data.minerSyncIntervalSec === "number" && data.minerSyncIntervalSec >= 5) {
          setMinerSyncMs(Math.floor(data.minerSyncIntervalSec) * 1000);
        }
        if (typeof data.deyeSyncIntervalSec === "number" && data.deyeSyncIntervalSec >= 5) {
          setDeyeSyncMs(Math.floor(data.deyeSyncIntervalSec) * 1000);
        }
        if (typeof data.tuyaSyncIntervalSec === "number" && data.tuyaSyncIntervalSec >= 5) {
          setTuyaSyncMs(Math.floor(data.tuyaSyncIntervalSec) * 1000);
        }
      } catch {
        // ignore
      }
    };
    void loadSettings();
  }, [authChecked]);

  const pushClientNotification = (message: string) => {
    setClientNotifications((prev) => {
      const entry: Notification = {
        id: crypto.randomUUID(),
        type: "CLIENT_ERROR",
        message,
        createdAt: new Date().toISOString(),
      };
      return [entry, ...prev].slice(0, 50);
    });
  };

  const playAlertBeep = () => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const envelope = (start: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.08, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.15);
      };
      envelope(now, 920);
      envelope(now + 0.18, 760);
    } catch {
      // Ignore audio errors (browser restrictions, etc)
    }
  };

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
        if (!currentSeen || currentSeen === previousSeen) {
          continue;
        }
        const metric = (miner.lastMetric ?? {}) as {
          online?: boolean;
          hashrate?: number;
          expectedHashrate?: number;
        };
        if (metric.online !== true) {
          continue;
        }
        if (
          typeof metric.hashrate !== "number" ||
          typeof metric.expectedHashrate !== "number" ||
          metric.expectedHashrate <= 0
        ) {
          continue;
        }
        const threshold = metric.expectedHashrate;
        if (metric.hashrate >= threshold) {
          continue;
        }
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
      reconcileControlStates(data);
      setMinerOrder((prev) => {
        const next = [...prev];
        for (const m of data) {
          if (!next.includes(m.minerId)) next.push(m.minerId);
        }
        return next.filter((id) => data.some((m) => m.minerId === id));
      });
      if (shouldBeep) {
        playAlertBeep();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setLoading(false);
    }
  };

  const isHashrateReady = (metric: {
    expectedHashrate?: number;
    hashrate?: number;
    hashrateRealtime?: number;
    online?: boolean;
  } | null): boolean => {
    if (!metric || metric.online !== true) return false;
    if (
      typeof metric.expectedHashrate !== "number" ||
      metric.expectedHashrate <= 0
    ) {
      return false;
    }
    if (typeof metric.hashrateRealtime !== "number") {
      return false;
    }
    const realtimeMh =
      metric.hashrateRealtime > 500 ? metric.hashrateRealtime : metric.hashrateRealtime * 1000;
    return realtimeMh >= metric.expectedHashrate * 0.9;
  };

  const isSleepingState = (metric: {
    expectedHashrate?: number;
    hashrate?: number;
    hashrateRealtime?: number;
    minerMode?: number;
    online?: boolean;
  } | null): boolean => {
    if (!metric) return false;
    return metric.minerMode === 1;
  };

  const reconcileControlStates = (data: MinerState[]) => {
    setMinerControlStates((prev) => {
      const next: Record<string, MinerControlState> = {};
      const now = Date.now();
      let changed = false;

      for (const miner of data) {
        const current = prev[miner.minerId];
        if (!current) continue;
        const metric = miner.lastMetric as
          | {
              expectedHashrate?: number;
              hashrate?: number;
              hashrateRealtime?: number;
              minerMode?: number;
              online?: boolean;
            }
          | null;
        const online = metric?.online === true;
        const ready = isHashrateReady(metric);
        const sleeping = isSleepingState(metric);

        if (now - current.since > CONTROL_ACTION_LOCK_MS * 6) {
          changed = true;
          continue;
        }

        if (current.phase === "RESTARTING") {
          if (!online) {
            changed = true;
            continue;
          }
          if (online && !ready) {
            next[miner.minerId] = { phase: "WARMING_UP", since: current.since, source: current.source };
            changed = true;
            continue;
          }
          if (ready) {
            changed = true;
            continue;
          }
          next[miner.minerId] = current;
          continue;
        }

        if (current.phase === "WAKING") {
          if (!online) {
            changed = true;
            continue;
          }
          if (online && !ready) {
            next[miner.minerId] = { phase: "WARMING_UP", since: current.since, source: current.source };
            changed = true;
            continue;
          }
          if (ready) {
            changed = true;
            continue;
          }
          next[miner.minerId] = current;
          continue;
        }

        if (current.phase === "WARMING_UP") {
          if (!online) {
            changed = true;
            continue;
          }
          if (ready) {
            changed = true;
            continue;
          }
          next[miner.minerId] = current;
          continue;
        }

        if (current.phase === "SLEEPING") {
          if (!sleeping) {
            changed = true;
            continue;
          }
          next[miner.minerId] = current;
          continue;
        }
      }

      for (const miner of data) {
        if (!(miner.minerId in next) && prev[miner.minerId]) {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
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
      pushClientNotification(message);
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
        consumptionPowerKw: prev?.consumptionPowerKw ?? null,
        energyToday: prev?.energyToday,
        apiSignals: prev?.apiSignals ?? [],
        updatedAt: new Date().toISOString(),
        error: message,
      }));
      pushClientNotification(message);
    } finally {
      setDeyeLoading(false);
    }
  };

  const fetchTuyaDevices = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setTuyaLoading(true);
    try {
      const res = await fetch("/api/tuya/devices");
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
      pushClientNotification(message);
    } finally {
      setTuyaLoading(false);
    }
  };

  const setTuyaSwitch = async (device: TuyaDevice, on: boolean) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
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
      const linkedMinerId =
        Object.entries(tuyaBindingByMiner).find(([, devId]) => devId === device.id)?.[0] ?? null;
      if (linkedMinerId) {
        setMinerControlStates((prev) => ({
          ...prev,
          [linkedMinerId]: {
            phase: on ? "WARMING_UP" : "SLEEPING",
            since: Date.now(),
            source: on ? "POWER_ON" : undefined,
          },
        }));
      }
      await fetchTuyaDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setPendingTuyaByDevice((prev) => {
        const next = { ...prev };
        delete next[device.id];
        return next;
      });
    }
  };

  const saveTuyaBinding = async (minerId: string, deviceId: string | null) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch("/api/miners/bindings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minerId, deviceId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to save binding: ${res.status}`);
      }
      setTuyaBindingByMiner((prev) => {
        const next: Record<string, string> = {};
        for (const [id, dev] of Object.entries(prev)) {
          if (dev === deviceId) continue;
          next[id] = dev;
        }
        if (deviceId) {
          next[minerId] = deviceId;
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    }
  };

  const refreshMain = async () => {
    await Promise.all([fetchMiners(), fetchNotifications()]);
  };

  const refreshAll = async () => {
    await Promise.all([refreshMain(), fetchDeyeStation(), fetchTuyaDevices()]);
  };

  refreshMainRef.current = refreshMain;
  fetchDeyeStationRef.current = fetchDeyeStation;
  fetchTuyaDevicesRef.current = fetchTuyaDevices;

  const openGeneralSettings = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to fetch settings: ${res.status}`);
      }
      const data = (await res.json()) as {
        minerSyncIntervalSec?: number;
        deyeSyncIntervalSec?: number;
        tuyaSyncIntervalSec?: number;
        restartDelayMinutes: number;
        hashrateDeviationPercent: number;
        notifyAutoRestart: boolean;
        notifyRestartPrompt: boolean;
        notificationVisibleCount?: number;
        criticalBatteryOffPercent?: number;
      };
      setGeneralSettingsDraft({
        minerSyncIntervalSec:
          typeof data.minerSyncIntervalSec === "number" ? data.minerSyncIntervalSec : 60,
        deyeSyncIntervalSec:
          typeof data.deyeSyncIntervalSec === "number" ? data.deyeSyncIntervalSec : 60,
        tuyaSyncIntervalSec:
          typeof data.tuyaSyncIntervalSec === "number" ? data.tuyaSyncIntervalSec : 60,
        restartDelayMinutes: data.restartDelayMinutes,
        hashrateDeviationPercent: data.hashrateDeviationPercent,
        notifyAutoRestart: data.notifyAutoRestart,
        notifyRestartPrompt: data.notifyRestartPrompt,
        notificationVisibleCount:
          typeof data.notificationVisibleCount === "number"
            ? data.notificationVisibleCount
            : notificationVisibleCount,
        criticalBatteryOffPercent:
          typeof data.criticalBatteryOffPercent === "number"
            ? data.criticalBatteryOffPercent
            : 30,
      });
      setShowGeneralSettings(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    }
  };

  const saveGeneralSettings = async () => {
    if (!generalSettingsDraft) return;
    setGeneralSettingsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generalSettingsDraft),
      });
      if (!res.ok) {
        throw new Error(`Failed to update settings: ${res.status}`);
      }
      const updated = (await res.json().catch(() => ({}))) as {
        notificationVisibleCount?: number;
        minerSyncIntervalSec?: number;
        deyeSyncIntervalSec?: number;
        tuyaSyncIntervalSec?: number;
      };
      const savedCount =
        typeof updated.notificationVisibleCount === "number"
          ? updated.notificationVisibleCount
          : generalSettingsDraft.notificationVisibleCount;
      setNotificationVisibleCount(Math.max(1, Math.floor(savedCount)));
      const savedMinerSyncSec =
        typeof updated.minerSyncIntervalSec === "number"
          ? updated.minerSyncIntervalSec
          : generalSettingsDraft.minerSyncIntervalSec;
      const savedDeyeSyncSec =
        typeof updated.deyeSyncIntervalSec === "number"
          ? updated.deyeSyncIntervalSec
          : generalSettingsDraft.deyeSyncIntervalSec;
      const savedTuyaSyncSec =
        typeof updated.tuyaSyncIntervalSec === "number"
          ? updated.tuyaSyncIntervalSec
          : generalSettingsDraft.tuyaSyncIntervalSec;
      setMinerSyncMs(Math.max(5, Math.floor(savedMinerSyncSec)) * 1000);
      setDeyeSyncMs(Math.max(5, Math.floor(savedDeyeSyncSec)) * 1000);
      setTuyaSyncMs(Math.max(5, Math.floor(savedTuyaSyncSec)) * 1000);
      setShowGeneralSettings(false);
      setGeneralSettingsDraft(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setGeneralSettingsSaving(false);
    }
  };

  const openMinerSettings = async (minerId: string) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch(`/api/miners/${encodeURIComponent(minerId)}/settings`);
      if (!res.ok) {
        throw new Error(`Failed to fetch miner settings: ${res.status}`);
      }
      const data = (await res.json()) as MinerSettingsPanel;
      setMinerSettingsDraft({
        ...data,
        autoPowerOnBatteryAbovePercent:
          typeof data.autoPowerOnBatteryAbovePercent === "number"
            ? data.autoPowerOnBatteryAbovePercent
            : typeof data.autoPowerOffBatteryBelowPercent === "number"
              ? data.autoPowerOffBatteryBelowPercent
              : null,
        autoPowerOnGenerationAboveKw:
          typeof data.autoPowerOnGenerationAboveKw === "number"
            ? data.autoPowerOnGenerationAboveKw
            : null,
        autoPowerRestoreDelayMinutes:
          typeof data.autoPowerRestoreDelayMinutes === "number"
            ? data.autoPowerRestoreDelayMinutes
            : 10,
        overheatProtectionEnabled:
          typeof data.overheatProtectionEnabled === "boolean"
            ? data.overheatProtectionEnabled
            : true,
        overheatShutdownTempC:
          typeof data.overheatShutdownTempC === "number"
            ? data.overheatShutdownTempC
            : 84,
        overheatLocked: data.overheatLocked === true,
        overheatLockedAt: data.overheatLockedAt ?? null,
        overheatLastTempC:
          typeof data.overheatLastTempC === "number" ? data.overheatLastTempC : null,
      });
      setActiveMinerSettingsId(minerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    }
  };

  const saveMinerSettings = async () => {
    if (!minerSettingsDraft) return;
    const offThreshold = minerSettingsDraft.autoPowerOffBatteryBelowPercent;
    const onThreshold =
      minerSettingsDraft.autoPowerOnBatteryAbovePercent ??
      minerSettingsDraft.autoPowerOffBatteryBelowPercent ??
      null;
    if (
      typeof offThreshold === "number" &&
      typeof onThreshold === "number" &&
      onThreshold < offThreshold
    ) {
      pushClientNotification("Auto ON battery threshold must be >= Auto OFF battery threshold.");
      return;
    }
    setMinerSettingsSaving(true);
    try {
      const res = await fetch(
        `/api/miners/${encodeURIComponent(minerSettingsDraft.minerId)}/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            autoRestartEnabled: minerSettingsDraft.autoRestartEnabled,
            postRestartGraceMinutes: minerSettingsDraft.postRestartGraceMinutes,
            lowHashrateThresholdGh: minerSettingsDraft.lowHashrateThresholdGh,
            autoPowerOnGridRestore: minerSettingsDraft.autoPowerOnGridRestore,
            autoPowerOffGridLoss: minerSettingsDraft.autoPowerOffGridLoss,
            autoPowerOffGenerationBelowKw: minerSettingsDraft.autoPowerOffGenerationBelowKw,
            autoPowerOnGenerationAboveKw: minerSettingsDraft.autoPowerOnGenerationAboveKw,
            autoPowerOffBatteryBelowPercent: minerSettingsDraft.autoPowerOffBatteryBelowPercent,
            autoPowerOnBatteryAbovePercent: minerSettingsDraft.autoPowerOnBatteryAbovePercent,
            autoPowerRestoreDelayMinutes: minerSettingsDraft.autoPowerRestoreDelayMinutes,
            overheatProtectionEnabled: minerSettingsDraft.overheatProtectionEnabled,
            overheatShutdownTempC: minerSettingsDraft.overheatShutdownTempC,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to update miner settings: ${res.status}`);
      }
      setActiveMinerSettingsId(null);
      setMinerSettingsDraft(null);
      void fetchMiners();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setMinerSettingsSaving(false);
    }
  };

  const unlockOverheatControl = async (minerId: string) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch(`/api/miners/${encodeURIComponent(minerId)}/unlock-overheat`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to unlock control: ${res.status}`);
      }
      await fetchMiners();
      if (activeMinerSettingsId === minerId) {
        await openMinerSettings(minerId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
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
      if (type === "SLEEP") {
        setMinerControlStates((prev) => ({
          ...prev,
          [minerId]: { phase: "SLEEPING", since: Date.now() },
        }));
      } else if (type === "RESTART" || type === "WAKE") {
        const phase: MinerControlPhase =
          type === "RESTART" ? "RESTARTING" : "WAKING";
        setMinerControlStates((prev) => ({
          ...prev,
          [minerId]: { phase, since: Date.now(), source: type },
        }));
      }
      await fetchMiners();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setPendingActionByMiner((prev) => {
        const next = { ...prev };
        delete next[minerId];
        return next;
      });
    }
  };

  const requestMinerCommandConfirm = (minerId: string, command: CommandType) => {
    setPendingConfirmAction({ kind: "MINER_COMMAND", minerId, command });
  };

  const requestTuyaSwitchConfirm = (device: TuyaDevice, on: boolean) => {
    setPendingConfirmAction({ kind: "TUYA_SWITCH", device, on });
  };

  const runConfirmedAction = async () => {
    if (!pendingConfirmAction) return;
    const action = pendingConfirmAction;
    setPendingConfirmAction(null);
    if (action.kind === "MINER_COMMAND") {
      await createCommand(action.minerId, action.command);
      return;
    }
    await setTuyaSwitch(action.device, action.on);
  };

  const reloadConfig = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    if (miners.length === 0) {
      pushClientNotification("No miners to reload.");
      return;
    }
    setReloadPending(true);
    try {
      const type: CommandType = "RELOAD_CONFIG";
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
      pushClientNotification(message);
    } finally {
      setReloadPending(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    void refreshMainRef.current();
    const id = setInterval(() => {
      void refreshMainRef.current();
    }, minerSyncMs);
    return () => clearInterval(id);
  }, [authChecked, minerSyncMs]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchDeyeStationRef.current();
    const id = setInterval(() => {
      void fetchDeyeStationRef.current();
    }, deyeSyncMs);
    return () => clearInterval(id);
  }, [authChecked, deyeSyncMs]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchTuyaDevicesRef.current();
    const id = setInterval(() => {
      void fetchTuyaDevicesRef.current();
    }, tuyaSyncMs);
    return () => clearInterval(id);
  }, [authChecked, tuyaSyncMs]);

  type DisplayNotification = Notification & { count?: number };

  const groupKeyFor = (note: Notification) => {
    if (note.type === "CLIENT_ERROR") {
      return `${note.type}|${note.message}`;
    }
    return `${note.type}|${note.minerId ?? ""}|${note.action ?? ""}`;
  };

  const visibleNotifications = [...clientNotifications, ...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const groupedNotifications: DisplayNotification[] = (() => {
    const map = new Map<string, DisplayNotification>();
    const output: DisplayNotification[] = [];
    for (const note of visibleNotifications) {
      const key = groupKeyFor(note);
      const shouldGroup = groupNotifications || groupedKeys.includes(key);
      if (!shouldGroup) {
        output.push(note);
        continue;
      }
      const existing = map.get(key);
      if (!existing) {
        const entry: DisplayNotification = { ...note, count: 1 };
        map.set(key, entry);
        output.push(entry);
      } else {
        existing.count = (existing.count ?? 1) + 1;
      }
    }
    return output;
  })();
  const visibleGroupedNotifications = groupedNotifications.slice(
    0,
    Math.max(1, Math.floor(notificationVisibleCount)),
  );
  const minerById = new Map(miners.map((m) => [m.minerId, m]));

  const toGh = (value: number | null | undefined): number | null => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value > 500 ? value / 1000 : value;
  };

  const restartActionStateForNote = (
    note: DisplayNotification,
  ): { enabled: boolean; title?: string } => {
    if (note.action !== "RESTART" || !note.minerId) {
      return { enabled: false, title: "Action is not available" };
    }
    const miner = minerById.get(note.minerId);
    if (!miner) {
      return { enabled: false, title: "Miner is not available" };
    }
    if (miner.overheatLocked === true) {
      return { enabled: false, title: "Overheat lock is active" };
    }
    if (pendingActionByMiner[miner.minerId]) {
      return { enabled: false, title: "Command already requested" };
    }
    if (
      miner.pendingCommandType === "RESTART" ||
      miner.pendingCommandType === "SLEEP" ||
      miner.pendingCommandType === "WAKE"
    ) {
      return { enabled: false, title: t(uiLang, "command_is_already_pending") };
    }

    const metric = (miner.lastMetric ?? null) as {
      online?: boolean;
      hashrateRealtime?: number;
      hashrate?: number;
    } | null;
    if (!metric || metric.online !== true) {
      return { enabled: false, title: t(uiLang, "miner_is_offline") };
    }

    const currentGh = toGh(metric.hashrateRealtime ?? metric.hashrate ?? null);
    const thresholdGh =
      typeof miner.lowHashrateThresholdGh === "number" ? miner.lowHashrateThresholdGh : null;
    if (currentGh === null || thresholdGh === null) {
      return { enabled: false, title: t(uiLang, "no_hashrate_data") };
    }
    if (currentGh >= thresholdGh) {
      return { enabled: false, title: t(uiLang, "hashrate_is_normal_now") };
    }

    if (miner.lastRestartAt) {
      const restartAtMs = new Date(miner.lastRestartAt).getTime();
      const graceMs = Math.max(miner.postRestartGraceMinutes ?? 10, 0) * 60 * 1000;
      if (Number.isFinite(restartAtMs) && Date.now() - restartAtMs < graceMs) {
        return { enabled: false, title: t(uiLang, "post_restart_grace_period_is_active") };
      }
    }

    return { enabled: true };
  };

  const localizeNotificationMessage = (message: string): string => {
    const autoRestart = /^Hashrate on (.+) dropped to ([\d.]+) GH\/s\. Auto-restart issued\.$/.exec(message);
    if (autoRestart) {
      return t(uiLang, "hashrate_dropped_auto_restart_issued", {
        minerId: autoRestart[1],
        hashrate: autoRestart[2],
      });
    }
    const restartPrompt =
      /^Hashrate on (.+) dropped to ([\d.]+) GH\/s\. Auto-restart is disabled\. Restart now\?$/.exec(
        message,
      );
    if (restartPrompt) {
      return t(uiLang, "hashrate_dropped_auto_restart_disabled_restart_now", {
        minerId: restartPrompt[1],
        hashrate: restartPrompt[2],
      });
    }
    const overheat =
      /^Overheat lock on (.+): ([\d.]+)C >= ([\d.]+)C\. Manual Unlock control is required\.$/.exec(
        message,
      );
    if (overheat) {
      return t(uiLang, "overheat_lock_manual_unlock_required", {
        minerId: overheat[1],
        tempC: overheat[2],
        limitC: overheat[3],
      });
    }
    const boardDrift = /^Board hashrate drift on (.+): (.+)\.$/.exec(message);
    if (boardDrift) {
      return t(uiLang, "board_hashrate_drift_detected", {
        minerId: boardDrift[1],
        summary: boardDrift[2],
      });
    }
    const commandSuccess = /^Command (RESTART|SLEEP|WAKE|RELOAD_CONFIG) succeeded on (.+)\.$/.exec(message);
    if (commandSuccess) {
      return t(uiLang, "command_succeeded_on_miner", {
        command: commandSuccess[1],
        minerId: commandSuccess[2],
      });
    }
    const commandFailed = /^Command (RESTART|SLEEP|WAKE|RELOAD_CONFIG) failed on (.+?)(?:: (.+))?\.$/.exec(message);
    if (commandFailed) {
      return t(uiLang, "command_failed_on_miner", {
        command: commandFailed[1],
        minerId: commandFailed[2],
        reason: commandFailed[3] ? `: ${commandFailed[3]}` : "",
      });
    }
    const autoOffCritical = /^Auto OFF requested for (.+): grid is OFF and battery < ([\d.]+)%\.$/.exec(message);
    if (autoOffCritical) {
      return t(uiLang, "auto_off_requested_battery_critical", {
        deviceName: autoOffCritical[1],
        threshold: autoOffCritical[2],
      });
    }
    const autoOff = /^Auto OFF requested for (.+)\.$/.exec(message);
    if (autoOff) {
      return t(uiLang, "auto_off_requested_generic", {
        deviceName: autoOff[1],
      });
    }
    const autoOnGrid = /^Auto ON requested for (.+) because grid is available\.$/.exec(message);
    if (autoOnGrid) {
      return t(uiLang, "auto_on_requested_grid_available", {
        deviceName: autoOnGrid[1],
      });
    }
    const autoOnDelay = /^Auto ON requested for (.+) after threshold recovery delay\.$/.exec(message);
    if (autoOnDelay) {
      return t(uiLang, "auto_on_requested_after_delay", {
        deviceName: autoOnDelay[1],
      });
    }
    return message;
  };

  const orderedMiners = [...miners].sort((a, b) => {
    const ai = minerOrder.indexOf(a.minerId);
    const bi = minerOrder.indexOf(b.minerId);
    const av = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
    const bv = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
    return av - bv;
  });
  const deviceById = new Map((tuyaData?.devices ?? []).map((d) => [d.id, d]));
  const deviceToMiner = new Map<string, string>();
  for (const [minerId, deviceId] of Object.entries(tuyaBindingByMiner)) {
    if (deviceId) deviceToMiner.set(deviceId, minerId);
  }

  useEffect(() => {
    const all = [...clientNotifications, ...notifications];
    if (all.length === 0) return;
    const now = Date.now();
    for (const note of all) {
      if (note.type !== "COMMAND_RESULT" || !note.id || !note.minerId) continue;
      if (processedCommandResultIdsRef.current.has(note.id)) continue;
      processedCommandResultIdsRef.current.add(note.id);

      const msg = String(note.message ?? "");
      const ok = msg.includes("succeeded on");
      const failed = msg.includes("failed on");
      const sleepCmd = msg.includes("Command SLEEP ");
      const wakeCmd = msg.includes("Command WAKE ");
      const restartCmd = msg.includes("Command RESTART ");
      if (!ok && !failed) continue;

      if (ok && sleepCmd) {
        setMinerControlStates((prev) => ({
          ...prev,
          [note.minerId!]: { phase: "SLEEPING", since: now },
        }));
        continue;
      }

      if (ok && wakeCmd) {
        setMinerControlStates((prev) => ({
          ...prev,
          [note.minerId!]: { phase: "WARMING_UP", since: now, source: "WAKE" },
        }));
        continue;
      }

      if (ok && restartCmd) {
        setMinerControlStates((prev) => ({
          ...prev,
          [note.minerId!]: { phase: "WARMING_UP", since: now, source: "RESTART" },
        }));
        continue;
      }

      if (failed && (sleepCmd || wakeCmd || restartCmd)) {
        setMinerControlStates((prev) => {
          if (!prev[note.minerId!]) return prev;
          const next = { ...prev };
          delete next[note.minerId!];
          return next;
        });
      }
    }
  }, [notifications, clientNotifications]);
  const hasAnyBinding = Object.keys(tuyaBindingByMiner).length > 0;
  const visibleTuyaDevices = (tuyaData?.devices ?? []).filter(
    (d) => !hideUnboundAutomats || !hasAnyBinding || deviceToMiner.has(d.id),
  );

  const reorderCard = (draggedId: string, targetId: string) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setMinerOrder((prev) => {
      const base = prev.length > 0 ? [...prev] : miners.map((m) => m.minerId);
      if (!base.includes(draggedId)) base.push(draggedId);
      if (!base.includes(targetId)) base.push(targetId);

      const from = base.indexOf(draggedId);
      const to = base.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return base;

      const [item] = base.splice(from, 1);
      base.splice(to, 0, item);
      return base;
    });
  };

  const reorderCardToIndex = (draggedId: string, targetIndex: number) => {
    if (!draggedId || !Number.isFinite(targetIndex)) return;
    setMinerOrder((prev) => {
      const base = prev.length > 0 ? [...prev] : miners.map((m) => m.minerId);
      if (!base.includes(draggedId)) base.push(draggedId);

      const from = base.indexOf(draggedId);
      if (from < 0) return base;

      const [item] = base.splice(from, 1);
      const safeIndex = Math.max(0, Math.min(base.length, Math.floor(targetIndex)));
      base.splice(safeIndex, 0, item);
      return base;
    });
  };

  const startAliasEdit = (minerId: string, current: string) => {
    setEditingAliasFor(minerId);
    setAliasDraft(current);
  };

  const saveAlias = (minerId: string) => {
    const trimmed = aliasDraft.trim();
    setMinerAliases((prev) => {
      const next = { ...prev };
      if (trimmed) {
        next[minerId] = trimmed;
      } else {
        delete next[minerId];
      }
      return next;
    });
    setEditingAliasFor(null);
    setAliasDraft("");
  };

  const cancelAliasEdit = () => {
    setEditingAliasFor(null);
    setAliasDraft("");
  };

  const formatRuntime = (seconds?: number) => {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
      return "-";
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    // Show seconds only before first full day of uptime.
    if (d === 0 && s > 0) parts.push(`${s}s`);
    return parts.length > 0 ? parts.join(" ") : "0s";
  };

  const formatLastSeen = (iso: string | null) => {
    if (!iso) return "-";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const now = new Date();
    const sameDay =
      now.getFullYear() === date.getFullYear() &&
      now.getMonth() === date.getMonth() &&
      now.getDate() === date.getDate();
    if (sameDay) {
      return date.toLocaleTimeString([], { hour12: false });
    }
    return date.toLocaleString();
  };

  const formatUpdatedAt = (iso?: string | null) => {
    if (!iso) return t(uiLang, "no_data");
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString([], { hour12: false });
  };

  const batteryStatusText = (deyeStation?.batteryStatus ?? "").toLowerCase();
  const batteryMode =
    batteryStatusText.includes("discharg")
      ? "discharging"
      : batteryStatusText.includes("charg")
        ? "charging"
        : batteryStatusText.includes("idle")
          ? "idle"
          : "unknown";
  const batteryModeLabel =
    batteryMode === "charging"
      ? t(uiLang, "charging")
      : batteryMode === "discharging"
        ? t(uiLang, "discharging")
        : batteryMode === "idle"
          ? t(uiLang, "idle")
          : deyeStation?.batteryStatus ?? "";
  const kwUnit = t(uiLang, "kw");
  const batteryColor =
    batteryMode === "charging"
      ? "#60a5fa"
      : batteryMode === "discharging"
        ? "#ef4444"
        : typeof deyeStation?.batterySoc === "number" && deyeStation.batterySoc >= 99
          ? "#60a5fa"
          : "#64748b";
  const batteryFill =
    typeof deyeStation?.batterySoc === "number"
      ? Math.max(6, Math.min(100, deyeStation.batterySoc))
      : 0;
  const onText = t(uiLang, "on");
  const offText = t(uiLang, "off");

  const setLanguage = (lang: UiLang) => {
    setUiLang(lang);
    writeUiLang(lang);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout
    }
    clearAuthState();
    router.replace("/auth");
  };

  return {
    authChecked,
    uiLang,
    setLanguage,
    loading,
    reloadPending,
    miners,
    openGeneralSettings,
    refreshAll,
    reloadConfig,
    logout,
    deyeStation,
    deyeLoading,
    deyeCollapsed,
    setDeyeCollapsed,
    batteryMode,
    batteryModeLabel,
    batteryColor,
    batteryFill,
    kwUnit,
    formatUpdatedAt,
    tuyaData,
    tuyaLoading,
    tuyaCollapsed,
    setTuyaCollapsed,
    hideUnboundAutomats,
    setHideUnboundAutomats,
    visibleTuyaDevices,
    deviceToMiner,
    tuyaBindingByMiner,
    pendingTuyaByDevice,
    orderedMiners,
    minerAliases,
    onText,
    offText,
    saveTuyaBinding,
    requestTuyaSwitchConfirm,
    minerOrder,
    minerGridRef,
    minerControlStates,
    pendingActionByMiner,
    deviceById,
    statusBadgesVertical,
    boardCountByMiner,
    editingAliasFor,
    aliasDraft,
    setAliasDraft,
    lowHashrateRestartGraceMs: LOW_HASHRATE_RESTART_GRACE_MS,
    formatRuntime,
    formatLastSeen,
    isHashrateReady,
    openMinerSettings,
    reorderCard,
    reorderCardToIndex,
    startAliasEdit,
    saveAlias,
    cancelAliasEdit,
    requestMinerCommandConfirm,
    unlockOverheatControl,
    notificationsCollapsed,
    setNotificationsCollapsed,
    groupedNotifications,
    visibleGroupedNotifications,
    localizeNotificationMessage,
    restartActionStateForNote,
    pendingConfirmAction,
    setPendingConfirmAction,
    runConfirmedAction,
    showGeneralSettings,
    setShowGeneralSettings,
    generalSettingsDraft,
    setGeneralSettingsDraft,
    generalSettingsSaving,
    saveGeneralSettings,
    activeMinerSettingsId,
    setActiveMinerSettingsId,
    minerSettingsDraft,
    setMinerSettingsDraft,
    minerSettingsSaving,
    saveMinerSettings,
  };
}
