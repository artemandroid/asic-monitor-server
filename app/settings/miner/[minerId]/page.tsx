"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { getAuthState, setAuthState } from "@/app/lib/auth-client";
import { readUiLang, t, type UiLang, writeUiLang } from "@/app/lib/ui-lang";

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
    <Container maxWidth={false} sx={{ p: 2 }}>
      <Paper sx={{ p: 1.5, mb: 1.25 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Button component={Link} href="/settings" variant="outlined" color="primary">
              {t(uiLang, "settings_2")}
            </Button>
            <Typography variant="subtitle1" fontWeight={800}>{minerId}</Typography>
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center">
            <Button
              size="small"
              variant={uiLang === "en" ? "contained" : "outlined"}
              onClick={() => {
                setUiLang("en");
                writeUiLang("en");
              }}
            >
              EN
            </Button>
            <Button
              size="small"
              variant={uiLang === "uk" ? "contained" : "outlined"}
              onClick={() => {
                setUiLang("uk");
                writeUiLang("uk");
              }}
            >
              UA
            </Button>
            <Button component={Link} href="/" variant="outlined" color="primary">
              {t(uiLang, "dashboard_2")}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 1.25 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 1.5, maxWidth: 760 }}>
        <Stack spacing={1.1}>
          <Typography variant="subtitle1" fontWeight={800}>
            {t(uiLang, "per_miner_auto_restart_2")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(uiLang, "expected_hashrate_from_config")}: {typeof expectedGh === "number" ? `${expectedGh.toFixed(2)} GH/s` : "-"}
          </Typography>

          <FormControlLabel
            control={<Checkbox checked={autoRestartEnabled} onChange={(e) => setAutoRestartEnabled(e.target.checked)} />}
            label={t(uiLang, "enable_auto_restart_for_this_miner")}
          />

          <TextField
            type="number"
            inputProps={{ step: "0.1" }}
            label={t(uiLang, "low_hashrate_threshold_gh_s")}
            value={lowHashrateThresholdGh}
            onChange={(e) => setLowHashrateThresholdGh(e.target.value)}
          />

          <TextField
            type="number"
            label={t(uiLang, "post_restart_grace_minutes")}
            value={postRestartGraceMinutes}
            onChange={(e) => setPostRestartGraceMinutes(e.target.value)}
          />

          <Stack direction="row" spacing={0.8} flexWrap="wrap">
            <Button onClick={save} disabled={saving}>
              {saving ? t(uiLang, "saving") : t(uiLang, "save")}
            </Button>
            <Button variant="outlined" color="primary" onClick={applyDefault40} disabled={saving || !expectedGh}>
              {t(uiLang, "set_40_percent_default")}
            </Button>
            <Button variant="outlined" color="inherit" onClick={fetchMinerSettings} disabled={saving}>
              {t(uiLang, "reload")}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
