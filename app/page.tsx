"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthState, getAuthState } from "@/app/lib/auth-client";
import type {
  CommandType,
  MinerState,
  Notification,
  Settings,
} from "@/app/lib/types";

const REFRESH_MS = 5000;

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
};

export default function Home() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [miners, setMiners] = useState<MinerState[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [clientNotifications, setClientNotifications] = useState<Notification[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [loading, setLoading] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [editingDelay, setEditingDelay] = useState(false);
  const [editingDeviation, setEditingDeviation] = useState(false);
  const [delayInput, setDelayInput] = useState("10");
  const [deviationInput, setDeviationInput] = useState("10");
  const [groupNotifications, setGroupNotifications] = useState(false);
  const [groupedKeys, setGroupedKeys] = useState<string[]>([]);
  const [groupingLoaded, setGroupingLoaded] = useState(false);

  useEffect(() => {
    const state = getAuthState();
    if (!state) {
      router.replace("/auth");
      return;
    }
    setAuthChecked(true);
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
    if (!groupingLoaded) return;
    const payload = JSON.stringify({
      groupAll: groupNotifications,
      groupedKeys,
    });
    window.localStorage.setItem("mc_notification_grouping", payload);
  }, [groupNotifications, groupedKeys, groupingLoaded]);

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
      setMiners(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) {
        throw new Error(`Failed to fetch settings: ${res.status}`);
      }
      const data = (await res.json()) as Settings;
      setSettings(data);
      setDelayInput(String(data.restartDelayMinutes));
      setDeviationInput(String(data.hashrateDeviationPercent));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
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
      pushClientNotification(message);
    }
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setSettingsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        throw new Error(`Failed to update settings: ${res.status}`);
      }
      const data = (await res.json()) as Settings;
      setSettings(data);
      setDelayInput(String(data.restartDelayMinutes));
      setDeviationInput(String(data.hashrateDeviationPercent));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const createCommand = async (minerId: string, type: CommandType) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch("/api/commands/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minerId, type }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create command: ${res.status}`);
      }
      await fetchMiners();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushClientNotification(message);
    }
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

  const saveDelay = async () => {
    const parsed = Number.parseInt(delayInput, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      pushClientNotification("Restart delay must be a non-negative number.");
      return;
    }
    await updateSettings({ restartDelayMinutes: parsed });
    setEditingDelay(false);
  };

  const saveDeviation = async () => {
    const parsed = Number.parseFloat(deviationInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      pushClientNotification("Deviation percent must be a non-negative number.");
      return;
    }
    await updateSettings({ hashrateDeviationPercent: parsed });
    setEditingDeviation(false);
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchMiners();
    fetchSettings();
    fetchNotifications();
    const id = setInterval(() => {
      fetchMiners();
      fetchNotifications();
    }, REFRESH_MS);
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

  const autoRestartEnabled = settings?.autoRestartEnabled ?? false;
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

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderRadius: 14,
          border: "1px solid #e3dfd4",
          background: "linear-gradient(135deg, #f8f3ea 0%, #f4f8f2 100%)",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: "#111827",
              color: "white",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
            }}
          >
            MC
          </div>
          <nav style={{ display: "flex", gap: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                background: "white",
                border: "1px solid #e3dfd4",
                fontWeight: 600,
              }}
            >
              {icons.dashboard} Dashboard
            </span>
            <Link
              href="/settings"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid transparent",
                color: "#374151",
                textDecoration: "none",
              }}
            >
              {icons.settings} Settings
            </Link>
          </nav>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            Refresh: {REFRESH_MS / 1000}s
          </div>
          <button onClick={fetchMiners} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={reloadConfig}
            disabled={reloadPending || loading || miners.length === 0}
          >
            {reloadPending ? "Reloading..." : "Reload config"}
          </button>
          <button
            onClick={() => {
              clearAuthState();
              router.replace("/auth");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {icons.logout} Logout
          </button>
        </div>
      </header>
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        }}
      >
        <div>
          <div
            style={{
              border: "1px solid #ddd",
              padding: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={autoRestartEnabled}
                onChange={(e) =>
                  updateSettings({ autoRestartEnabled: e.target.checked })
                }
                disabled={settingsSaving}
              />
              <span>Auto-restart enabled</span>
            </div>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gap: 8,
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
              }}
            >
              <label>Restart delay (minutes)</label>
              <input
                type="number"
                value={delayInput}
                onChange={(e) => setDelayInput(e.target.value)}
                disabled={!editingDelay || settingsSaving}
                style={{ width: 120 }}
              />
              {editingDelay ? (
                <button onClick={saveDelay} disabled={settingsSaving}>
                  Save
                </button>
              ) : (
                <button onClick={() => setEditingDelay(true)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path
                        d="M14.7 4.3a1 1 0 0 1 1.4 0l3.6 3.6a1 1 0 0 1 0 1.4l-9.9 9.9a1 1 0 0 1-.5.3l-4.5 1.1a1 1 0 0 1-1.2-1.2l1.1-4.5a1 1 0 0 1 .3-.5l9.9-9.9Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Edit</span>
                  </span>
                </button>
              )}
            </div>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gap: 8,
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
              }}
            >
              <label>Deviation from normal (%)</label>
              <input
                type="number"
                value={deviationInput}
                onChange={(e) => setDeviationInput(e.target.value)}
                disabled={!editingDeviation || settingsSaving}
                style={{ width: 120 }}
              />
              {editingDeviation ? (
                <button onClick={saveDeviation} disabled={settingsSaving}>
                  Save
                </button>
              ) : (
                <button onClick={() => setEditingDeviation(true)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path
                        d="M14.7 4.3a1 1 0 0 1 1.4 0l3.6 3.6a1 1 0 0 1 0 1.4l-9.9 9.9a1 1 0 0 1-.5.3l-4.5 1.1a1 1 0 0 1-1.2-1.2l1.1-4.5a1 1 0 0 1 .3-.5l9.9-9.9Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Edit</span>
                  </span>
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {miners.length === 0 && (
              <p>
                No miners yet. Start the agent and wait for it to sync the config.
              </p>
            )}
            {miners.map((miner) => {
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
                    expectedHashrate?: number;
                  }
                | null;

              const online = metric?.online;
              const statusLabel =
                online === true ? "ONLINE" : online === false ? "OFFLINE" : "UNKNOWN";
              const statusColor =
                online === true ? "#0b7a00" : online === false ? "#b00020" : "#666";
              return (
                <div
                  key={miner.minerId}
                  style={{ border: "1px solid #ddd", padding: 12 }}
                >
                  <div>minerId: {miner.minerId}</div>
                  <div>
                    status:{" "}
                    <span style={{ color: statusColor, fontWeight: 600 }}>
                      {statusLabel}
                    </span>
                  </div>
                  <div>lastSeen: {miner.lastSeen}</div>
                  <div>ip: {metric?.ip ?? "-"}</div>
                  <div>asicType: {metric?.asicType ?? "-"}</div>
                  <div>firmware: {metric?.firmware ?? "-"}</div>
                  <div>authType: {metric?.authType ?? "-"}</div>
                  <div>expectedHashrate: {metric?.expectedHashrate ?? "-"}</div>
                  <div>readStatus: {metric?.readStatus ?? "-"}</div>
                  {metric?.error && (
                    <div style={{ color: "#b00020" }}>error: {metric.error}</div>
                  )}
                  <div>hashrate: {metric?.hashrate ?? "-"}</div>
                  <div>temp: {metric?.temp ?? "-"}</div>
                  <div>fan: {metric?.fan ?? "-"}</div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button onClick={() => createCommand(miner.minerId, "RESTART")}>
                      Restart
                    </button>
                    <button onClick={() => createCommand(miner.minerId, "SLEEP")}>
                      Sleep
                    </button>
                    <button onClick={() => createCommand(miner.minerId, "WAKE")}>
                      Wake
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ border: "1px solid #ddd", padding: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <h2 style={{ marginTop: 0, display: "flex", gap: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {icons.bell} Notifications
                </span>
              </h2>
              <button onClick={() => setGroupNotifications((prev) => !prev)}>
                {groupNotifications ? "Ungroup all" : "Group all"}
              </button>
            </div>
            {groupedNotifications.length === 0 && <p>No notifications.</p>}
            <div style={{ display: "grid", gap: 12 }}>
              {groupedNotifications.map((note) => (
                <div
                  key={note.id}
                  style={{
                    border: "1px solid #eee",
                    padding: 10,
                    borderRadius: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#666" }}>
                      {new Date(note.createdAt).toLocaleString()}
                      {note.count && note.count > 1 && (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "#f1f5f9",
                            fontSize: 12,
                          }}
                        >
                          x{note.count}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleGroupKey(groupKeyFor(note))}
                      disabled={groupNotifications}
                    >
                      {groupNotifications
                        ? "Grouped (all)"
                        : groupedKeys.includes(groupKeyFor(note))
                          ? "Ungroup"
                          : "Group"}
                    </button>
                  </div>
                  <div style={{ marginTop: 4 }}>{note.message}</div>
                  {note.action === "RESTART" && note.minerId && (
                    <button
                      style={{ marginTop: 8 }}
                      onClick={() => createCommand(note.minerId!, "RESTART")}
                    >
                      Restart now
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
