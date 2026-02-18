import type { Dispatch, SetStateAction } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { t, type UiLang } from "@/app/lib/ui-lang";

type GeneralSettings = {
  restartDelayMinutes: number;
  hashrateDeviationPercent: number;
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
  notificationVisibleCount: number;
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
        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
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
              <Checkbox
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
              <Checkbox
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
