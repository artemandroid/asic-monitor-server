import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { CancelButton } from "@/app/components/ui/CancelButton";
import { t, type UiLang } from "@/app/lib/ui-lang";

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

type TariffPeriod = {
  id: number;
  effectiveFrom: string;
  dayRateUah: number;
  nightRateUah: number;
  greenRateUah: number;
};

type NewPeriodDraft = {
  effectiveFrom: string;
  dayRateUah: string;
  nightRateUah: string;
  greenRateUah: string;
};

type GeneralSettingsModalProps = {
  uiLang: UiLang;
  draft: GeneralSettings;
  generalSettingsSaving: boolean;
  reloadPending: boolean;
  canReloadConfig: boolean;
  setDraft: Dispatch<SetStateAction<GeneralSettings | null>>;
  onClose: () => void;
  onSave: () => void;
  onReloadConfig: () => void;
};

const EMPTY_DRAFT: NewPeriodDraft = {
  effectiveFrom: "",
  dayRateUah: "",
  nightRateUah: "",
  greenRateUah: "0",
};

function formatEffectiveFrom(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getActiveTariffId(periods: TariffPeriod[]): number | null {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  let activeId: number | null = null;
  let latestMs = -Infinity;
  for (const p of periods) {
    const ms = new Date(p.effectiveFrom).getTime();
    if (ms <= todayMs && ms > latestMs) {
      latestMs = ms;
      activeId = p.id;
    }
  }
  return activeId;
}

export function GeneralSettingsModal({
  uiLang,
  draft,
  generalSettingsSaving,
  reloadPending,
  canReloadConfig,
  setDraft,
  onClose,
  onSave,
  onReloadConfig,
}: GeneralSettingsModalProps) {
  const [tariffPeriods, setTariffPeriods] = useState<TariffPeriod[]>([]);
  const [tariffSaving, setTariffSaving] = useState(false);
  const [newPeriod, setNewPeriod] = useState<NewPeriodDraft | null>(null);

  useEffect(() => {
    fetch("/api/settings/tariff")
      .then((r) => r.json())
      .then((data: { periods?: TariffPeriod[] }) => {
        if (Array.isArray(data.periods)) setTariffPeriods(data.periods);
      })
      .catch(() => undefined);
  }, []);

  const saveTariffs = async (periods: TariffPeriod[]) => {
    setTariffSaving(true);
    try {
      const res = await fetch("/api/settings/tariff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periods: periods.map((p) => ({
            effectiveFrom: p.effectiveFrom,
            dayRateUah: p.dayRateUah,
            nightRateUah: p.nightRateUah,
            greenRateUah: p.greenRateUah,
          })),
        }),
      });
      const data = (await res.json()) as { periods?: TariffPeriod[]; error?: string };
      if (Array.isArray(data.periods)) setTariffPeriods(data.periods);
    } finally {
      setTariffSaving(false);
    }
  };

  const handleDeletePeriod = (id: number) => {
    const next = tariffPeriods.filter((p) => p.id !== id);
    void saveTariffs(next);
  };

  const handleAddPeriod = () => {
    if (!newPeriod) return;
    const dayRate = Number.parseFloat(newPeriod.dayRateUah);
    const nightRate = Number.parseFloat(newPeriod.nightRateUah);
    const greenRate = Number.parseFloat(newPeriod.greenRateUah || "0");
    if (!newPeriod.effectiveFrom || isNaN(dayRate) || isNaN(nightRate) || dayRate < 0 || nightRate < 0) return;
    const added: TariffPeriod = {
      id: 0, // placeholder, server assigns
      effectiveFrom: new Date(newPeriod.effectiveFrom).toISOString(),
      dayRateUah: dayRate,
      nightRateUah: nightRate,
      greenRateUah: isNaN(greenRate) || greenRate < 0 ? 0 : greenRate,
    };
    void saveTariffs([...tariffPeriods, added]);
    setNewPeriod(null);
  };

  const activeId = getActiveTariffId(tariffPeriods);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>
        {t(uiLang, "general_settings")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            type="number"
            inputProps={{ min: 5, max: 3600 }}
            label={t(uiLang, "miner_sync_interval_seconds")}
            value={String(draft.minerSyncIntervalSec)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, minerSyncIntervalSec: Math.max(5, Number.parseInt(e.target.value || "60", 10) || 60) }
                  : prev,
              )
            }
          />

          <TextField
            type="number"
            inputProps={{ min: 5, max: 3600 }}
            label={t(uiLang, "deye_sync_interval_seconds")}
            value={String(draft.deyeSyncIntervalSec)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, deyeSyncIntervalSec: Math.max(5, Number.parseInt(e.target.value || "360", 10) || 360) }
                  : prev,
              )
            }
          />

          <TextField
            type="number"
            inputProps={{ min: 3600, max: 3600 }}
            label={t(uiLang, "tuya_sync_interval_seconds")}
            value={String(draft.tuyaSyncIntervalSec)}
            disabled
          />

          <TextField
            type="number"
            label={t(uiLang, "prompt_cooldown_minutes")}
            value={String(draft.restartDelayMinutes)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, restartDelayMinutes: Number.parseInt(e.target.value || "0", 10) || 0 }
                  : prev,
              )
            }
          />

          <TextField
            type="number"
            label={t(uiLang, "deviation_percent_legacy")}
            value={String(draft.hashrateDeviationPercent)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, hashrateDeviationPercent: Number.parseFloat(e.target.value || "0") || 0 }
                  : prev,
              )
            }
          />

          <FormControlLabel
            control={
              <Switch
                checked={draft.notifyAutoRestart}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, notifyAutoRestart: e.target.checked } : prev,
                  )
                }
              />
            }
            label={t(uiLang, "notify_auto_restart")}
          />

          <FormControlLabel
            control={
              <Switch
                checked={draft.notifyRestartPrompt}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, notifyRestartPrompt: e.target.checked } : prev,
                  )
                }
              />
            }
            label={t(uiLang, "notify_restart_prompt")}
          />

          <TextField
            type="number"
            inputProps={{ min: 1 }}
            label={t(uiLang, "notifications_visible_on_dashboard")}
            value={String(draft.notificationVisibleCount)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      notificationVisibleCount: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                    }
                  : prev,
              )
            }
          />

          <TextField
            type="number"
            inputProps={{ min: 0, max: 100, step: "1" }}
            label={t(uiLang, "critical_battery_off_threshold_percent")}
            value={String(draft.criticalBatteryOffPercent)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      criticalBatteryOffPercent: Math.max(
                        0,
                        Math.min(100, Number.parseFloat(e.target.value || "0") || 0),
                      ),
                    }
                  : prev,
              )
            }
          />

          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "changes_are_applied_after_save")}
          </Typography>

          <Divider />

          {/* ── Tariff periods ── */}
          <Typography variant="subtitle2" fontWeight={700}>
            {t(uiLang, "tariff_periods")}
          </Typography>

          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "day_zone")} / {t(uiLang, "night_zone")}
          </Typography>

          {tariffPeriods.length === 0 && (
            <Typography variant="body2" color="text.secondary">—</Typography>
          )}

          {tariffPeriods.map((period) => (
            <Box
              key={period.id}
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto auto",
                gap: 1,
                alignItems: "center",
              }}
            >
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Typography variant="body2" fontWeight={600}>
                    {formatEffectiveFrom(period.effectiveFrom)}
                  </Typography>
                  {period.id === activeId && (
                    <Chip
                      label={t(uiLang, "active_tariff")}
                      size="small"
                      color="success"
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  )}
                </Stack>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {t(uiLang, "day_tariff_price")}: {period.dayRateUah}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {t(uiLang, "night_tariff_price")}: {period.nightRateUah}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {t(uiLang, "green_tariff_price")}: {period.greenRateUah}
              </Typography>
              <IconButton
                size="small"
                color="error"
                disabled={tariffSaving || tariffPeriods.length <= 1}
                onClick={() => handleDeletePeriod(period.id)}
              >
                <DeleteRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}

          {newPeriod === null ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddRoundedIcon />}
              onClick={() => setNewPeriod(EMPTY_DRAFT)}
              sx={{ alignSelf: "flex-start" }}
            >
              {t(uiLang, "add_tariff_period")}
            </Button>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 1,
              }}
            >
              <TextField
                type="date"
                size="small"
                label={t(uiLang, "effective_from")}
                value={newPeriod.effectiveFrom}
                onChange={(e) => setNewPeriod((p) => p && { ...p, effectiveFrom: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                type="number"
                size="small"
                inputProps={{ min: 0, step: "0.01" }}
                label={`${t(uiLang, "day_tariff_price")} (${t(uiLang, "uah_per_kwh")})`}
                value={newPeriod.dayRateUah}
                onChange={(e) => setNewPeriod((p) => p && { ...p, dayRateUah: e.target.value })}
              />
              <TextField
                type="number"
                size="small"
                inputProps={{ min: 0, step: "0.01" }}
                label={`${t(uiLang, "night_tariff_price")} (${t(uiLang, "uah_per_kwh")})`}
                value={newPeriod.nightRateUah}
                onChange={(e) => setNewPeriod((p) => p && { ...p, nightRateUah: e.target.value })}
              />
              <TextField
                type="number"
                size="small"
                inputProps={{ min: 0, step: "0.01" }}
                label={`${t(uiLang, "green_tariff_price")} (${t(uiLang, "uah_per_kwh")})`}
                value={newPeriod.greenRateUah}
                onChange={(e) => setNewPeriod((p) => p && { ...p, greenRateUah: e.target.value })}
              />
              <Button
                variant="contained"
                size="small"
                disabled={tariffSaving}
                onClick={handleAddPeriod}
              >
                {t(uiLang, "save")}
              </Button>
              <Button
                variant="text"
                size="small"
                onClick={() => setNewPeriod(null)}
              >
                {t(uiLang, "cancel")}
              </Button>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          variant="outlined"
          color="secondary"
          startIcon={<CloudDownloadRoundedIcon />}
          onClick={onReloadConfig}
          disabled={reloadPending || !canReloadConfig}
          sx={{ mr: "auto" }}
        >
          {reloadPending ? t(uiLang, "reloading") : t(uiLang, "reload_config")}
        </Button>
        <CancelButton onClick={onClose}>
          {t(uiLang, "cancel")}
        </CancelButton>
        <Button onClick={onSave} disabled={generalSettingsSaving}>
          {generalSettingsSaving ? t(uiLang, "saving") : t(uiLang, "save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
