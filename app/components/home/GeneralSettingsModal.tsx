import type { Dispatch, SetStateAction } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
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

type GeneralSettingsModalProps = {
  uiLang: UiLang;
  draft: GeneralSettings;
  generalSettingsSaving: boolean;
  setDraft: Dispatch<SetStateAction<GeneralSettings | null>>;
  onClose: () => void;
  onSave: () => void;
};

export function GeneralSettingsModal({
  uiLang,
  draft,
  generalSettingsSaving,
  setDraft,
  onClose,
  onSave,
}: GeneralSettingsModalProps) {
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
                  ? { ...prev, deyeSyncIntervalSec: Math.max(5, Number.parseInt(e.target.value || "60", 10) || 60) }
                  : prev,
              )
            }
          />

          <TextField
            type="number"
            inputProps={{ min: 5, max: 3600 }}
            label={t(uiLang, "tuya_sync_interval_seconds")}
            value={String(draft.tuyaSyncIntervalSec)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, tuyaSyncIntervalSec: Math.max(5, Number.parseInt(e.target.value || "60", 10) || 60) }
                  : prev,
              )
            }
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {t(uiLang, "cancel")}
        </Button>
        <Button onClick={onSave} disabled={generalSettingsSaving}>
          {generalSettingsSaving ? t(uiLang, "saving") : t(uiLang, "save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
