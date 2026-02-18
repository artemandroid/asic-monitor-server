"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthState, getAuthState, setAuthState } from "@/app/lib/auth-client";
import type { MinerState, Settings } from "@/app/lib/types";
import { readUiLang, tr, type UiLang, writeUiLang } from "@/app/lib/ui-lang";

export default function SettingsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [miners, setMiners] = useState<MinerState[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiLang, setUiLang] = useState<UiLang>("en");

  const [restartDelayMinutes, setRestartDelayMinutes] = useState("10");
  const [hashrateDeviationPercent, setHashrateDeviationPercent] = useState("10");
  const [notifyAutoRestart, setNotifyAutoRestart] = useState(true);
  const [notifyRestartPrompt, setNotifyRestartPrompt] = useState(true);

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

  const hydrate = (data: Settings) => {
    setRestartDelayMinutes(String(data.restartDelayMinutes));
    setHashrateDeviationPercent(String(data.hashrateDeviationPercent));
    setNotifyAutoRestart(data.notifyAutoRestart);
    setNotifyRestartPrompt(data.notifyRestartPrompt);
  };

  const fetchData = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const [sRes, mRes] = await Promise.all([fetch("/api/settings"), fetch("/api/miners")]);
      if (!sRes.ok) throw new Error(`Failed to fetch settings: ${sRes.status}`);
      if (!mRes.ok) throw new Error(`Failed to fetch miners: ${mRes.status}`);
      const sData = (await sRes.json()) as Settings;
      const mData = (await mRes.json()) as MinerState[];
      setSettings(sData);
      setMiners(mData);
      hydrate(sData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const saveGeneral = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const delay = Number.parseInt(restartDelayMinutes, 10);
      const deviation = Number.parseFloat(hashrateDeviationPercent);
      if (!Number.isFinite(delay) || delay < 0) {
        throw new Error("Restart delay must be a non-negative integer.");
      }
      if (!Number.isFinite(deviation) || deviation < 0) {
        throw new Error("Deviation must be a non-negative number.");
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restartDelayMinutes: delay,
          hashrateDeviationPercent: deviation,
          notifyAutoRestart,
          notifyRestartPrompt,
        }),
      });
      if (!res.ok) throw new Error(`Failed to update settings: ${res.status}`);
      const data = (await res.json()) as Settings;
      setSettings(data);
      hydrate(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  if (!authChecked) return null;

  return (
    <div style={{ padding: 16, fontFamily: "\"IBM Plex Sans\", \"Segoe UI\", sans-serif", color: "#111827" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid #d9e0ea",
          background: "#fff",
          boxShadow: "0 3px 10px rgba(9, 30, 66, 0.08)",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/" style={{ textDecoration: "none", color: "#0b57d0", fontWeight: 700 }}>
            {tr(uiLang, "← Dashboard", "← Дашборд")}
          </Link>
          <div style={{ fontWeight: 700 }}>{tr(uiLang, "Settings", "Налаштування")}</div>
        </div>
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => {
              setUiLang("en");
              writeUiLang("en");
            }}
            style={{ height: 28, padding: "0 10px", borderRadius: 999, border: "1px solid #cbd5e1", background: uiLang === "en" ? "#dbeafe" : "#fff", color: uiLang === "en" ? "#1d4ed8" : "#334155", fontWeight: 700 }}
          >
            EN
          </button>
          <button
            onClick={() => {
              setUiLang("uk");
              writeUiLang("uk");
            }}
            style={{ height: 28, padding: "0 10px", borderRadius: 999, border: "1px solid #cbd5e1", background: uiLang === "uk" ? "#dbeafe" : "#fff", color: uiLang === "uk" ? "#1d4ed8" : "#334155", fontWeight: 700 }}
          >
            UA
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
            borderRadius: 8,
            border: "1px solid #f0c5c5",
            background: "#fff5f5",
            color: "#9a3412",
            fontWeight: 700,
          }}
        >
          {tr(uiLang, "Logout", "Вийти")}
        </button>
        </div>
      </header>

      {error && (
        <div
          style={{
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#9f1239",
            borderRadius: 8,
            padding: "8px 10px",
            marginBottom: 10,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <section style={{ border: "1px solid #d6dce7", borderRadius: 10, background: "#fff", padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{tr(uiLang, "General Alerts", "Загальні сповіщення")}</div>
          {!settings ? (
            <div style={{ color: "#475569", fontSize: 13 }}>{tr(uiLang, "Loading...", "Завантаження...")}</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  {tr(uiLang, "Prompt Cooldown (minutes)", "Пауза між підказками (хв)")}
                </span>
                <input
                  type="number"
                  value={restartDelayMinutes}
                  onChange={(e) => setRestartDelayMinutes(e.target.value)}
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                  {tr(uiLang, "Deviation (legacy, %)", "Відхилення (legacy, %)")}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={hashrateDeviationPercent}
                  onChange={(e) => setHashrateDeviationPercent(e.target.value)}
                  style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                />
              </label>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={notifyAutoRestart}
                  onChange={(e) => setNotifyAutoRestart(e.target.checked)}
                />
                {tr(uiLang, "Notify when auto-restart executed", "Сповіщати про авто-рестарт")}
              </label>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={notifyRestartPrompt}
                  onChange={(e) => setNotifyRestartPrompt(e.target.checked)}
                />
                {tr(uiLang, "Notify when low hashrate and auto-restart OFF", "Сповіщати про низький хешрейт коли авто-рестарт вимкнено")}
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button
                  onClick={saveGeneral}
                  disabled={saving}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    border: "1px solid #bfdbfe",
                    background: "#0b57d0",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {saving ? tr(uiLang, "Saving...", "Збереження...") : tr(uiLang, "Save", "Зберегти")}
                </button>
                <button
                  onClick={fetchData}
                  disabled={saving}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#334155",
                    fontWeight: 700,
                  }}
                >
                  {tr(uiLang, "Reload", "Оновити")}
                </button>
              </div>
            </div>
          )}
        </section>

        <section style={{ border: "1px solid #d6dce7", borderRadius: 10, background: "#fff", padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{tr(uiLang, "Per-Miner Auto-Restart", "Авто-рестарт по кожному майнеру")}</div>
          <div style={{ display: "grid", gap: 6, maxHeight: 420, overflow: "auto" }}>
            {miners.map((miner) => (
              <Link
                key={miner.minerId}
                href={`/settings/miner/${encodeURIComponent(miner.minerId)}`}
                style={{
                  textDecoration: "none",
                  color: "#0f172a",
                  border: "1px solid #dbe2ee",
                  borderRadius: 8,
                  padding: "8px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  background: "#f8fafc",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{miner.minerId}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    {tr(uiLang, "Auto", "Авто")}: {miner.autoRestartEnabled ? "ON" : "OFF"} · {tr(uiLang, "Threshold", "Поріг")}:{" "}
                    {typeof miner.lowHashrateThresholdGh === "number"
                      ? `${miner.lowHashrateThresholdGh} GH/s`
                      : "-"}
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: "#0b57d0" }}>{tr(uiLang, "Open →", "Відкрити →")}</div>
              </Link>
            ))}
            {miners.length === 0 && <div style={{ color: "#475569", fontSize: 13 }}>{tr(uiLang, "No miners yet.", "Ще немає майнерів.")}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
