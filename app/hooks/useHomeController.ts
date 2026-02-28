"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthState, getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, t, type UiLang, writeUiLang } from "@/app/lib/ui-lang";
import { CommandType, MinerControlPhase, type Notification } from "@/app/lib/types";
import {
  CONTROL_ACTION_LOCK_MS,
  DEFAULT_DEYE_SYNC_MS,
  DEFAULT_MINER_SYNC_MS,
  DEFAULT_TUYA_SYNC_MS,
  FIXED_TUYA_SYNC_SEC,
  LOW_HASHRATE_RESTART_GRACE_MS,
} from "@/app/lib/constants";
import { useDeyeSync } from "@/app/hooks/useDeyeSync";
import { useMinerSync } from "@/app/hooks/useMinerSync";
import { useTuyaSync } from "@/app/hooks/useTuyaSync";
import {
  groupKeyFor,
  localizeNotificationMessage,
  restartActionStateForNote,
} from "@/app/lib/notification-utils";
import { formatLastSeen, formatRuntime, toGh } from "@/app/lib/format-utils";

const NOTIFICATION_VISIBLE_COUNT_KEY = "mc_notification_visible_count";
const BOARD_COUNT_BY_MINER_KEY = "mc_board_count_by_miner";
const EMPTY_DEVICE_IDS: string[] = [];

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
  autoPowerOnWhenGenerationCoversConsumption: boolean;
  autoPowerOnGenerationAboveKw?: number | null;
  autoPowerOffBatteryBelowPercent: number | null;
  autoPowerOnBatteryAbovePercent: number | null;
  autoPowerRestoreDelayMinutes: number;
  overheatProtectionEnabled: boolean;
  overheatShutdownTempC: number;
  overheatSleepMinutes: number;
  overheatLocked: boolean;
  overheatLockedAt: string | null;
  overheatLastTempC: number | null;
  expectedHashrate: number | null;
};

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

type PendingConfirmAction =
  | { kind: "MINER_COMMAND"; minerId: string; command: CommandType }
  | { kind: "TUYA_SWITCH"; device: TuyaDevice; on: boolean };

export function useHomeController() {
  const router = useRouter();
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ─── Auth ────────────────────────────────────────────────────────────────────

  const [authChecked, setAuthChecked] = useState(false);
  const [uiLang, setUiLang] = useState<UiLang>("en");

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
    if (!authChecked) return;
    const id = setInterval(() => {
      const state = getAuthState();
      if (!state) {
        router.replace("/auth");
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [authChecked, router]);

  // ─── Notifications ───────────────────────────────────────────────────────────

  const [clientNotifications, setClientNotifications] = useState<Notification[]>([]);

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
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

  // ─── Domain hooks ────────────────────────────────────────────────────────────

  const minerSync = useMinerSync({ pushNotification: pushClientNotification, playAlertBeep });
  const deyeSync = useDeyeSync(pushClientNotification);

  // Refs allow stable async callbacks across hooks without stale closures.
  const fetchMinersRef = useRef<() => Promise<void>>(minerSync.fetchMiners);
  fetchMinersRef.current = minerSync.fetchMiners;

  const tuyaBindingRef = useRef<Record<string, string>>(minerSync.tuyaBindingByMiner);
  tuyaBindingRef.current = minerSync.tuyaBindingByMiner;

  const tuyaSync = useTuyaSync({
    pushNotification: pushClientNotification,
    tuyaBindingRef,
    fetchMinersRef,
    setMinerControlStates: minerSync.setMinerControlStates,
  });

  // ─── Sync intervals ──────────────────────────────────────────────────────────

  const [minerSyncMs, setMinerSyncMs] = useState(DEFAULT_MINER_SYNC_MS);
  const [deyeSyncMs, setDeyeSyncMs] = useState(DEFAULT_DEYE_SYNC_MS);
  const [tuyaSyncMs, setTuyaSyncMs] = useState(DEFAULT_TUYA_SYNC_MS);

  const refreshMainRef = useRef<() => Promise<void>>(async () => {});
  const fetchDeyeStationRef = useRef<() => Promise<void>>(async () => {});
  const fetchTuyaDevicesRef = useRef<() => Promise<void>>(async () => {});

  const refreshMain = async () => {
    await Promise.all([minerSync.fetchMiners(), minerSync.fetchNotifications()]);
  };

  const refreshAll = async () => {
    await Promise.all([
      refreshMain(),
      deyeSync.fetchDeyeStation(),
      tuyaSync.fetchTuyaDevices(),
      deyeSync.fetchDeyeStationAutomats(),
    ]);
  };

  refreshMainRef.current = refreshMain;
  fetchDeyeStationRef.current = deyeSync.fetchDeyeStation;
  fetchTuyaDevicesRef.current = tuyaSync.fetchTuyaDevices;

  useEffect(() => {
    if (!authChecked) return;
    void refreshMainRef.current();
    const id = setInterval(() => void refreshMainRef.current(), minerSyncMs);
    return () => clearInterval(id);
  }, [authChecked, minerSyncMs]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchDeyeStationRef.current();
    const id = setInterval(() => void fetchDeyeStationRef.current(), deyeSyncMs);
    return () => clearInterval(id);
  }, [authChecked, deyeSyncMs]);

  useEffect(() => {
    if (!authChecked) return;
    void fetchTuyaDevicesRef.current();
    const id = setInterval(() => void fetchTuyaDevicesRef.current(), tuyaSyncMs);
    return () => clearInterval(id);
  }, [authChecked, tuyaSyncMs]);

  // ─── Server settings load ────────────────────────────────────────────────────

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
        };
        if (
          typeof data.notificationVisibleCount === "number" &&
          data.notificationVisibleCount >= 1
        ) {
          setNotificationVisibleCount(Math.floor(data.notificationVisibleCount));
        }
        if (typeof data.minerSyncIntervalSec === "number" && data.minerSyncIntervalSec >= 5) {
          setMinerSyncMs(Math.floor(data.minerSyncIntervalSec) * 1000);
        }
        if (typeof data.deyeSyncIntervalSec === "number" && data.deyeSyncIntervalSec >= 5) {
          setDeyeSyncMs(Math.floor(data.deyeSyncIntervalSec) * 1000);
        }
        setTuyaSyncMs(FIXED_TUYA_SYNC_SEC * 1000);
      } catch {
        // ignore — server settings unavailable, keep defaults
      }
    };
    void loadSettings();
  }, [authChecked]);

  // ─── Local persistence ───────────────────────────────────────────────────────

  const [groupNotifications, setGroupNotifications] = useState(false);
  const [groupedKeys, setGroupedKeys] = useState<string[]>([]);
  const [groupingLoaded, setGroupingLoaded] = useState(false);
  const [minerOrder, setMinerOrder] = useState<string[]>([]);
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [minerAliases, setMinerAliases] = useState<Record<string, string>>({});
  const [aliasesLoaded, setAliasesLoaded] = useState(false);
  const [controlStateLoaded, setControlStateLoaded] = useState(false);
  const [notificationVisibleCount, setNotificationVisibleCount] = useState(2);
  const [hideUnboundAutomats, setHideUnboundAutomats] = useState(false);
  const [hideUnboundLoaded, setHideUnboundLoaded] = useState(false);
  const [deyeCollapsed, setDeyeCollapsed] = useState(false);
  const [tuyaCollapsed, setTuyaCollapsed] = useState(false);
  const [notificationsCollapsed, setNotificationsCollapsed] = useState(false);
  const [sectionCollapseLoaded, setSectionCollapseLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_notification_grouping");
    if (!raw) { setGroupingLoaded(true); return; }
    try {
      const parsed = JSON.parse(raw) as { groupAll?: boolean; groupedKeys?: string[] };
      if (typeof parsed.groupAll === "boolean") setGroupNotifications(parsed.groupAll);
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
    if (!raw) { setOrderLoaded(true); return; }
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
    if (!raw) { setAliasesLoaded(true); return; }
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === "object") setMinerAliases(parsed);
    } catch {
      // ignore corrupted storage
    }
    setAliasesLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Ephemeral control phases are never persisted — avoid stale spinners after reload.
    window.localStorage.removeItem("mc_miner_control_states");
    setControlStateLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("mc_hide_unbound_automats") === "1") {
      setHideUnboundAutomats(true);
    }
    setHideUnboundLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mc_section_collapsed");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          deye?: boolean;
          tuya?: boolean;
          notifications?: boolean;
        };
        if (typeof parsed.deye === "boolean") setDeyeCollapsed(parsed.deye);
        if (typeof parsed.tuya === "boolean") setTuyaCollapsed(parsed.tuya);
        if (typeof parsed.notifications === "boolean")
          setNotificationsCollapsed(parsed.notifications);
      } catch {
        // ignore corrupted storage
      }
    }
    setSectionCollapseLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(NOTIFICATION_VISIBLE_COUNT_KEY);
    if (!raw) return;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) setNotificationVisibleCount(parsed);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(BOARD_COUNT_BY_MINER_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === "object") {
        const next: Record<string, number> = {};
        for (const [minerId, count] of Object.entries(parsed)) {
          const num = Number(count);
          if (Number.isFinite(num) && num > 0) next[minerId] = Math.floor(num);
        }
        minerSync.setBoardCountByMiner(next);
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !groupingLoaded) return;
    window.localStorage.setItem(
      "mc_notification_grouping",
      JSON.stringify({ groupAll: groupNotifications, groupedKeys }),
    );
  }, [groupNotifications, groupedKeys, groupingLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !orderLoaded) return;
    window.localStorage.setItem("mc_miner_order", JSON.stringify(minerOrder));
  }, [minerOrder, orderLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !aliasesLoaded) return;
    window.localStorage.setItem("mc_miner_aliases", JSON.stringify(minerAliases));
  }, [minerAliases, aliasesLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !controlStateLoaded) return;
    window.localStorage.removeItem("mc_miner_control_states");
  }, [minerSync.minerControlStates, controlStateLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !hideUnboundLoaded) return;
    window.localStorage.setItem("mc_hide_unbound_automats", hideUnboundAutomats ? "1" : "0");
  }, [hideUnboundAutomats, hideUnboundLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !sectionCollapseLoaded) return;
    window.localStorage.setItem(
      "mc_section_collapsed",
      JSON.stringify({ deye: deyeCollapsed, tuya: tuyaCollapsed, notifications: notificationsCollapsed }),
    );
  }, [deyeCollapsed, tuyaCollapsed, notificationsCollapsed, sectionCollapseLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      NOTIFICATION_VISIBLE_COUNT_KEY,
      String(Math.max(1, Math.floor(notificationVisibleCount))),
    );
  }, [notificationVisibleCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BOARD_COUNT_BY_MINER_KEY, JSON.stringify(minerSync.boardCountByMiner));
  }, [minerSync.boardCountByMiner]);

  // ─── Grid resize observer ────────────────────────────────────────────────────

  const minerGridRef = useRef<HTMLDivElement | null>(null);
  const [statusBadgesVertical, setStatusBadgesVertical] = useState(false);

  useEffect(() => {
    const grid = minerGridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setStatusBadgesVertical((width - 20) / 3 < 600);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  // Sync miner order with server list on miners change.
  useEffect(() => {
    setMinerOrder((prev) => {
      const next = [...prev];
      for (const m of minerSync.miners) {
        if (!next.includes(m.minerId)) next.push(m.minerId);
      }
      return next.filter((id) => minerSync.miners.some((m) => m.minerId === id));
    });
  }, [minerSync.miners]);

  // ─── Settings handlers ───────────────────────────────────────────────────────

  const [showGeneralSettings, setShowGeneralSettings] = useState(false);
  const [generalSettingsDraft, setGeneralSettingsDraft] = useState<GeneralSettings | null>(null);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [activeMinerSettingsId, setActiveMinerSettingsId] = useState<string | null>(null);
  const [minerSettingsDraft, setMinerSettingsDraft] = useState<MinerSettingsPanel | null>(null);
  const [minerSettingsSaving, setMinerSettingsSaving] = useState(false);

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
          typeof data.deyeSyncIntervalSec === "number" ? data.deyeSyncIntervalSec : 360,
        tuyaSyncIntervalSec: FIXED_TUYA_SYNC_SEC,
        restartDelayMinutes: data.restartDelayMinutes,
        hashrateDeviationPercent: data.hashrateDeviationPercent,
        notifyAutoRestart: data.notifyAutoRestart,
        notifyRestartPrompt: data.notifyRestartPrompt,
        notificationVisibleCount:
          typeof data.notificationVisibleCount === "number"
            ? data.notificationVisibleCount
            : notificationVisibleCount,
        criticalBatteryOffPercent:
          typeof data.criticalBatteryOffPercent === "number" ? data.criticalBatteryOffPercent : 30,
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
      setMinerSyncMs(Math.max(5, Math.floor(savedMinerSyncSec)) * 1000);
      setDeyeSyncMs(Math.max(5, Math.floor(savedDeyeSyncSec)) * 1000);
      setTuyaSyncMs(FIXED_TUYA_SYNC_SEC * 1000);
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
            : null,
        autoPowerOnWhenGenerationCoversConsumption:
          typeof data.autoPowerOnWhenGenerationCoversConsumption === "boolean"
            ? data.autoPowerOnWhenGenerationCoversConsumption
            : typeof data.autoPowerOnGenerationAboveKw === "number",
        autoPowerRestoreDelayMinutes:
          typeof data.autoPowerRestoreDelayMinutes === "number"
            ? data.autoPowerRestoreDelayMinutes
            : 10,
        overheatProtectionEnabled:
          typeof data.overheatProtectionEnabled === "boolean"
            ? data.overheatProtectionEnabled
            : true,
        overheatShutdownTempC:
          typeof data.overheatShutdownTempC === "number" ? data.overheatShutdownTempC : 83,
        overheatSleepMinutes:
          typeof data.overheatSleepMinutes === "number" ? data.overheatSleepMinutes : 30,
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
    const onThreshold = minerSettingsDraft.autoPowerOnBatteryAbovePercent;
    if (
      typeof offThreshold === "number" &&
      typeof onThreshold === "number" &&
      onThreshold < offThreshold + 5
    ) {
      pushClientNotification(
        "Auto ON battery threshold must be at least Auto OFF threshold + 5%.",
      );
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
            autoPowerOnWhenGenerationCoversConsumption:
              minerSettingsDraft.autoPowerOnWhenGenerationCoversConsumption,
            autoPowerOffBatteryBelowPercent: minerSettingsDraft.autoPowerOffBatteryBelowPercent,
            autoPowerOnBatteryAbovePercent: minerSettingsDraft.autoPowerOnBatteryAbovePercent,
            autoPowerRestoreDelayMinutes: minerSettingsDraft.autoPowerRestoreDelayMinutes,
            overheatProtectionEnabled: minerSettingsDraft.overheatProtectionEnabled,
            overheatShutdownTempC: minerSettingsDraft.overheatShutdownTempC,
            overheatSleepMinutes: minerSettingsDraft.overheatSleepMinutes,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to update miner settings: ${res.status}`);
      }
      setActiveMinerSettingsId(null);
      setMinerSettingsDraft(null);
      void minerSync.fetchMiners();
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
      await minerSync.fetchMiners();
      if (activeMinerSettingsId === minerId) {
        await openMinerSettings(minerId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    }
  };

  // ─── Tuya binding (cross-domain: tuya + deye) ────────────────────────────────

  const saveTuyaBinding = async (minerId: string, deviceId: string | null) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    const normalizedDeviceId =
      typeof deviceId === "string" && deviceId.trim().length > 0 ? deviceId.trim() : null;
    const stationKey =
      typeof deyeSync.deyeStation?.stationId === "number" &&
      Number.isFinite(deyeSync.deyeStation.stationId)
        ? String(Math.trunc(deyeSync.deyeStation.stationId))
        : null;
    const stationAutomatSet = stationKey
      ? new Set(deyeSync.deyeAutomatsByStation[stationKey] ?? [])
      : new Set<string>();
    const safeDeviceId = !normalizedDeviceId
      ? null
      : stationKey && deyeSync.deyeAutomatsLoaded
        ? stationAutomatSet.has(normalizedDeviceId)
          ? normalizedDeviceId
          : null
        : normalizedDeviceId;
    if (normalizedDeviceId && stationKey && deyeSync.deyeAutomatsLoaded && !safeDeviceId) {
      pushClientNotification("Automat is not bound to current Deye station.");
    }
    try {
      const res = await fetch("/api/miners/bindings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minerId, deviceId: safeDeviceId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to save binding: ${res.status}`);
      }
      minerSync.setTuyaBindingByMiner((prev) => {
        const next: Record<string, string> = {};
        for (const [id, dev] of Object.entries(prev)) {
          if (dev === safeDeviceId) continue;
          next[id] = dev;
        }
        if (safeDeviceId) next[minerId] = safeDeviceId;
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    }
  };

  // ─── Confirm action ──────────────────────────────────────────────────────────

  const [pendingConfirmAction, setPendingConfirmAction] = useState<PendingConfirmAction | null>(
    null,
  );

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
      await minerSync.createCommand(action.minerId, action.command);
      return;
    }
    await tuyaSync.setTuyaSwitch(action.device, action.on);
  };

  const reloadConfig = async () => {
    minerSync.setReloadPending(true);
    try {
      await minerSync.reloadConfig();
    } finally {
      minerSync.setReloadPending(false);
    }
  };

  // ─── Command result processing ────────────────────────────────────────────────

  const processedCommandResultIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const all = [...clientNotifications, ...minerSync.notifications];
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
      const createdAtMs = new Date(note.createdAt).getTime();
      if (!Number.isFinite(createdAtMs)) continue;
      // Ignore old results on reload to prevent stale spinners.
      if (now - createdAtMs > CONTROL_ACTION_LOCK_MS) continue;

      if (ok && sleepCmd) {
        minerSync.setMinerControlStates((prev) => ({
          ...prev,
          [note.minerId!]: { phase: MinerControlPhase.SLEEPING, since: createdAtMs },
        }));
        continue;
      }
      if (ok && wakeCmd) {
        minerSync.setMinerControlStates((prev) => ({
          ...prev,
          [note.minerId!]: { phase: MinerControlPhase.WARMING_UP, since: createdAtMs, source: "WAKE" },
        }));
        continue;
      }
      if (ok && restartCmd) {
        minerSync.setMinerControlStates((prev) => ({
          ...prev,
          [note.minerId!]: { phase: MinerControlPhase.WARMING_UP, since: createdAtMs, source: "RESTART" },
        }));
        continue;
      }
      if (failed && (sleepCmd || wakeCmd || restartCmd)) {
        minerSync.setMinerControlStates((prev) => {
          if (!prev[note.minerId!]) return prev;
          const next = { ...prev };
          delete next[note.minerId!];
          return next;
        });
      }
    }
  }, [minerSync.notifications, clientNotifications]);

  // ─── Deye/Tuya station binding cleanup ───────────────────────────────────────

  const { deyeStation, deyeAutomatsByStation, deyeAutomatsLoaded } = deyeSync;

  const hasCurrentDeyeStation =
    typeof deyeStation?.stationId === "number" && Number.isFinite(deyeStation.stationId);
  const currentDeyeStationAutomatIds = hasCurrentDeyeStation
    ? (deyeAutomatsByStation[String(Math.trunc(deyeStation.stationId))] ?? EMPTY_DEVICE_IDS)
    : EMPTY_DEVICE_IDS;
  const currentDeyeStationAutomatSet = new Set(currentDeyeStationAutomatIds);
  const shouldRestrictAutomatsByStation = deyeAutomatsLoaded && hasCurrentDeyeStation;

  useEffect(() => {
    if (!deyeAutomatsLoaded) return;
    if (typeof deyeStation?.stationId !== "number" || !Number.isFinite(deyeStation.stationId))
      return;
    const stationAutomatSet = new Set(currentDeyeStationAutomatIds);
    const invalidMinerIds = Object.entries(minerSync.tuyaBindingByMiner)
      .filter(([, deviceId]) => {
        const normalized = typeof deviceId === "string" ? deviceId.trim() : "";
        return normalized.length > 0 && !stationAutomatSet.has(normalized);
      })
      .map(([minerId]) => minerId);
    if (invalidMinerIds.length === 0) return;

    minerSync.setTuyaBindingByMiner((prev) => {
      const next: Record<string, string> = {};
      for (const [minerId, deviceId] of Object.entries(prev)) {
        const normalized = typeof deviceId === "string" ? deviceId.trim() : "";
        if (!normalized || !stationAutomatSet.has(normalized)) continue;
        next[minerId] = normalized;
      }
      return next;
    });

    if (!getAuthState()) return;
    const syncInvalidBindings = async () => {
      for (const minerId of invalidMinerIds) {
        try {
          const res = await fetch("/api/miners/bindings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ minerId, deviceId: null }),
          });
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            throw new Error(payload.error ?? `Failed to clear invalid binding: ${res.status}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          pushClientNotification(message);
        }
      }
    };
    void syncInvalidBindings();
  }, [deyeAutomatsLoaded, deyeStation?.stationId, currentDeyeStationAutomatIds, minerSync.tuyaBindingByMiner]);

  // ─── Display computed values ──────────────────────────────────────────────────

  type DisplayNotification = Notification & { count?: number };

  const visibleNotifications = [...clientNotifications, ...minerSync.notifications].sort(
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

  const deyeStationByDeviceId = Object.entries(deyeAutomatsByStation).reduce<Record<string, string>>(
    (acc, [stationId, deviceIds]) => {
      for (const deviceId of deviceIds) {
        if (!deviceId || typeof deviceId !== "string") continue;
        acc[deviceId] = stationId;
      }
      return acc;
    },
    {},
  );

  const stationTuyaDevices = shouldRestrictAutomatsByStation
    ? (tuyaSync.tuyaData?.devices ?? []).filter((d) => currentDeyeStationAutomatSet.has(d.id))
    : (tuyaSync.tuyaData?.devices ?? []);
  const deviceById = new Map(stationTuyaDevices.map((d) => [d.id, d]));
  const validTuyaBindingByMiner = shouldRestrictAutomatsByStation
    ? Object.entries(minerSync.tuyaBindingByMiner).reduce<Record<string, string>>(
        (acc, [minerId, deviceId]) => {
          const normalized = typeof deviceId === "string" ? deviceId.trim() : "";
          if (!normalized || !currentDeyeStationAutomatSet.has(normalized)) return acc;
          acc[minerId] = normalized;
          return acc;
        },
        {},
      )
    : minerSync.tuyaBindingByMiner;
  const deviceToMiner = new Map<string, string>();
  for (const [minerId, deviceId] of Object.entries(validTuyaBindingByMiner)) {
    if (deviceId) deviceToMiner.set(deviceId, minerId);
  }
  const hasAnyBinding = Object.keys(validTuyaBindingByMiner).length > 0;
  const visibleTuyaDevices = stationTuyaDevices.filter(
    (d) => !hideUnboundAutomats || !hasAnyBinding || deviceToMiner.has(d.id),
  );
  const automatsTodayConsumptionKwh = stationTuyaDevices.reduce((sum, device) => {
    const value = device.energyTodayKwh;
    return typeof value === "number" && Number.isFinite(value) ? sum + value : sum;
  }, 0);

  const minerById = new Map(minerSync.miners.map((m) => [m.minerId, m]));
  const orderedMiners = [...minerSync.miners].sort((a, b) => {
    const ai = minerOrder.indexOf(a.minerId);
    const bi = minerOrder.indexOf(b.minerId);
    const av = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
    const bv = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
    return av - bv;
  });

  const batteryStatusText = (deyeStation?.batteryStatus ?? "").toLowerCase();
  const batteryMode = batteryStatusText.includes("discharg")
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

  // ─── UI helpers ───────────────────────────────────────────────────────────────

  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");

  const formatUpdatedAt = (iso?: string | null) => {
    if (!iso) return t(uiLang, "no_data");
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString([], { hour12: false });
  };

  const reorderCard = (draggedId: string, targetId: string) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setMinerOrder((prev) => {
      const base = prev.length > 0 ? [...prev] : minerSync.miners.map((m) => m.minerId);
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
      const base = prev.length > 0 ? [...prev] : minerSync.miners.map((m) => m.minerId);
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

  // ─── Return ───────────────────────────────────────────────────────────────────

  return {
    authChecked,
    uiLang,
    setLanguage,
    loading: minerSync.loading,
    reloadPending: minerSync.reloadPending,
    miners: minerSync.miners,
    openGeneralSettings,
    refreshAll,
    reloadConfig,
    logout,
    deyeStation,
    deyeLoading: deyeSync.deyeLoading,
    deyeCollapsed,
    setDeyeCollapsed,
    currentDeyeStationAutomatIds,
    deyeStationByDeviceId,
    deyeAutomatsSaving: deyeSync.deyeAutomatsSaving,
    bindAutomatToCurrentDeyeStation: deyeSync.bindAutomatToCurrentDeyeStation,
    unbindAutomatFromCurrentDeyeStation: deyeSync.unbindAutomatFromCurrentDeyeStation,
    batteryMode,
    batteryModeLabel,
    batteryColor,
    batteryFill,
    kwUnit,
    formatUpdatedAt,
    tuyaData: tuyaSync.tuyaData,
    tuyaLoading: tuyaSync.tuyaLoading,
    tuyaCollapsed,
    setTuyaCollapsed,
    hideUnboundAutomats,
    setHideUnboundAutomats,
    visibleTuyaDevices,
    automatsTodayConsumptionKwh,
    deviceToMiner,
    tuyaBindingByMiner: minerSync.tuyaBindingByMiner,
    pendingTuyaByDevice: tuyaSync.pendingTuyaByDevice,
    orderedMiners,
    minerAliases,
    onText: t(uiLang, "on"),
    offText: t(uiLang, "off"),
    saveTuyaBinding,
    requestTuyaSwitchConfirm,
    minerOrder,
    minerGridRef,
    minerControlStates: minerSync.minerControlStates,
    pendingActionByMiner: minerSync.pendingActionByMiner,
    deviceById,
    statusBadgesVertical,
    boardCountByMiner: minerSync.boardCountByMiner,
    editingAliasFor,
    aliasDraft,
    setAliasDraft,
    lowHashrateRestartGraceMs: LOW_HASHRATE_RESTART_GRACE_MS,
    formatRuntime,
    formatLastSeen,
    toGh,
    isHashrateReady: minerSync.isHashrateReady,
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
    localizeNotificationMessage: (note: Notification) =>
      localizeNotificationMessage(uiLang, note),
    restartActionStateForNote: (note: Notification) =>
      restartActionStateForNote(note, minerById, minerSync.pendingActionByMiner, uiLang),
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
