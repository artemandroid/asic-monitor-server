"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthState, getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, tr, type UiLang, writeUiLang } from "@/app/lib/ui-lang";
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

function ButtonSpinner({ color = "currentColor" }: { color?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

const icons = {
  dashboard: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 13a8 8 0 1 1 16 0v6a2 2 0 0 1-2 2H7a4 4 0 0 1-4-4v-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M9 13a3 3 0 0 1 6 0"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  ),
  bell: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 9a6 6 0 1 1 12 0c0 3 1 4 2 5H4c1-1 2-2 2-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 19a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  ),
  settings: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4 12a8 8 0 0 1 .2-1.8l-2-1.2 2-3.4 2.3.7a8.2 8.2 0 0 1 3-1.7l.4-2.4h4.2l.4 2.4a8.2 8.2 0 0 1 3 1.7l2.3-.7 2 3.4-2 1.2A8 8 0 0 1 20 12c0 .6-.1 1.2-.2 1.8l2 1.2-2 3.4-2.3-.7a8.2 8.2 0 0 1-3 1.7l-.4 2.4H9.9l-.4-2.4a8.2 8.2 0 0 1-3-1.7l-2.3.7-2-3.4 2-1.2A8 8 0 0 1 4 12Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  ),
  logout: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 12h10m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  refresh: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export default function Home() {
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
    void refreshMain();
    const id = setInterval(() => {
      void refreshMain();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchDeyeStation();
    const id = setInterval(() => {
      void fetchDeyeStation();
    }, DEYE_REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchTuyaDevices();
    const id = setInterval(() => {
      void fetchTuyaDevices();
    }, TUYA_REFRESH_MS);
    return () => clearInterval(id);
  }, [authChecked]);

  if (!authChecked) {
    return null;
  }

  type DisplayNotification = Notification & { count?: number };

  const groupKeyFor = (note: Notification) => {
    if (note.type === "CLIENT_ERROR") {
      return `${note.type}|${note.message}`;
    }
    return `${note.type}|${note.minerId ?? ""}|${note.action ?? ""}`;
  };

  const toggleGroupKey = (key: string) => {
    setGroupedKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
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
      return { enabled: false, title: "Command is already pending" };
    }

    const metric = (miner.lastMetric ?? null) as {
      online?: boolean;
      hashrateRealtime?: number;
      hashrate?: number;
    } | null;
    if (!metric || metric.online !== true) {
      return { enabled: false, title: "Miner is offline" };
    }

    const currentGh = toGh(metric.hashrateRealtime ?? metric.hashrate ?? null);
    const thresholdGh =
      typeof miner.lowHashrateThresholdGh === "number" ? miner.lowHashrateThresholdGh : null;
    if (currentGh === null || thresholdGh === null) {
      return { enabled: false, title: "No hashrate data" };
    }
    if (currentGh >= thresholdGh) {
      return { enabled: false, title: "Hashrate is normal now" };
    }

    if (miner.lastRestartAt) {
      const restartAtMs = new Date(miner.lastRestartAt).getTime();
      const graceMs = Math.max(miner.postRestartGraceMinutes ?? 10, 0) * 60 * 1000;
      if (Number.isFinite(restartAtMs) && Date.now() - restartAtMs < graceMs) {
        return { enabled: false, title: "Post-restart grace period is active" };
      }
    }

    return { enabled: true };
  };

  const localizeNotificationMessage = (message: string): string => {
    if (uiLang !== "uk") return message;
    const autoRestart = /^Hashrate on (.+) dropped to ([\d.]+) GH\/s\. Auto-restart issued\.$/.exec(message);
    if (autoRestart) {
      return `Хешрейт на ${autoRestart[1]} впав до ${autoRestart[2]} GH/s. Виконано авто-рестарт.`;
    }
    const restartPrompt =
      /^Hashrate on (.+) dropped to ([\d.]+) GH\/s\. Auto-restart is disabled\. Restart now\?$/.exec(
        message,
      );
    if (restartPrompt) {
      return `Хешрейт на ${restartPrompt[1]} впав до ${restartPrompt[2]} GH/s. Авто-рестарт вимкнено. Рестартувати зараз?`;
    }
    const overheat =
      /^Overheat lock on (.+): ([\d.]+)C >= ([\d.]+)C\. Manual Unlock control is required\.$/.exec(
        message,
      );
    if (overheat) {
      return `Перегрів-блок на ${overheat[1]}: ${overheat[2]}C >= ${overheat[3]}C. Потрібен ручний Unlock control.`;
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
    if (!iso) return tr(uiLang, "No data", "Немає даних");
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
      ? tr(uiLang, "Charging", "Заряджання")
      : batteryMode === "discharging"
        ? tr(uiLang, "Discharging", "Розряд")
        : batteryMode === "idle"
          ? tr(uiLang, "Idle", "Очікування")
          : deyeStation?.batteryStatus ?? "";
  const kwUnit = tr(uiLang, "kW", "кВт");
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
  const onText = tr(uiLang, "ON", "ВКЛ");
  const offText = tr(uiLang, "OFF", "ВИКЛ");

  return (
    <div style={{ padding: 16, fontFamily: "\"Space Grotesk\", \"Manrope\", \"IBM Plex Sans\", \"Segoe UI\", sans-serif" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid #d9e0ea",
          background: "#ffffff",
          boxShadow: "0 3px 10px rgba(9, 30, 66, 0.08)",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              height: 34,
              borderRadius: 10,
              background: "linear-gradient(135deg, #0b57d0 0%, #1565c0 100%)",
              color: "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 12px",
              fontWeight: 800,
              letterSpacing: 0.2,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            {tr(uiLang, "Mining Control", "Майнинг Контроль")}
          </div>
          <nav style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={openGeneralSettings}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 10,
                color: "#243142",
                background: "#f3f6fb",
                fontWeight: 600,
                fontSize: 13,
                border: "none",
                boxShadow: "inset 0 0 0 1px rgba(36,49,66,0.06)",
                cursor: "pointer",
              }}
            >
              {icons.settings} {tr(uiLang, "Settings", "Налаштування")}
            </button>
          </nav>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "inline-flex", gap: 6 }}>
            <button
              onClick={() => {
                setUiLang("en");
                writeUiLang("en");
              }}
              style={{
                height: 30,
                padding: "0 10px",
                borderRadius: 999,
                border: "1px solid #cbd5e1",
                background: uiLang === "en" ? "#dbeafe" : "#fff",
                color: uiLang === "en" ? "#1d4ed8" : "#334155",
                fontWeight: 700,
              }}
            >
              EN
            </button>
            <button
              onClick={() => {
                setUiLang("uk");
                writeUiLang("uk");
              }}
              style={{
                height: 30,
                padding: "0 10px",
                borderRadius: 999,
                border: "1px solid #cbd5e1",
                background: uiLang === "uk" ? "#dbeafe" : "#fff",
                color: uiLang === "uk" ? "#1d4ed8" : "#334155",
                fontWeight: 700,
              }}
            >
              UA
            </button>
          </div>
          <button
            onClick={() => {
              void refreshAll();
            }}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 999,
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#dbeafe",
              color: "#1e3a8a",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {icons.refresh}
            {tr(uiLang, "Refresh", "Оновити")}
          </button>
          <button
            onClick={reloadConfig}
            disabled={reloadPending || loading || miners.length === 0}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid #0b57d0",
              background: "#0b57d0",
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            {reloadPending ? tr(uiLang, "Reloading...", "Оновлення...") : tr(uiLang, "Reload config", "Оновити конфіг")}
          </button>
          <button
            onClick={async () => {
              try {
                await fetch("/api/auth/logout", { method: "POST" });
              } catch {
                // ignore network errors on logout
              }
              clearAuthState();
              router.replace("/auth");
            }}
            style={{
              height: 32,
              padding: "0 12px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 8,
              border: "1px solid #f0c5c5",
              background: "#fff5f5",
              color: "#9a3412",
              fontWeight: 700,
            }}
          >
            {icons.logout} {tr(uiLang, "Logout", "Вийти")}
          </button>
        </div>
      </header>
      <div
        style={{
          border: "1px solid #d6dce7",
          borderRadius: 10,
          background: "#ffffff",
          padding: "8px 10px",
          color: "#0f172a",
          marginBottom: 10,
          display: "grid",
          gap: 4,
        }}
      >
        <div
          onClick={() => setDeyeCollapsed((prev) => !prev)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {tr(uiLang, "Deye Station", "Deye Станція")} {deyeStation?.stationId ? `#${deyeStation.stationId}` : ""}
          </div>
          {deyeCollapsed ? (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                color: "#334155",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span style={{ fontWeight: 700, color: deyeStation?.gridOnline === true ? "#0f6b32" : "#b42318" }}>
                {deyeStation?.gridOnline === true ? tr(uiLang, "● Connected", "● Є мережа") : tr(uiLang, "✕ Disconnected", "✕ Немає мережі")}
              </span>
              {batteryModeLabel ? (
                <span style={{ marginLeft: 10, fontWeight: 700, color: "#0f172a" }}>
                  {batteryModeLabel}
                  {typeof deyeStation?.batteryDischargePowerKw === "number" &&
                  deyeStation.batteryDischargePowerKw > 0
                    ? ` ${deyeStation.batteryDischargePowerKw.toFixed(2)} ${kwUnit}`
                    : ""}
                </span>
              ) : null}
              <span style={{ marginLeft: 10, fontWeight: 700, color: "#334155", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: "relative",
                    width: 17,
                    height: 9,
                    borderRadius: 2,
                    border: `1.5px solid ${batteryColor}`,
                    display: "inline-flex",
                    alignItems: "center",
                    padding: 1,
                    boxSizing: "border-box",
                  }}
                >
                  <span
                    style={{
                      width: `${batteryFill}%`,
                      height: "100%",
                      borderRadius: 1,
                      background: batteryColor,
                      opacity: 0.95,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      right: -3,
                      top: 2,
                      width: 2,
                      height: 4,
                      borderRadius: 1,
                      background: batteryColor,
                    }}
                  />
                </span>
                {typeof deyeStation?.batterySoc === "number" ? `${deyeStation.batterySoc.toFixed(1)}%` : "-"}
              </span>
              {typeof deyeStation?.generationPowerKw === "number" && deyeStation.generationPowerKw > 0 ? (
                <span style={{ marginLeft: 10, fontWeight: 700, color: "#0f172a" }}>
                  {tr(uiLang, "Generation", "Генерація")} {deyeStation.generationPowerKw.toFixed(2)} {kwUnit}
                </span>
              ) : null}
            </div>
          ) : null}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                fontSize: 11,
                color: "#475569",
                minWidth: 180,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontFamily: "\"IBM Plex Mono\", \"SFMono-Regular\", Menlo, monospace",
              }}
            >
              {deyeLoading ? tr(uiLang, "Updating...", "Оновлення...") : `${tr(uiLang, "Updated", "Оновлено")}: ${formatUpdatedAt(deyeStation?.updatedAt)}`}
            </div>
            <span style={{ color: "#64748b", fontSize: 14, fontWeight: 700 }}>
              {deyeCollapsed ? "▸" : "▾"}
            </span>
          </div>
        </div>
        {!deyeCollapsed ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
            <div>
              <div style={{ color: "#64748b" }}>{tr(uiLang, "Grid", "Мережа")}</div>
              <div style={{ fontWeight: 700 }}>
                {deyeStation?.gridOnline === true
                  ? tr(uiLang, "Connected", "Є мережа")
                  : deyeStation?.gridOnline === false
                    ? tr(uiLang, "Disconnected", "Немає мережі")
                    : "✕"}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>{tr(uiLang, "Battery", "Батарея")}</div>
              <div style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: "relative",
                    width: 19,
                    height: 10,
                    borderRadius: 2,
                    border: `1.5px solid ${batteryColor}`,
                    display: "inline-flex",
                    alignItems: "center",
                    padding: 1,
                    boxSizing: "border-box",
                  }}
                  title={`Battery: ${batteryMode}`}
                >
                  <span
                    style={{
                      width: `${batteryFill}%`,
                      height: "100%",
                      borderRadius: 1,
                      background: batteryColor,
                      opacity: 0.95,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      right: -3,
                      top: 2,
                      width: 2,
                      height: 4,
                      borderRadius: 1,
                      background: batteryColor,
                    }}
                  />
                </span>
                {typeof deyeStation?.batterySoc === "number"
                  ? `${deyeStation.batterySoc.toFixed(1)}%`
                  : "-"}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>{tr(uiLang, "Battery Status / Power", "Стан батареї / Потужність")}</div>
              <div style={{ fontWeight: 700 }}>
                {batteryModeLabel || "-"}
                {typeof deyeStation?.batteryDischargePowerKw === "number"
                  ? ` · ${deyeStation.batteryDischargePowerKw.toFixed(2)} ${kwUnit}`
                  : ""}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>{tr(uiLang, "Generation", "Генерація")}</div>
              <div style={{ fontWeight: 700 }}>
                {typeof deyeStation?.generationPowerKw === "number"
                  ? `${deyeStation.generationPowerKw.toFixed(2)} ${kwUnit}`
                  : "-"}
              </div>
            </div>
          </div>
        ) : null}
        {deyeStation?.error ? (
          <div style={{ fontSize: 11, color: "#b42318" }}>{tr(uiLang, "Deye API error", "Помилка Deye API")}: {deyeStation.error}</div>
        ) : null}
      </div>
      <div
        style={{
          border: "1px solid #d6dce7",
          borderRadius: 10,
          background: "#ffffff",
          padding: "8px 10px",
          color: "#0f172a",
          marginBottom: 10,
          display: "grid",
          gap: 6,
        }}
      >
        <div
          onClick={() => setTuyaCollapsed((prev) => !prev)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {tr(uiLang, "SmartLife Automats", "SmartLife Автомати")} ({visibleTuyaDevices.length}/{tuyaData?.total ?? tuyaData?.devices.length ?? 0})
          </div>
          {tuyaCollapsed ? (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                fontSize: 10.5,
                color: "#334155",
                maskImage: "linear-gradient(to right, black 84%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to right, black 84%, transparent 100%)",
              }}
            >
              {visibleTuyaDevices.length === 0 ? (
                <span style={{ color: "#64748b" }}>{tr(uiLang, "No devices", "Немає пристроїв")}</span>
              ) : (
                visibleTuyaDevices.map((device, idx) => (
                  <span
                    key={`${device.id}-line`}
                    style={{
                      marginRight: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid #d7e1ec",
                      borderRadius: 999,
                      background: "#f8fafc",
                      padding: "1px 7px",
                    }}
                  >
                    <span>{device.name}</span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: device.on ? "#0f6b32" : "#9f1239",
                        border: "1px solid #d7e1ec",
                        borderRadius: 999,
                        padding: "0 5px",
                        background: "#ffffff",
                      }}
                    >
                      {device.on === null ? (device.online ? "?" : tr(uiLang, "OFFL", "ОФЛ")) : device.on ? onText : offText}
                    </span>
                    {idx < visibleTuyaDevices.length - 1 ? " ·" : ""}
                  </span>
                ))
              )}
            </div>
          ) : null}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                fontSize: 11,
                color: "#475569",
                minWidth: 180,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontFamily: "\"IBM Plex Mono\", \"SFMono-Regular\", Menlo, monospace",
              }}
            >
              {tuyaLoading
                ? tr(uiLang, "Updating...", "Оновлення...")
                : `${tr(uiLang, "Updated", "Оновлено")}: ${formatUpdatedAt(tuyaData?.updatedAt)}`}
            </div>
            <span style={{ color: "#64748b", fontSize: 14, fontWeight: 700 }}>
              {tuyaCollapsed ? "▸" : "▾"}
            </span>
          </div>
        </div>
        {!tuyaCollapsed ? (
          <>
            <div style={{ maxHeight: 210, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    <th style={{ textAlign: "left", padding: "4px 6px", whiteSpace: "nowrap" }}>{tr(uiLang, "Automat", "Автомат")}</th>
                    <th style={{ textAlign: "center", padding: "4px 6px", whiteSpace: "nowrap" }}>
                      {tr(uiLang, "St", "Статус")}
                    </th>
                    <th style={{ textAlign: "center", padding: "4px 6px", whiteSpace: "nowrap" }}>
                      {tr(uiLang, "Pwr", "Потужність")}
                    </th>
                    <th style={{ textAlign: "center", padding: "4px 6px", whiteSpace: "nowrap" }}>{tr(uiLang, "Bind ASIC", "Прив'язати ASIC")}</th>
                    <th style={{ textAlign: "center", padding: "4px 6px", whiteSpace: "nowrap" }}>{tr(uiLang, "Ctrl", "Кер.")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTuyaDevices.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "6px 8px", color: "#64748b" }}>
                        {tr(uiLang, "No devices yet.", "Ще немає пристроїв.")}
                      </td>
                    </tr>
                  ) : (
                    visibleTuyaDevices.map((device, idx) => {
                      const linkedMinerId = deviceToMiner.get(device.id) ?? "";
                      const pending = pendingTuyaByDevice[device.id];
                      const onDisabled = !device.online || pending === "ON" || device.on === true;
                      const offDisabled = !device.online || pending === "OFF" || device.on === false;
                      return (
                        <tr key={device.id} style={{ background: idx % 2 ? "#fff" : "#fcfdff" }}>
                          <td style={{ padding: "4px 6px", minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                              {device.name}
                            </div>
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: device.online ? "#0f6b32" : "#b42318" }}>
                            {device.on === null ? (device.online ? "?" : tr(uiLang, "OFFL", "ОФЛ")) : device.on ? onText : offText}
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700 }}>
                            {typeof device.powerW === "number" ? `${device.powerW.toFixed(0)}W` : "-"}
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "center" }}>
                            <select
                              value={linkedMinerId}
                              onChange={(e) => {
                                const targetMiner = e.target.value || null;
                                const oldMinerId =
                                  Object.entries(tuyaBindingByMiner).find(([, devId]) => devId === device.id)?.[0] ??
                                  null;
                                if (oldMinerId && oldMinerId !== targetMiner) {
                                  void saveTuyaBinding(oldMinerId, null);
                                }
                                if (targetMiner) {
                                  void saveTuyaBinding(targetMiner, device.id);
                                }
                              }}
                              style={{
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid #d5deea",
                                fontSize: 10,
                                maxWidth: 132,
                                background: "#fff",
                              }}
                            >
                              <option value="">-</option>
                              {orderedMiners.map((m) => (
                                <option key={`${device.id}-miner-${m.minerId}`} value={m.minerId}>
                                  {(minerAliases[m.minerId]?.trim() || m.minerId).slice(0, 24)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", gap: 4 }}>
                              <button
                                onClick={() => void requestTuyaSwitchConfirm(device, true)}
                                disabled={onDisabled}
                                style={{
                                  height: 20,
                                  minWidth: 30,
                                  borderRadius: 999,
                                  border: onDisabled ? "1px solid #dbe4ee" : "1px solid #b9ddc2",
                                  background: onDisabled ? "#f1f5f9" : "#e8f7ec",
                                  color: onDisabled ? "#94a3b8" : "#0f6b32",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: onDisabled ? "not-allowed" : "pointer",
                                  opacity: onDisabled ? 0.75 : 1,
                                }}
                                title={device.switchCode ? `Code: ${device.switchCode}` : "No switch code"}
                              >
                                {pending === "ON" ? "..." : onText}
                              </button>
                              <button
                                onClick={() => void requestTuyaSwitchConfirm(device, false)}
                                disabled={offDisabled}
                                style={{
                                  height: 20,
                                  minWidth: 30,
                                  borderRadius: 999,
                                  border: offDisabled ? "1px solid #dbe4ee" : "1px solid #e8c7c7",
                                  background: offDisabled ? "#f1f5f9" : "#fff1f2",
                                  color: offDisabled ? "#94a3b8" : "#9f1239",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: offDisabled ? "not-allowed" : "pointer",
                                  opacity: offDisabled ? 0.75 : 1,
                                }}
                                title={device.switchCode ? `Code: ${device.switchCode}` : "No switch code"}
                              >
                                {pending === "OFF" ? "..." : offText}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <label style={{ fontSize: 11, color: "#475569", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={hideUnboundAutomats}
                  onChange={(e) => setHideUnboundAutomats(e.target.checked)}
                />
                {tr(uiLang, "Hide unbinded automats", "Сховати неприв'язані автомати")}
              </label>
            </div>
          </>
        ) : null}
        {tuyaData?.error ? (
          <div style={{ fontSize: 11, color: "#b42318" }}>Tuya API error: {tuyaData.error}</div>
        ) : null}
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 10, color: "#1f2937" }}>
        {miners.length === 0 && (
          <p>{tr(uiLang, "No miners yet. Start the agent and wait for sync.", "Ще немає майнерів. Запусти агент і зачекай синхронізацію.")}</p>
        )}

        <div
          ref={minerGridRef}
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          }}
        >
          {(() => {
            const orderedCards = [...orderedMiners.map((m) => m.minerId)].sort(
              (a, b) => {
                const ai = minerOrder.indexOf(a);
                const bi = minerOrder.indexOf(b);
                const av = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
                const bv = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
                return av - bv;
              },
            );
            return orderedCards.map((cardId) => {
              const miner = orderedMiners.find((m) => m.minerId === cardId);
              if (!miner) return null;
              const idx = orderedCards.indexOf(cardId);
              const metric = miner.lastMetric as
                | {
                    online?: boolean;
                    ip?: string;
                    asicType?: string;
                    firmware?: string;
                    authType?: string;
                    readStatus?: string;
                    error?: string;
                    hashrate?: number;
                    temp?: number;
                    fan?: number;
                    fanSpeeds?: number[];
                    boardTemps?: number[];
                    boardInletTemps?: number[];
                    boardOutletTemps?: number[];
                    boardHashrates?: number[];
                    boardTheoreticalHashrates?: number[];
                    boardFreqs?: number[];
                    boardHwErrors?: number[];
                    boardChips?: number[];
                    boardStates?: string[];
                    statesOk?: boolean;
                    hashrateRealtime?: number;
                    hashrateAverage?: number;
                    runtimeSeconds?: number;
                    poolRejectionRate?: number;
                    expectedHashrate?: number;
                  }
                | null;

              const online = metric?.online;
              const statusLabel =
                online === true
                  ? tr(uiLang, "ONLINE", "ОНЛАЙН")
                  : online === false
                    ? tr(uiLang, "OFFLINE", "ОФЛАЙН")
                    : tr(uiLang, "UNKNOWN", "НЕВІДОМО");
              const statusColor =
                online === true ? "#0b7a00" : online === false ? "#b00020" : "#666";
              const control = minerControlStates[miner.minerId];
              const nowMs = Date.now();
              const controlAgeSec = control ? Math.max(0, Math.floor((nowMs - control.since) / 1000)) : 0;
              const controlAgeMin = Math.floor(controlAgeSec / 60);
              const controlAgeRemSec = controlAgeSec % 60;
              const restartAtMs = miner.lastRestartAt ? new Date(miner.lastRestartAt).getTime() : NaN;
              const serverPendingPhase: MinerControlPhase | null =
                miner.pendingCommandType === "RESTART"
                  ? "RESTARTING"
                  : miner.pendingCommandType === "SLEEP"
                    ? "SLEEPING"
                    : miner.pendingCommandType === "WAKE"
                      ? "WAKING"
                      : null;
              const hasServerWarmup =
                Number.isFinite(restartAtMs) &&
                nowMs - restartAtMs < LOW_HASHRATE_RESTART_GRACE_MS &&
                online === true &&
                !isHashrateReady(metric ?? null);
              const effectivePhase: MinerControlPhase | null =
                control?.phase ?? serverPendingPhase ?? (hasServerWarmup ? "WARMING_UP" : null);
              const overheatLocked = miner.overheatLocked === true;
              const controlText =
                overheatLocked
                  ? tr(uiLang, "Overheat lock active", "Активний перегрів-блок")
                  : effectivePhase === "RESTARTING"
                  ? tr(uiLang, "Restarting...", "Рестарт...")
                  : effectivePhase === "SLEEPING"
                    ? tr(uiLang, "Sleeping...", "Сон...")
                    : effectivePhase === "WAKING"
                      ? tr(uiLang, "Waking...", "Пробудження...")
                      : effectivePhase === "WARMING_UP"
                        ? tr(uiLang, "Warm-up after restart/wake...", "Розгін після рестарту/пробудження...")
                        : null;
              const controlColor =
                overheatLocked
                  ? "#b42318"
                  : effectivePhase === "SLEEPING"
                  ? "#4b5563"
                  : effectivePhase
                    ? "#b45309"
                    : "#374151";
              const buttonsLocked =
                effectivePhase === "RESTARTING" ||
                effectivePhase === "WAKING" ||
                effectivePhase === "WARMING_UP";
              const pendingAction = pendingActionByMiner[miner.minerId];
              const hasPendingAction = Boolean(pendingAction);
              const restartDisabled = hasPendingAction || buttonsLocked || effectivePhase === "SLEEPING";
              const sleepDisabled = hasPendingAction || buttonsLocked || effectivePhase === "SLEEPING";
              const wakeDisabled = hasPendingAction || buttonsLocked || overheatLocked;
              const restartLockedByOverheat = overheatLocked;
              const restartDisabledFinal = restartDisabled || restartLockedByOverheat;
              const restartInProgress =
                pendingAction === "RESTART" ||
                effectivePhase === "RESTARTING" ||
                effectivePhase === "WARMING_UP";
              const alias = minerAliases[miner.minerId]?.trim();
              const titleText = alias || `${metric?.asicType ?? "Antminer"} ${miner.minerId}`;
              const linkedDevice = deviceById.get(tuyaBindingByMiner[miner.minerId] ?? "");
              const chips = metric?.boardChips ?? [];
              const hwErrors = metric?.boardHwErrors ?? [];
              const freqs = metric?.boardFreqs ?? [];
              const realRates = metric?.boardHashrates ?? [];
              const idealRates = metric?.boardTheoreticalHashrates ?? [];
              const inletTemps = metric?.boardInletTemps ?? [];
              const outletTemps = metric?.boardOutletTemps ?? [];
              const fanSpeeds = metric?.fanSpeeds ?? [];
              const stateMap = new Map<number, string>();
              for (const state of metric?.boardStates ?? []) {
                const m = /^chain(\d+):(.*)$/i.exec(state);
                if (!m) continue;
                stateMap.set(Number.parseInt(m[1], 10), m[2].trim());
              }
              const boardCount = Math.max(
                chips.length,
                hwErrors.length,
                freqs.length,
                realRates.length,
                idealRates.length,
                inletTemps.length,
                outletTemps.length,
                stateMap.size,
                1,
              );
              const rows = Array.from({ length: boardCount }, (_, i) => ({
                board: i + 1,
                chips: chips[i] ?? "-",
                hw: hwErrors[i] ?? "-",
                freq: freqs[i] ?? "-",
                real: realRates[i] ?? "-",
                ideal: idealRates[i] ?? "-",
                inlet: inletTemps[i] ?? "-",
                outlet: outletTemps[i] ?? "-",
                state: stateMap.get(i) ?? "-",
              }));
              const totalHashrateGh =
                typeof metric?.hashrate === "number" ? (metric.hashrate / 1000).toFixed(2) : "-";
              const realtimeGh =
                metric?.hashrateRealtime ?? metric?.hashrate
                  ? (
                      metric?.hashrateRealtime ??
                      (metric?.hashrate ?? 0) / 1000
                    ).toFixed(2)
                  : "-";
              const averageGh =
                metric?.hashrateAverage ?? metric?.hashrate
                  ? (
                      metric?.hashrateAverage ??
                      (metric?.hashrate ?? 0) / 1000
                    ).toFixed(2)
                  : "-";
              const expectedMh = metric?.expectedHashrate;
              const currentMh = metric?.hashrate;
              const networkNormal =
                online === true &&
                (metric?.boardStates?.some((s) => s.toLowerCase().includes("network:ok")) ??
                  true);
              const fanNormal = (metric?.fan ?? 0) > 1000;
              const tempNormal = (metric?.temp ?? 0) > 0 && (metric?.temp ?? 0) < 80;
              const hashrateNormal =
                typeof expectedMh === "number" && expectedMh > 0 && typeof currentMh === "number"
                  ? currentMh >= expectedMh * 0.9
                  : true;
              return (
                <div
                  key={miner.minerId}
                  style={{
                    border: "1px solid #d6dce7",
                    background: "#ffffff",
                    borderRadius: 8,
                    padding: 10,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      display: "grid",
                      gap: 4,
                      justifyItems: "end",
                      width: "max-content",
                    }}
                  >
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => openMinerSettings(miner.minerId)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 22,
                          borderRadius: 999,
                          border: "1px solid #bfdbfe",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: 13,
                          lineHeight: "20px",
                          fontWeight: 700,
                        }}
                        aria-label={`Open settings for ${miner.minerId}`}
                        title="Miner settings"
                      >
                        {icons.settings}
                      </button>
                      <button
                        onClick={() => moveCardToTop(miner.minerId)}
                        style={{
                          height: 22,
                          minWidth: 46,
                          padding: "0 7px",
                          borderRadius: 999,
                          border: "1px solid #bfdbfe",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: 11,
                          lineHeight: "20px",
                          fontWeight: 700,
                        }}
                        aria-label={`Move ${miner.minerId} to top`}
                        title="Move to top"
                      >
                        {tr(uiLang, "To top", "Вгору")}
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                      gap: 8,
                      paddingRight: 142,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        minWidth: 0,
                        flexWrap: "wrap",
                      }}
                    >
                      {editingAliasFor === miner.minerId ? (
                        <>
                          <input
                            value={aliasDraft}
                            onChange={(e) => setAliasDraft(e.target.value)}
                            placeholder={`${metric?.asicType ?? "Antminer"} ${miner.minerId}`}
                            style={{
                              height: 26,
                              minWidth: 220,
                              borderRadius: 6,
                              border: "1px solid #cbd5e1",
                              padding: "0 8px",
                              fontSize: 12,
                            }}
                          />
                          <button
                            onClick={() => saveAlias(miner.minerId)}
                            style={{
                              height: 26,
                              padding: "0 8px",
                              borderRadius: 6,
                              border: "1px solid #bbf7d0",
                              background: "#f0fdf4",
                              color: "#166534",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingAliasFor(null);
                              setAliasDraft("");
                            }}
                            style={{
                              height: 26,
                              padding: "0 8px",
                              borderRadius: 6,
                              border: "1px solid #e5e7eb",
                              background: "#fff",
                              color: "#374151",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <div style={{ minWidth: 0, maxWidth: 360 }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "100%" }}>
                              <div
                                style={{
                                  fontSize: 15,
                                  fontWeight: 700,
                                  color: "#111827",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: "100%",
                                }}
                                title={titleText}
                              >
                                {titleText}
                              </div>
                              <button
                                onClick={() => startAliasEdit(miner.minerId, alias || "")}
                                style={{
                                  height: 22,
                                  width: 24,
                                  padding: 0,
                                  borderRadius: 9999,
                                  border: "1px solid #dbe2ee",
                                  background: "#f8fafc",
                                  color: "#334155",
                                  fontSize: 14,
                                  fontWeight: 700,
                                  flex: "0 0 auto",
                                }}
                                aria-label={`Rename ${miner.minerId}`}
                                title="Rename"
                              >
                                ✎
                              </button>
                            </div>
                            {linkedDevice ? (
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 10.5,
                                  color: "#475569",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: 340,
                                }}
                                title={`Linked automat: ${linkedDevice.name}`}
                              >
                                {tr(uiLang, "Automat", "Автомат")}: {linkedDevice.name}{" "}
                                <span style={{ fontWeight: 700, color: linkedDevice.on ? "#0f6b32" : "#9f1239" }}>
                                  [{linkedDevice.on === null ? "?" : linkedDevice.on ? onText : offText}]
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          textAlign: "right",
                          fontSize: 12,
                          color: "#374151",
                          lineHeight: 1.35,
                          maxWidth: 150,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: statusColor }}>{statusLabel}</div>
                        {controlText && (
                          <div style={{ color: controlColor, fontWeight: 700 }}>
                            {controlText} ({controlAgeMin}m {controlAgeRemSec}s)
                          </div>
                        )}
                        <div>{totalHashrateGh} GH/s</div>
                        {overheatLocked && (
                          <div style={{ color: "#b42318", fontWeight: 700 }}>
                            {tr(uiLang, "LOCKED", "ЗАБЛОК.")} ({typeof miner.overheatLastTempC === "number" ? `${miner.overheatLastTempC.toFixed(1)}C` : tr(uiLang, "overheat", "перегрів")})
                          </div>
                        )}
                        <div>{formatLastSeen(miner.lastSeen)}</div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    {[
                      { label: tr(uiLang, "Hashrate", "Хешрейт"), ok: hashrateNormal },
                      { label: tr(uiLang, "Network", "Мережа"), ok: networkNormal },
                      { label: tr(uiLang, "Fan", "Вент"), ok: fanNormal },
                      { label: tr(uiLang, "Temp", "Темп"), ok: tempNormal },
                    ].map((item) => (
                      <div
                        key={`${miner.minerId}-${item.label}`}
                        style={{
                          border: "1px solid #d8e0ea",
                          borderRadius: 999,
                          padding: "4px 8px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: item.ok ? "#2f7d32" : "#b42318",
                          textAlign: "center",
                          background: item.ok ? "#f2fbf2" : "#fff4f4",
                          whiteSpace: statusBadgesVertical ? "normal" : "nowrap",
                          lineHeight: 1.1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {statusBadgesVertical ? (
                          <span style={{ display: "inline-grid", gap: 1 }}>
                            <span>{item.label}:</span>
                            <span style={{ fontWeight: 700 }}>{item.ok ? "OK" : tr(uiLang, "WARN", "УВАГА")}</span>
                          </span>
                        ) : (
                          <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.label}: {item.ok ? "OK" : tr(uiLang, "WARN", "УВАГА")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid #d8e0ea",
                        borderRadius: 4,
                        padding: 6,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        rowGap: 6,
                        columnGap: 8,
                      }}
                    >
                      <div style={{ borderRight: "1px solid #e8edf5", paddingRight: 8 }}>
                        <div style={{ fontSize: 11, color: "#4b5563" }}>{tr(uiLang, "Real Time", "Поточний")}</div>
                        <div
                          style={{
                            fontSize: 20,
                            color: "#2f5fd0",
                            lineHeight: 1.05,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {realtimeGh}
                          <span style={{ fontSize: 12, marginLeft: 2 }}>GH/s</span>
                        </div>
                      </div>
                      <div style={{ paddingLeft: 2 }}>
                        <div style={{ fontSize: 11, color: "#4b5563" }}>{tr(uiLang, "Average", "Середній")}</div>
                        <div
                          style={{
                            fontSize: 20,
                            color: "#111827",
                            lineHeight: 1.05,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {averageGh}
                          <span style={{ fontSize: 12, marginLeft: 2 }}>GH/s</span>
                        </div>
                      </div>
                      <div style={{ borderRight: "1px solid #e8edf5", paddingRight: 8 }}>
                        <div style={{ fontSize: 11, color: "#4b5563" }}>{tr(uiLang, "Reject", "Відхилення")}</div>
                        <div
                          style={{
                            fontSize: 20,
                            color: "#2f7d32",
                            lineHeight: 1.05,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {typeof metric?.poolRejectionRate === "number"
                            ? `${metric.poolRejectionRate.toFixed(2)}%`
                            : "-"}
                        </div>
                      </div>
                      <div style={{ paddingLeft: 2 }}>
                        <div style={{ fontSize: 11, color: "#4b5563" }}>{tr(uiLang, "Uptime", "Аптайм")}</div>
                        <div
                          style={{
                            fontSize: 17,
                            color: "#111827",
                            lineHeight: 1.05,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatRuntime(metric?.runtimeSeconds)}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        border: "1px solid #d8e0ea",
                        borderRadius: 4,
                        padding: 6,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#1f2937", marginBottom: 5, fontWeight: 600 }}>
                        {tr(uiLang, "Chains` Rate", "Рейт ланцюгів")}
                      </div>
                      {realRates.length === 0 ? (
                        <div style={{ color: "#4f5560", fontSize: 12, paddingTop: 4 }}>
                          {tr(uiLang, "No data yet! Data is currently unavailable", "Поки що немає даних")}
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 4 }}>
                          {realRates.map((rate, i) => (
                            <div
                              key={`${miner.minerId}-chain-rate-${i}`}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "54px 1fr 66px",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 11,
                              }}
                            >
                              <div>{tr(uiLang, "Chain", "Ланцюг")} {i + 1}</div>
                              <div
                                style={{
                                  background: "#e8edf6",
                                  borderRadius: 999,
                                  height: 8,
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    width: `${Math.max(
                                      0,
                                      Math.min(
                                        100,
                                        ((Number(rate) || 0) /
                                          (Number(idealRates[i]) || Number(rate) || 1)) *
                                          100,
                                      ),
                                    )}%`,
                                    background: "#67bd62",
                                    height: "100%",
                                  }}
                                />
                              </div>
                              <div style={{ textAlign: "right", color: "#38562f" }}>
                                {typeof rate === "number" ? `${rate} GH/s` : "-"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ overflowX: "auto", marginTop: 4 }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 10,
                        tableLayout: "auto",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#e9eef5", color: "#111827" }}>
                          <th style={{ textAlign: "left", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "Bd", "Пл")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "Chip", "Чіпи")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>HW</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "Frq", "Част")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "Real", "Реал")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "Theo", "Теор")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "In", "Вх")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "Out", "Вих")}</th>
                          <th style={{ textAlign: "center", padding: "3px 3px", whiteSpace: "nowrap" }}>{tr(uiLang, "St", "Статус")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => (
                          <tr
                            key={`${miner.minerId}-board-${row.board}`}
                            style={{ background: idx % 2 === 0 ? "#f7faff" : "#fff" }}
                          >
                            <td style={{ padding: "2px 3px", whiteSpace: "nowrap" }}>{row.board}</td>
                            <td style={{ padding: "2px 3px", textAlign: "center", whiteSpace: "nowrap" }}>{row.chips}</td>
                            <td style={{ padding: "2px 3px", textAlign: "center", whiteSpace: "nowrap" }}>{row.hw}</td>
                            <td style={{ padding: "2px 3px", textAlign: "center", whiteSpace: "nowrap" }}>{row.freq}</td>
                            <td style={{ padding: "2px 3px", textAlign: "center", color: "#2f7d32", fontWeight: 700, whiteSpace: "nowrap" }}>
                              {typeof row.real === "number" ? `${row.real} GH/s` : row.real}
                            </td>
                            <td style={{ padding: "2px 3px", textAlign: "center", whiteSpace: "nowrap" }}>
                              {typeof row.ideal === "number" ? `${row.ideal} GH/s` : row.ideal}
                            </td>
                            <td style={{ padding: "2px 3px", textAlign: "center", whiteSpace: "nowrap" }}>{row.inlet}</td>
                            <td style={{ padding: "2px 3px", textAlign: "center", whiteSpace: "nowrap" }}>{row.outlet}</td>
                            <td
                              style={{
                                padding: "2px 3px",
                                textAlign: "center",
                                color:
                                  String(row.state).toUpperCase() === "OK"
                                    ? "#2f7d32"
                                    : "#4b5563",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {String(row.state).toUpperCase() === "OK" ? tr(uiLang, "Normal", "Норма") : row.state}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 6, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                      <thead>
                        <tr style={{ background: "#e9eef5", color: "#111827" }}>
                          <th style={{ textAlign: "left", padding: "5px 5px" }}>{tr(uiLang, "Fan", "Вентилятори")}</th>
                          {Array.from({ length: Math.max(fanSpeeds.length, 4) }, (_, i) => (
                            <th
                              key={`${miner.minerId}-fan-h-${i}`}
                              style={{ textAlign: "center", padding: "5px 5px" }}
                            >
                              F{i + 1}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ padding: "4px 5px" }}>{tr(uiLang, "rpm", "об/хв")}</td>
                          {Array.from({ length: Math.max(fanSpeeds.length, 4) }, (_, i) => (
                            <td
                              key={`${miner.minerId}-fan-v-${i}`}
                              style={{ padding: "4px 5px", textAlign: "center" }}
                            >
                              {fanSpeeds[i] ?? "-"}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => requestMinerCommandConfirm(miner.minerId, "RESTART")}
                        disabled={restartDisabledFinal}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          borderRadius: 999,
                          border: "1px solid #c7d7f8",
                          background: restartDisabledFinal ? "#edf2fa" : "#dbe8ff",
                          color: restartDisabledFinal ? "#94a3b8" : "#0b57d0",
                          fontWeight: 700,
                          fontSize: 12,
                          letterSpacing: 0.2,
                          cursor: restartDisabledFinal ? "not-allowed" : "pointer",
                        }}
                        title={overheatLocked ? "Overheat lock is active. Unlock control first." : undefined}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {restartInProgress ? (
                            <ButtonSpinner color={restartDisabledFinal ? "#94a3b8" : "#0b57d0"} />
                          ) : null}
                          {tr(uiLang, "Restart", "Рестарт")}
                        </span>
                      </button>
                      <button
                        onClick={() => requestMinerCommandConfirm(miner.minerId, "SLEEP")}
                        disabled={sleepDisabled}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          borderRadius: 999,
                          border: "1px solid #d9dbe0",
                          background: sleepDisabled ? "#f5f6f8" : "#f3f4f6",
                          color: sleepDisabled ? "#9ca3af" : "#3f4754",
                          fontWeight: 700,
                          fontSize: 12,
                          letterSpacing: 0.2,
                          cursor: sleepDisabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {pendingAction === "SLEEP" ? <ButtonSpinner color={sleepDisabled ? "#9ca3af" : "#3f4754"} /> : null}
                          {tr(uiLang, "Sleep", "Сон")}
                        </span>
                      </button>
                      <button
                        onClick={() => requestMinerCommandConfirm(miner.minerId, "WAKE")}
                        disabled={wakeDisabled}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          borderRadius: 999,
                          border: "1px solid #b8e0c2",
                          background: wakeDisabled ? "#ecf6ef" : "#d9f3e0",
                          color: wakeDisabled ? "#9ca3af" : "#0f6b32",
                          fontWeight: 700,
                          fontSize: 12,
                          letterSpacing: 0.2,
                          cursor: wakeDisabled ? "not-allowed" : "pointer",
                        }}
                        title={overheatLocked ? "Overheat lock is active. Unlock control first." : undefined}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {pendingAction === "WAKE" ? <ButtonSpinner color={wakeDisabled ? "#9ca3af" : "#0f6b32"} /> : null}
                          {tr(uiLang, "Wake", "Пробудити")}
                        </span>
                      </button>
                      {overheatLocked && (
                        <button
                          onClick={() => void unlockOverheatControl(miner.minerId)}
                          style={{
                            height: 30,
                            padding: "0 12px",
                            borderRadius: 999,
                            border: "1px solid #f3c6cc",
                            background: "#fff1f2",
                            color: "#9f1239",
                            fontWeight: 800,
                            fontSize: 12,
                            letterSpacing: 0.2,
                            cursor: "pointer",
                          }}
                          title="Acknowledge overheat and unlock manual controls"
                        >
                          Unlock control
                        </button>
                      )}
                    </div>
                    {metric?.error && (
                      <span
                        title={metric.error}
                        style={{
                          color: "#b42318",
                          fontSize: 12,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          cursor: "help",
                        }}
                      >
                        {tr(uiLang, "Error", "Помилка")}
                      </span>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
        <div
          style={{
            border: "1px solid #d6dce7",
            borderRadius: 8,
            background: "#ffffff",
            padding: "8px 10px",
          }}
        >
          <div
            onClick={() => setNotificationsCollapsed((prev) => !prev)}
            style={{
              fontWeight: 700,
              color: "#111827",
              marginBottom: notificationsCollapsed ? 0 : 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              {icons.bell} {tr(uiLang, "Notifications", "Сповіщення")} ({groupedNotifications.length})
            </span>
            <span style={{ fontWeight: 700, color: "#334155" }}>
              {notificationsCollapsed ? "▸" : "▾"}
            </span>
          </div>
          {!notificationsCollapsed && (
          <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 6 }}>
            {visibleGroupedNotifications.length === 0 && <div style={{ fontSize: 12 }}>{tr(uiLang, "No notifications.", "Немає сповіщень.")}</div>}
            {visibleGroupedNotifications.map((note) => (
              <div
                key={note.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: 12,
                  color: "#111827",
                }}
              >
                <div style={{ color: "#4b5563", fontSize: 11 }}>
                  {new Date(note.createdAt).toLocaleString()}
                  {note.count && note.count > 1 ? ` x${note.count}` : ""}
                </div>
                <div style={{ marginTop: 2 }}>{localizeNotificationMessage(note.message)}</div>
                {note.action === "RESTART" && note.minerId && (() => {
                  const restartAction = restartActionStateForNote(note);
                  return (
                    <button
                      style={{
                        marginTop: 6,
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border: restartAction.enabled ? "1px solid #bfdbfe" : "1px solid #d1d5db",
                        background: restartAction.enabled ? "#dbeafe" : "#f3f4f6",
                        color: restartAction.enabled ? "#1d4ed8" : "#9ca3af",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: restartAction.enabled ? "pointer" : "not-allowed",
                      }}
                      disabled={!restartAction.enabled}
                      title={restartAction.title}
                      onClick={() => requestMinerCommandConfirm(note.minerId!, "RESTART")}
                    >
                      {tr(uiLang, "Restart now", "Рестарт зараз")}
                    </button>
                  );
                })()}
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
      {pendingConfirmAction && (
        <div
          onClick={() => setPendingConfirmAction(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            backdropFilter: "blur(2px)",
            display: "grid",
            placeItems: "center",
            zIndex: 1300,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(420px, 92vw)",
              borderRadius: 12,
              border: "1px solid #d6dce7",
              background: "#fff",
              padding: 14,
              boxShadow: "0 20px 40px rgba(2, 6, 23, 0.2)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
              {tr(uiLang, "Confirm action", "Підтвердьте дію")}
            </div>
            <div style={{ marginTop: 8, color: "#111827", fontSize: 14, lineHeight: 1.4 }}>
              {pendingConfirmAction.kind === "MINER_COMMAND" ? (
                <>
                  {pendingConfirmAction.command === "RESTART" &&
                    tr(
                      uiLang,
                      `Restart miner ${pendingConfirmAction.minerId}?`,
                      `Перезапустити майнер ${pendingConfirmAction.minerId}?`,
                    )}
                  {pendingConfirmAction.command === "SLEEP" &&
                    tr(
                      uiLang,
                      `Put miner ${pendingConfirmAction.minerId} to sleep?`,
                      `Перевести майнер ${pendingConfirmAction.minerId} у сон?`,
                    )}
                  {pendingConfirmAction.command === "WAKE" &&
                    tr(
                      uiLang,
                      `Wake miner ${pendingConfirmAction.minerId}?`,
                      `Пробудити майнер ${pendingConfirmAction.minerId}?`,
                    )}
                </>
              ) : (
                tr(
                  uiLang,
                  `Turn ${pendingConfirmAction.on ? "ON" : "OFF"} automat "${pendingConfirmAction.device.name}"?`,
                  `${pendingConfirmAction.on ? "Увімкнути" : "Вимкнути"} автомат "${pendingConfirmAction.device.name}"?`,
                )
              )}
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setPendingConfirmAction(null)}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid #d7dee9",
                  background: "#fff",
                  color: "#334155",
                  fontWeight: 700,
                }}
              >
                {tr(uiLang, "Cancel", "Скасувати")}
              </button>
              <button
                onClick={() => void runConfirmedAction()}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid #0b57d0",
                  background: "#0b57d0",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                {tr(uiLang, "Confirm", "Підтвердити")}
              </button>
            </div>
          </div>
        </div>
      )}
      {showGeneralSettings && generalSettingsDraft && (
        <div
          onClick={() => {
            setShowGeneralSettings(false);
            setGeneralSettingsDraft(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            backdropFilter: "blur(2px)",
            display: "grid",
            placeItems: "center",
            zIndex: 1200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(640px, 92vw)",
              borderRadius: 12,
              border: "1px solid #d6dce7",
              background: "#fff",
              padding: 14,
              boxShadow: "0 20px 40px rgba(2, 6, 23, 0.2)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{tr(uiLang, "General Settings", "Загальні налаштування")}</div>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  {tr(uiLang, "Prompt Cooldown (minutes)", "Пауза між підказками (хв)")}
                </span>
                <input
                  type="number"
                  value={String(generalSettingsDraft.restartDelayMinutes)}
                  onChange={(e) =>
                    setGeneralSettingsDraft((prev) =>
                      prev
                        ? { ...prev, restartDelayMinutes: Number.parseInt(e.target.value || "0", 10) || 0 }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  {tr(uiLang, "Deviation (%) legacy", "Відхилення (%) legacy")}
                </span>
                <input
                  type="number"
                  value={String(generalSettingsDraft.hashrateDeviationPercent)}
                  onChange={(e) =>
                    setGeneralSettingsDraft((prev) =>
                      prev
                        ? { ...prev, hashrateDeviationPercent: Number.parseFloat(e.target.value || "0") || 0 }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={generalSettingsDraft.notifyAutoRestart}
                  onChange={(e) =>
                    setGeneralSettingsDraft((prev) =>
                      prev ? { ...prev, notifyAutoRestart: e.target.checked } : prev,
                    )
                  }
                />
                {tr(uiLang, "Notify auto-restart", "Сповіщати про авто-рестарт")}
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={generalSettingsDraft.notifyRestartPrompt}
                  onChange={(e) =>
                    setGeneralSettingsDraft((prev) =>
                      prev ? { ...prev, notifyRestartPrompt: e.target.checked } : prev,
                    )
                  }
                />
                {tr(uiLang, "Notify restart prompt", "Сповіщати з підказкою рестарту")}
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  {tr(uiLang, "Notifications visible on dashboard", "Кількість сповіщень на дашборді")}
                </span>
                <input
                  type="number"
                  min={1}
                  value={String(generalSettingsDraft.notificationVisibleCount)}
                  onChange={(e) =>
                    setGeneralSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            notificationVisibleCount:
                              Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                          }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowGeneralSettings(false);
                  setGeneralSettingsDraft(null);
                }}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid #d7dee9",
                  background: "#fff",
                  color: "#334155",
                  fontWeight: 700,
                }}
              >
                {tr(uiLang, "Cancel", "Скасувати")}
              </button>
              <button
                onClick={saveGeneralSettings}
                disabled={generalSettingsSaving}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid #0b57d0",
                  background: "#0b57d0",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                {generalSettingsSaving ? tr(uiLang, "Saving...", "Збереження...") : tr(uiLang, "Save", "Зберегти")}
              </button>
            </div>
          </div>
        </div>
      )}
      {activeMinerSettingsId && minerSettingsDraft && (
        <div
          onClick={() => {
            setActiveMinerSettingsId(null);
            setMinerSettingsDraft(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            backdropFilter: "blur(2px)",
            display: "grid",
            placeItems: "center",
            zIndex: 1200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(640px, 92vw)",
              borderRadius: 12,
              border: "1px solid #d6dce7",
              background: "#fff",
              padding: 14,
              boxShadow: "0 20px 40px rgba(2, 6, 23, 0.2)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: "#111827" }}>
              {tr(uiLang, "Miner Settings", "Налаштування майнера")}: {minerSettingsDraft.minerId}
            </div>
            <div style={{ display: "grid", gap: 8, color: "#000" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#111827", marginTop: 2 }}>
                {tr(uiLang, "Overheat Protection", "Захист від перегріву")}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#000" }}>
                <input
                  type="checkbox"
                  checked={minerSettingsDraft.overheatProtectionEnabled}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev ? { ...prev, overheatProtectionEnabled: e.target.checked } : prev,
                    )
                  }
                />
                {tr(uiLang, "Lock controls on overheat until manual unlock", "Блокувати керування при перегріві до ручного розблокування")}
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                  {tr(uiLang, "Overheat shutdown threshold (C)", "Поріг вимкнення при перегріві (C)")}
                </span>
                <input
                  type="number"
                  value={String(minerSettingsDraft.overheatShutdownTempC)}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev
                        ? { ...prev, overheatShutdownTempC: Number.parseFloat(e.target.value || "0") || 0 }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
                <div style={{ display: "inline-flex", gap: 6 }}>
                  {[84, 90, 95].map((preset) => (
                    <button
                      key={`overheat-preset-${preset}`}
                      type="button"
                      onClick={() =>
                        setMinerSettingsDraft((prev) =>
                          prev ? { ...prev, overheatShutdownTempC: preset } : prev,
                        )
                      }
                      style={{
                        height: 22,
                        padding: "0 8px",
                        borderRadius: 999,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        color: "#000",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {preset}C
                    </button>
                  ))}
                </div>
                {minerSettingsDraft.overheatLocked && (
                  <div style={{ color: "#b42318", fontSize: 12, fontWeight: 700 }}>
                    {tr(uiLang, "Overheat lock active", "Активний перегрів-блок")}
                    {typeof minerSettingsDraft.overheatLastTempC === "number"
                      ? ` (${minerSettingsDraft.overheatLastTempC.toFixed(1)}C)`
                      : ""}
                    {minerSettingsDraft.overheatLockedAt
                      ? ` ${tr(uiLang, "since", "з")} ${formatLastSeen(minerSettingsDraft.overheatLockedAt)}`
                      : ""}
                    .
                  </div>
                )}
              </label>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#111827", marginTop: 6 }}>
                {tr(uiLang, "Power / Grid / Battery", "Живлення / Мережа / Батарея")}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#000" }}>
                <input
                  type="checkbox"
                  checked={minerSettingsDraft.autoPowerOnGridRestore}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev ? { ...prev, autoPowerOnGridRestore: e.target.checked } : prev,
                    )
                  }
                />
                {tr(uiLang, "Turn ON bound automat when grid is back", "Увімкнути прив'язаний автомат коли мережа повернулась")}
              </label>
              <div style={{ fontSize: 11, color: "#000", marginTop: -4, marginLeft: 26 }}>
                {tr(uiLang, "Trigger: when Deye grid changes from OFF to ON.", "Тригер: коли мережа Deye змінюється з ВИКЛ на ВКЛ.")}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#000" }}>
                <input
                  type="checkbox"
                  checked={minerSettingsDraft.autoPowerOffGridLoss}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev ? { ...prev, autoPowerOffGridLoss: e.target.checked } : prev,
                    )
                  }
                />
                {tr(uiLang, "Turn OFF bound automat when grid is lost", "Вимкнути прив'язаний автомат коли мережа зникає")}
              </label>
              <div style={{ fontSize: 11, color: "#000", marginTop: -4, marginLeft: 26 }}>
                {tr(uiLang, "Trigger: when Deye grid changes from ON to OFF.", "Тригер: коли мережа Deye змінюється з ВКЛ на ВИКЛ.")}
              </div>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                  {tr(uiLang, "Auto OFF if generation below (kW)", "Авто ВИКЛ якщо генерація нижче (kW)")}
                </span>
                <input
                  type="number"
                  value={minerSettingsDraft.autoPowerOffGenerationBelowKw ?? ""}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            autoPowerOffGenerationBelowKw:
                              e.target.value === ""
                                ? null
                                : Number.parseFloat(e.target.value || "0") || 0,
                          }
                        : prev,
                    )
                  }
                  placeholder={tr(uiLang, "disabled", "вимкнено")}
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
                <div style={{ fontSize: 11, color: "#000" }}>
                  {tr(uiLang, "Hint: if both generation and battery thresholds are set, OFF triggers only when both are below limits.", "Підказка: якщо задані обидва пороги (генерація і батарея), ВИКЛ спрацює лише коли обидва нижче лімітів.")}
                </div>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  {[5, 10].map((preset) => (
                    <button
                      key={`gen-preset-${preset}`}
                      type="button"
                      onClick={() =>
                        setMinerSettingsDraft((prev) =>
                          prev ? { ...prev, autoPowerOffGenerationBelowKw: preset } : prev,
                        )
                      }
                      style={{
                        height: 22,
                        padding: "0 8px",
                        borderRadius: 999,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        color: "#000",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {preset} kW
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setMinerSettingsDraft((prev) =>
                        prev ? { ...prev, autoPowerOffGenerationBelowKw: null } : prev,
                      )
                    }
                    style={{
                      height: 22,
                      padding: "0 8px",
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#000",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {tr(uiLang, "Off", "Вимк")}
                  </button>
                </div>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                  {tr(uiLang, "Auto OFF if battery below (%)", "Авто ВИКЛ якщо батарея нижче (%)")}
                </span>
                <input
                  type="number"
                  value={minerSettingsDraft.autoPowerOffBatteryBelowPercent ?? ""}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            autoPowerOffBatteryBelowPercent:
                              e.target.value === ""
                                ? null
                                : Number.parseFloat(e.target.value || "0") || 0,
                          }
                        : prev,
                    )
                  }
                  placeholder={tr(uiLang, "disabled", "вимкнено")}
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
                <div style={{ fontSize: 11, color: "#000" }}>
                  {tr(uiLang, "Hint: if both generation and battery thresholds are set, OFF triggers only when both are below limits.", "Підказка: якщо задані обидва пороги (генерація і батарея), ВИКЛ спрацює лише коли обидва нижче лімітів.")}
                </div>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  {[80, 90].map((preset) => (
                    <button
                      key={`soc-preset-${preset}`}
                      type="button"
                      onClick={() =>
                        setMinerSettingsDraft((prev) =>
                          prev ? { ...prev, autoPowerOffBatteryBelowPercent: preset } : prev,
                        )
                      }
                      style={{
                        height: 22,
                        padding: "0 8px",
                        borderRadius: 999,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        color: "#000",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {preset}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setMinerSettingsDraft((prev) =>
                        prev ? { ...prev, autoPowerOffBatteryBelowPercent: null } : prev,
                      )
                    }
                    style={{
                      height: 22,
                      padding: "0 8px",
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#000",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {tr(uiLang, "Off", "Вимк")}
                  </button>
                </div>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                  {tr(uiLang, "Auto ON delay after conditions recover (minutes)", "Затримка авто ВКЛ після нормалізації умов (хв)")}
                </span>
                <input
                  type="number"
                  value={String(minerSettingsDraft.autoPowerRestoreDelayMinutes)}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            autoPowerRestoreDelayMinutes:
                              Number.parseInt(e.target.value || "0", 10) || 0,
                          }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
                <div style={{ fontSize: 11, color: "#000" }}>
                  {tr(uiLang, "Grid restore turns ON instantly (delay is ignored).", "При поверненні мережі вмикається одразу (затримка ігнорується).")}
                </div>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  {[0, 5, 10].map((preset) => (
                    <button
                      key={`delay-preset-${preset}`}
                      type="button"
                      onClick={() =>
                        setMinerSettingsDraft((prev) =>
                          prev ? { ...prev, autoPowerRestoreDelayMinutes: preset } : prev,
                        )
                      }
                      style={{
                        height: 22,
                        padding: "0 8px",
                        borderRadius: 999,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        color: "#000",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {preset === 0 ? tr(uiLang, "No delay", "Без затримки") : `${preset}${tr(uiLang, "m", "хв")}`}
                    </button>
                  ))}
                </div>
              </label>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#111827", marginTop: 6 }}>
                {tr(uiLang, "Hashrate / Auto-Restart", "Хешрейт / Авто-рестарт")}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#000" }}>
                <input
                  type="checkbox"
                  checked={minerSettingsDraft.autoRestartEnabled}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev ? { ...prev, autoRestartEnabled: e.target.checked } : prev,
                    )
                  }
                />
                {tr(uiLang, "Enable auto-restart for this miner", "Увімкнути авто-рестарт для цього майнера")}
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                  {tr(uiLang, "Low Hashrate Threshold (GH/s)", "Поріг низького хешрейту (GH/s)")}
                </span>
                <input
                  type="number"
                  value={String(minerSettingsDraft.lowHashrateThresholdGh)}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev
                        ? { ...prev, lowHashrateThresholdGh: Number.parseFloat(e.target.value || "0") || 0 }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                  {tr(uiLang, "Post-Restart Grace (minutes)", "Пауза після рестарту (хв)")}
                </span>
                <input
                  type="number"
                  value={String(minerSettingsDraft.postRestartGraceMinutes)}
                  onChange={(e) =>
                    setMinerSettingsDraft((prev) =>
                      prev
                        ? { ...prev, postRestartGraceMinutes: Number.parseInt(e.target.value || "0", 10) || 0 }
                        : prev,
                    )
                  }
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
              {typeof minerSettingsDraft.expectedHashrate === "number" && (
                <div style={{ fontSize: 12, color: "#000" }}>
                  {tr(uiLang, "Expected hashrate from config", "Очікуваний хешрейт з конфігу")}: {minerSettingsDraft.expectedHashrate}
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {minerSettingsDraft.overheatLocked && (
                <button
                  onClick={() => void unlockOverheatControl(minerSettingsDraft.minerId)}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: "1px solid #f3c6cc",
                    background: "#fff1f2",
                    color: "#9f1239",
                    fontWeight: 800,
                  }}
                >
                  {tr(uiLang, "Unlock control", "Розблокувати керування")}
                </button>
              )}
              <button
                onClick={() => {
                  setActiveMinerSettingsId(null);
                  setMinerSettingsDraft(null);
                }}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid #d7dee9",
                  background: "#fff",
                  color: "#334155",
                  fontWeight: 700,
                }}
              >
                {tr(uiLang, "Cancel", "Скасувати")}
              </button>
              <button
                onClick={saveMinerSettings}
                disabled={minerSettingsSaving}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid #0b57d0",
                  background: "#0b57d0",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                {minerSettingsSaving ? tr(uiLang, "Saving...", "Збереження...") : tr(uiLang, "Save", "Зберегти")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
