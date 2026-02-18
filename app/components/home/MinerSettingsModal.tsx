import type { Dispatch, SetStateAction } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { t, type UiLang } from "@/app/lib/ui-lang";

type MinerSettingsPanel = {
  minerId: string;
  autoRestartEnabled: boolean;
  postRestartGraceMinutes: number;
  lowHashrateThresholdGh: number;
  autoPowerOnGridRestore: boolean;
  autoPowerOffGridLoss: boolean;
  autoPowerOffGenerationBelowKw: number | null;
  autoPowerOffBatteryBelowPercent: number | null;
  autoPowerRestoreDelayMinutes: number;
  overheatProtectionEnabled: boolean;
  overheatShutdownTempC: number;
  overheatLocked: boolean;
  overheatLockedAt: string | null;
  overheatLastTempC: number | null;
  expectedHashrate: number | null;
};

type MinerSettingsModalProps = {
  uiLang: UiLang;
  draft: MinerSettingsPanel;
  minerSettingsSaving: boolean;
  setDraft: Dispatch<SetStateAction<MinerSettingsPanel | null>>;
  formatLastSeen: (iso: string | null) => string;
  onUnlockOverheatControl: (minerId: string) => void;
  onClose: () => void;
  onSave: () => void;
};

function PresetButtons({
  values,
  onSelect,
  format,
}: {
  values: number[];
  onSelect: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap">
      {values.map((preset) => (
        <Button
          key={preset}
          size="small"
          variant="outlined"
          color="inherit"
          onClick={() => onSelect(preset)}
          sx={{ borderRadius: 999 }}
        >
          {format ? format(preset) : String(preset)}
        </Button>
      ))}
    </Stack>
  );
}

export function MinerSettingsModal({
  uiLang,
  draft,
  minerSettingsSaving,
  setDraft,
  formatLastSeen,
  onUnlockOverheatControl,
  onClose,
  onSave,
}: MinerSettingsModalProps) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 800 }}>
        {t(uiLang, "miner_settings")}: {draft.minerId}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "overheat_protection")}
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.overheatProtectionEnabled}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, overheatProtectionEnabled: e.target.checked } : prev,
                  )
                }
              />
            }
            label={t(uiLang, "lock_controls_on_overheat_until_manual_unlock")}
          />

          <TextField
            type="number"
            label={t(uiLang, "overheat_shutdown_threshold_c")}
            value={String(draft.overheatShutdownTempC)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, overheatShutdownTempC: Number.parseFloat(e.target.value || "0") || 0 }
                  : prev,
              )
            }
          />
          <PresetButtons
            values={[84, 90, 95]}
            onSelect={(preset) =>
              setDraft((prev) => (prev ? { ...prev, overheatShutdownTempC: preset } : prev))
            }
            format={(preset) => `${preset}C`}
          />

          {draft.overheatLocked && (
            <Typography variant="body2" color="error.main" fontWeight={700}>
              {t(uiLang, "overheat_lock_active")}
              {typeof draft.overheatLastTempC === "number" ? ` (${draft.overheatLastTempC.toFixed(1)}C)` : ""}
              {draft.overheatLockedAt ? ` ${t(uiLang, "since")} ${formatLastSeen(draft.overheatLockedAt)}` : ""}.
            </Typography>
          )}

          <Divider />

          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "power_grid_battery")}
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.autoPowerOnGridRestore}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, autoPowerOnGridRestore: e.target.checked } : prev))
                }
              />
            }
            label={t(uiLang, "turn_on_bound_automat_when_grid_is_back")}
          />
          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "trigger_when_deye_grid_changes_from_off_to_on")}
          </Typography>

          <FormControlLabel
            control={
              <Checkbox
                checked={draft.autoPowerOffGridLoss}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, autoPowerOffGridLoss: e.target.checked } : prev))
                }
              />
            }
            label={t(uiLang, "turn_off_bound_automat_when_grid_is_lost")}
          />
          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "trigger_when_deye_grid_changes_from_on_to_off")}
          </Typography>

          <TextField
            type="number"
            label={t(uiLang, "auto_off_if_generation_below_kw")}
            placeholder={t(uiLang, "disabled")}
            value={draft.autoPowerOffGenerationBelowKw ?? ""}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      autoPowerOffGenerationBelowKw:
                        e.target.value === "" ? null : Number.parseFloat(e.target.value || "0") || 0,
                    }
                  : prev,
              )
            }
          />
          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "hint_if_both_generation_and_battery_thresholds_are_set_off_triggers_only_when_both_are_below_limits")}
          </Typography>
          <Stack direction="row" spacing={0.75}>
            <PresetButtons
              values={[5, 10]}
              onSelect={(preset) =>
                setDraft((prev) => (prev ? { ...prev, autoPowerOffGenerationBelowKw: preset } : prev))
              }
              format={(preset) => `${preset} kW`}
            />
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={() =>
                setDraft((prev) => (prev ? { ...prev, autoPowerOffGenerationBelowKw: null } : prev))
              }
              sx={{ borderRadius: 999 }}
            >
              {t(uiLang, "off_2")}
            </Button>
          </Stack>

          <TextField
            type="number"
            label={t(uiLang, "auto_off_if_battery_below_percent")}
            placeholder={t(uiLang, "disabled")}
            value={draft.autoPowerOffBatteryBelowPercent ?? ""}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      autoPowerOffBatteryBelowPercent:
                        e.target.value === "" ? null : Number.parseFloat(e.target.value || "0") || 0,
                    }
                  : prev,
              )
            }
          />
          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "hint_if_both_generation_and_battery_thresholds_are_set_off_triggers_only_when_both_are_below_limits")}
          </Typography>
          <Stack direction="row" spacing={0.75}>
            <PresetButtons
              values={[80, 90]}
              onSelect={(preset) =>
                setDraft((prev) => (prev ? { ...prev, autoPowerOffBatteryBelowPercent: preset } : prev))
              }
              format={(preset) => `${preset}%`}
            />
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={() =>
                setDraft((prev) => (prev ? { ...prev, autoPowerOffBatteryBelowPercent: null } : prev))
              }
              sx={{ borderRadius: 999 }}
            >
              {t(uiLang, "off_2")}
            </Button>
          </Stack>

          <TextField
            type="number"
            label={t(uiLang, "auto_on_delay_after_conditions_recover_minutes")}
            value={String(draft.autoPowerRestoreDelayMinutes)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, autoPowerRestoreDelayMinutes: Number.parseInt(e.target.value || "0", 10) || 0 }
                  : prev,
              )
            }
          />
          <Typography variant="caption" color="text.secondary">
            {t(uiLang, "grid_restore_turns_on_instantly_delay_is_ignored")}
          </Typography>
          <PresetButtons
            values={[0, 5, 10]}
            onSelect={(preset) =>
              setDraft((prev) => (prev ? { ...prev, autoPowerRestoreDelayMinutes: preset } : prev))
            }
            format={(preset) => (preset === 0 ? t(uiLang, "no_delay") : `${preset}${t(uiLang, "m")}`)}
          />

          <Divider />

          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "hashrate_auto_restart")}
          </Typography>

          <FormControlLabel
            control={
              <Checkbox
                checked={draft.autoRestartEnabled}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, autoRestartEnabled: e.target.checked } : prev))
                }
              />
            }
            label={t(uiLang, "enable_auto_restart_for_this_miner")}
          />

          <TextField
            type="number"
            label={t(uiLang, "low_hashrate_threshold_gh_s")}
            value={String(draft.lowHashrateThresholdGh)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, lowHashrateThresholdGh: Number.parseFloat(e.target.value || "0") || 0 }
                  : prev,
              )
            }
          />

          <TextField
            type="number"
            label={t(uiLang, "post_restart_grace_minutes")}
            value={String(draft.postRestartGraceMinutes)}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, postRestartGraceMinutes: Number.parseInt(e.target.value || "0", 10) || 0 }
                  : prev,
              )
            }
          />

          {typeof draft.expectedHashrate === "number" && (
            <Typography variant="body2" color="text.secondary">
              {t(uiLang, "expected_hashrate_from_config")}: {draft.expectedHashrate}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {draft.overheatLocked && (
          <Button
            variant="outlined"
            color="error"
            onClick={() => onUnlockOverheatControl(draft.minerId)}
          >
            {t(uiLang, "unlock_control")}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {t(uiLang, "cancel")}
        </Button>
        <Button onClick={onSave} disabled={minerSettingsSaving}>
          {minerSettingsSaving ? t(uiLang, "saving") : t(uiLang, "save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
