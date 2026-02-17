"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthState, getAuthState } from "@/app/lib/auth-client";
import type { Settings } from "@/app/lib/types";

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

export default function SettingsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const state = getAuthState();
    if (!state) {
      router.replace("/auth");
      return;
    }
    setAuthChecked(true);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setSaving(true);
    setError(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchSettings();
  }, [authChecked]);

  if (!authChecked) {
    return null;
  }

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
            <Link
              href="/"
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
              {icons.dashboard} Dashboard
            </Link>
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
              {icons.settings} Settings
            </span>
          </nav>
        </div>
        <button
          onClick={() => {
            clearAuthState();
            router.replace("/auth");
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {icons.logout} Logout
        </button>
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Notification Settings</h1>
        <Link href="/">Back</Link>
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!settings && <p>Loading...</p>}
      {settings && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={settings.notifyAutoRestart}
              onChange={(e) =>
                updateSettings({ notifyAutoRestart: e.target.checked })
              }
              disabled={saving}
            />
            <span>Notify when auto-restart happens</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={settings.notifyRestartPrompt}
              onChange={(e) =>
                updateSettings({ notifyRestartPrompt: e.target.checked })
              }
              disabled={saving}
            />
            <span>Notify when auto-restart is disabled</span>
          </label>
        </div>
      )}
    </div>
  );
}
