"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, tr, type UiLang, writeUiLang } from "@/app/lib/ui-lang";

type MinerSettings = {
  minerId: string;
  autoRestartEnabled: boolean;
  postRestartGraceMinutes: number;
  lowHashrateThresholdGh: number;
  expectedHashrate: number | null;
};

function toGh(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 500 ? value / 1000 : value;
}

export default function MinerSettingsPage() {
  const router = useRouter();
  const params = useParams<{ minerId: string }>();
  const minerId = decodeURIComponent(params.minerId);

  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState<MinerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiLang, setUiLang] = useState<UiLang>("en");

  const [autoRestartEnabled, setAutoRestartEnabled] = useState(false);
  const [postRestartGraceMinutes, setPostRestartGraceMinutes] = useState("10");
  const [lowHashrateThresholdGh, setLowHashrateThresholdGh] = useState("10");

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

  const hydrate = (payload: MinerSettings) => {
    setData(payload);
    setAutoRestartEnabled(payload.autoRestartEnabled);
    setPostRestartGraceMinutes(String(payload.postRestartGraceMinutes));
    setLowHashrateThresholdGh(String(payload.lowHashrateThresholdGh));
  };

  const fetchMinerSettings = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    try {
      const res = await fetch(`/api/miners/${encodeURIComponent(minerId)}/settings`);
      if (!res.ok) throw new Error(`Failed to fetch miner settings: ${res.status}`);
      const payload = (await res.json()) as MinerSettings;
      hydrate(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const save = async () => {
    if (!getAuthState()) {
      router.replace("/auth");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const grace = Number.parseInt(postRestartGraceMinutes, 10);
      const threshold = Number.parseFloat(lowHashrateThresholdGh);
      if (!Number.isFinite(grace) || grace < 0) {
        throw new Error("Post-restart grace must be a non-negative integer.");
      }
      if (!Number.isFinite(threshold) || threshold < 0) {
        throw new Error("Low hashrate threshold must be a non-negative number.");
      }
      const res = await fetch(`/api/miners/${encodeURIComponent(minerId)}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoRestartEnabled,
          postRestartGraceMinutes: grace,
          lowHashrateThresholdGh: threshold,
        }),
      });
      if (!res.ok) throw new Error(`Failed to update miner settings: ${res.status}`);
      const payload = (await res.json()) as MinerSettings;
      hydrate(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const applyDefault40 = () => {
    const expectedGh = toGh(data?.expectedHashrate ?? null);
    if (!expectedGh) return;
    setLowHashrateThresholdGh((expectedGh * 0.6).toFixed(2));
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchMinerSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, minerId]);

  if (!authChecked) return null;

  const expectedGh = toGh(data?.expectedHashrate ?? null);

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
          <Link href="/settings" style={{ textDecoration: "none", color: "#0b57d0", fontWeight: 700 }}>
            {tr(uiLang, "← Settings", "← Налаштування")}
          </Link>
          <div style={{ fontWeight: 700 }}>{minerId}</div>
        </div>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
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
          <Link href="/" style={{ textDecoration: "none", color: "#0b57d0", fontWeight: 700 }}>
            {tr(uiLang, "Dashboard", "Дашборд")}
          </Link>
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

      <section style={{ border: "1px solid #d6dce7", borderRadius: 10, background: "#fff", padding: 12, maxWidth: 620 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tr(uiLang, "Per-Miner Auto-Restart", "Авто-рестарт по майнеру")}</div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 10 }}>
          {tr(uiLang, "Expected hashrate from config", "Очікуваний хешрейт з конфігу")}: {typeof expectedGh === "number" ? `${expectedGh.toFixed(2)} GH/s` : "-"}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={autoRestartEnabled}
              onChange={(e) => setAutoRestartEnabled(e.target.checked)}
            />
            {tr(uiLang, "Enable auto-restart for this miner", "Увімкнути авто-рестарт для цього майнера")}
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
              {tr(uiLang, "Low Hashrate Threshold (GH/s)", "Поріг низького хешрейту (GH/s)")}
            </span>
            <input
              type="number"
              step="0.1"
              value={lowHashrateThresholdGh}
              onChange={(e) => setLowHashrateThresholdGh(e.target.value)}
              style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
              {tr(uiLang, "Post-Restart Grace (minutes)", "Пауза після рестарту (хв)")}
            </span>
            <input
              type="number"
              value={postRestartGraceMinutes}
              onChange={(e) => setPostRestartGraceMinutes(e.target.value)}
              style={{ height: 34, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
            />
          </label>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            onClick={save}
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
            onClick={applyDefault40}
            disabled={saving || !expectedGh}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid #dbe2ee",
              background: "#eff6ff",
              color: "#1d4ed8",
              fontWeight: 700,
            }}
          >
            {tr(uiLang, "Set -40% default", "Встановити дефолт -40%")}
          </button>
          <button
            onClick={fetchMinerSettings}
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
      </section>
    </div>
  );
}
