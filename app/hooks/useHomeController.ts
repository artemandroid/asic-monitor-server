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

const REFRESH_MS = 5000;
const DEYE_REFRESH_MS = 60_000;
const TUYA_REFRESH_MS = 60_000;
const LOW_HASHRATE_RESTART_GRACE_MS = 10 * 60 * 1000;
const CONTROL_ACTION_LOCK_MS = 10 * 60 * 1000;
const NOTIFICATION_VISIBLE_COUNT_KEY = "mc_notification_visible_count";

type MinerControlPhase = "RESTARTING" | "SLEEPING" | "WAKING" | "WARMING_UP";
type MinerControlState = {
  phase: MinerControlPhase;
  since: number;
};

type GeneralSettings = {
  restartDelayMinutes: number;
  hashrateDeviationPercent: number;
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
  notificationVisibleCount: number;
};

type MinerSettingsPanel = {
  minerId: string;
  autoRestartEnabled: boolean;
  postRestartGraceMinutes: number;
  lowHashrateThresholdGh: number;
  autoPowerOnGridRestore: boolean;
  autoPowerOffGridLoss: boolean;
  autoPowerOffGenerationBelowKw: number | null;
  autoPowerOffBatteryBelowPercent: number | null;
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
    source: "flag" | "text" | "power" | "charging_fallback" | "none";
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
  };
  batterySoc: number | null;
  batteryStatus: string | null;
  batteryDischargePowerKw: number | null;
  generationPowerKw: number | null;
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
        const data = (await res.json()) as { notificationVisibleCount?: number };
        if (typeof data.notificationVisibleCount === "number" && data.notificationVisibleCount >= 1) {
          setNotificationVisibleCount(Math.floor(data.notificationVisibleCount));
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
    online?: boolean;
  } | null): boolean => {
    if (!metric) return false;
    if (metric.online === false) return true;
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
    return realtimeMh <= metric.expectedHashrate * 0.05;
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
          if (online && !ready) {
            next[miner.minerId] = { phase: "WARMING_UP", since: current.since };
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
          if (online && !ready) {
            next[miner.minerId] = { phase: "WARMING_UP", since: current.since };
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
        },
        batterySoc: prev?.batterySoc ?? null,
        batteryStatus: prev?.batteryStatus ?? null,
        batteryDischargePowerKw: prev?.batteryDischargePowerKw ?? null,
        generationPowerKw: prev?.generationPowerKw ?? null,
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
        restartDelayMinutes: number;
        hashrateDeviationPercent: number;
        notifyAutoRestart: boolean;
        notifyRestartPrompt: boolean;
        notificationVisibleCount?: number;
      };
      setGeneralSettingsDraft({
        restartDelayMinutes: data.restartDelayMinutes,
        hashrateDeviationPercent: data.hashrateDeviationPercent,
        notifyAutoRestart: data.notifyAutoRestart,
        notifyRestartPrompt: data.notifyRestartPrompt,
        notificationVisibleCount:
          typeof data.notificationVisibleCount === "number"
            ? data.notificationVisibleCount
            : notificationVisibleCount,
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
      const updated = (await res.json().catch(() => ({}))) as { notificationVisibleCount?: number };
      const savedCount =
        typeof updated.notificationVisibleCount === "number"
          ? updated.notificationVisibleCount
          : generalSettingsDraft.notificationVisibleCount;
      setNotificationVisibleCount(Math.max(1, Math.floor(savedCount)));
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
            autoPowerOffBatteryBelowPercent: minerSettingsDraft.autoPowerOffBatteryBelowPercent,
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
      await fetchMiners();
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
        throw new Error(`Failed to create command: ${res.status}`);
      }
      if (type === "RESTART" || type === "SLEEP" || type === "WAKE") {
        const phase: MinerControlPhase =
          type === "RESTART" ? "RESTARTING" : type === "SLEEP" ? "SLEEPING" : "WAKING";
        setMinerControlStates((prev) => ({
          ...prev,
          [minerId]: { phase, since: Date.now() },
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
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchDeyeStationRef.current();
    const id = setInterval(() => {
      void fetchDeyeStationRef.current();
    }, DEYE_REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchTuyaDevicesRef.current();
    const id = setInterval(() => {
      void fetchTuyaDevicesRef.current();
    }, TUYA_REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked]);

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
    if (uiLang !== "uk") return message;
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
  const hasAnyBinding = Object.keys(tuyaBindingByMiner).length > 0;
  const visibleTuyaDevices = (tuyaData?.devices ?? []).filter(
    (d) => !hideUnboundAutomats || !hasAnyBinding || deviceToMiner.has(d.id),
  );

  const moveCardToTop = (cardId: string) => {
    setMinerOrder((prev) => {
      const base =
        prev.length > 0
          ? [...prev]
          : [...miners.map((m) => m.minerId)];
      const idx = base.indexOf(cardId);
      if (idx < 0 || idx === 0) return base;
      const [item] = base.splice(idx, 1);
      base.unshift(item);
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
      ? "#16a34a"
      : batteryMode === "discharging"
        ? "#f59e0b"
        : batteryMode === "idle"
          ? "#64748b"
          : "#94a3b8";
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
    editingAliasFor,
    aliasDraft,
    setAliasDraft,
    lowHashrateRestartGraceMs: LOW_HASHRATE_RESTART_GRACE_MS,
    formatRuntime,
    formatLastSeen,
    isHashrateReady,
    openMinerSettings,
    moveCardToTop,
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
