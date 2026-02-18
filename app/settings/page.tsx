"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { clearAuthState, getAuthState, setAuthState } from "@/app/lib/auth-client";
import type { MinerState, Settings } from "@/app/lib/types";
import { readUiLang, t, type UiLang, writeUiLang } from "@/app/lib/ui-lang";

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
    <Container maxWidth={false} sx={{ p: 2 }}>
      <Paper sx={{ p: 1.5, mb: 1.25 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Button component={Link} href="/" variant="outlined" color="primary">
              {t(uiLang, "dashboard")}
            </Button>
            <Typography variant="subtitle1" fontWeight={800}>{t(uiLang, "settings")}</Typography>
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
            <Button
              variant="outlined"
              color="error"
              onClick={async () => {
                try {
                  await fetch("/api/auth/logout", { method: "POST" });
                } catch {
                  // ignore network errors on logout
                }
                clearAuthState();
                router.replace("/auth");
              }}
            >
              {t(uiLang, "logout")}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 1.25 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={1.25}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Paper sx={{ p: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
              {t(uiLang, "general_alerts")}
            </Typography>

            {!settings ? (
              <Typography variant="body2" color="text.secondary">
                {t(uiLang, "loading")}
              </Typography>
            ) : (
              <Stack spacing={1.1}>
                <TextField
                  type="number"
                  label={t(uiLang, "prompt_cooldown_minutes")}
                  value={restartDelayMinutes}
                  onChange={(e) => setRestartDelayMinutes(e.target.value)}
                />
                <TextField
                  type="number"
                  label={t(uiLang, "deviation_legacy_percent")}
                  inputProps={{ step: "0.1" }}
                  value={hashrateDeviationPercent}
                  onChange={(e) => setHashrateDeviationPercent(e.target.value)}
                />
                <FormControlLabel
                  control={<Checkbox checked={notifyAutoRestart} onChange={(e) => setNotifyAutoRestart(e.target.checked)} />}
                  label={t(uiLang, "notify_when_auto_restart_executed")}
                />
                <FormControlLabel
                  control={<Checkbox checked={notifyRestartPrompt} onChange={(e) => setNotifyRestartPrompt(e.target.checked)} />}
                  label={t(uiLang, "notify_when_low_hashrate_and_auto_restart_off")}
                />

                <Stack direction="row" spacing={0.8}>
                  <Button onClick={saveGeneral} disabled={saving}>
                    {saving ? t(uiLang, "saving") : t(uiLang, "save")}
                  </Button>
                  <Button variant="outlined" color="inherit" onClick={fetchData} disabled={saving}>
                    {t(uiLang, "reload")}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Paper sx={{ p: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
              {t(uiLang, "per_miner_auto_restart")}
            </Typography>
            <Stack spacing={0.8} sx={{ maxHeight: 460, overflow: "auto" }}>
              {miners.map((miner) => (
                <Paper
                  key={miner.minerId}
                  variant="outlined"
                  sx={{ p: 1.1, borderRadius: 2, "&:hover": { borderColor: "primary.main" } }}
                  component={Link}
                  href={`/settings/miner/${encodeURIComponent(miner.minerId)}`}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                    <Box>
                      <Typography variant="body2" fontWeight={800}>{miner.minerId}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(uiLang, "auto")}: {miner.autoRestartEnabled ? "ON" : "OFF"} · {t(uiLang, "threshold")}: {typeof miner.lowHashrateThresholdGh === "number" ? `${miner.lowHashrateThresholdGh} GH/s` : "-"}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="primary.main" fontWeight={800}>{t(uiLang, "open")}</Typography>
                  </Stack>
                </Paper>
              ))}

              {miners.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t(uiLang, "no_miners_yet")}
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}
