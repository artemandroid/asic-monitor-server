import type { Dispatch, SetStateAction } from "react";
import {
  Grid,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { CancelButton } from "@/app/components/ui/CancelButton";
import { t, type UiLang } from "@/app/lib/ui-lang";

type MinerSettingsPanel = {
  minerId: string;
  autoRestartEnabled: boolean;
  postRestartGraceMinutes: number;
  lowHashrateThresholdGh: number;
  autoPowerOnGridRestore: boolean;
  autoPowerOffGridLoss: boolean;
  autoPowerOnWhenGenerationCoversConsumption: boolean;
  autoPowerOffBatteryBelowPercent: number | null;
  autoPowerOnBatteryAbovePercent: number | null;
  autoPowerRestoreDelayMinutes: number;
  overheatProtectionEnabled: boolean;
  overheatShutdownTempC: number;
  overheatSleepMinutes: number;
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
  const batteryOffBase =
    typeof draft.autoPowerOffBatteryBelowPercent === "number"
      ? draft.autoPowerOffBatteryBelowPercent
      : 80;
  const batteryOnPresetValues = Array.from(
    new Set([
      Math.min(100, batteryOffBase + 5),
      Math.min(100, batteryOffBase + 10),
    ]),
  ).sort((a, b) => a - b);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 800 }}>
        {t(uiLang, "miner_settings")}: {draft.minerId}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "overheat_protection")}
          </Typography>
          <FormControlLabel
            control={
              <Switch
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

          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label={t(uiLang, "overheat_shutdown_threshold_c")}
                value={String(draft.overheatShutdownTempC)}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, overheatShutdownTempC: Number.parseInt(e.target.value, 10) || 83 }
                      : prev,
                  )
                }
              >
                {[83, 84, 85].map((v) => (
                  <MenuItem key={v} value={String(v)}>
                    {v}C
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                type="number"
                fullWidth
                label={t(uiLang, "overheat_sleep_minutes")}
                value={String(draft.overheatSleepMinutes)}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          overheatSleepMinutes: Math.max(
                            5,
                            Math.min(180, Number.parseInt(e.target.value || "30", 10) || 30),
                          ),
                        }
                      : prev,
                  )
                }
                inputProps={{ min: 5, max: 180, step: 1 }}
              />
            </Grid>
          </Grid>

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
              <Switch
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

          <Box
            sx={{
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 1.5,
              p: 1.25,
              bgcolor: "rgba(15,23,42,0.02)",
            }}
          >
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" fontWeight={800}>
                {t(uiLang, "action_turn_off")}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
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

              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1.5}>
                    <TextField
                      type="number"
                      label={t(uiLang, "auto_off_if_battery_below_percent")}
                      placeholder={t(uiLang, "disabled")}
                      value={draft.autoPowerOffBatteryBelowPercent ?? ""}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev
                            ? (() => {
                                const offNext =
                                  e.target.value === "" ? null : Number.parseFloat(e.target.value || "0") || 0;
                                const onCurrent = prev.autoPowerOnBatteryAbovePercent;
                                return {
                                  ...prev,
                                  autoPowerOffBatteryBelowPercent: offNext,
                                  autoPowerOnBatteryAbovePercent:
                                    typeof offNext === "number" &&
                                    typeof onCurrent === "number" &&
                                    onCurrent < offNext
                                      ? offNext
                                      : onCurrent,
                                };
                              })()
                            : prev,
                        )
                      }
                    />
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ flexWrap: "wrap", rowGap: 0.75, mb: 1.5 }}
                    >
                      <PresetButtons
                        values={[80, 90]}
                        onSelect={(preset) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  autoPowerOffBatteryBelowPercent: preset,
                                  autoPowerOnBatteryAbovePercent:
                                    typeof prev.autoPowerOnBatteryAbovePercent === "number" &&
                                    prev.autoPowerOnBatteryAbovePercent < preset + 5
                                      ? preset + 5
                                      : prev.autoPowerOnBatteryAbovePercent,
                                }
                              : prev,
                          )
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
                    <Box sx={{ height: 10 }} />

                    <TextField
                      type="number"
                      label={t(uiLang, "auto_on_if_battery_above_percent")}
                      placeholder={t(uiLang, "disabled")}
                      value={draft.autoPowerOnBatteryAbovePercent ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => {
                          if (!prev) return prev;
                          const next =
                            e.target.value === "" ? null : Number.parseFloat(e.target.value || "0") || 0;
                          return { ...prev, autoPowerOnBatteryAbovePercent: next };
                        })
                      }
                      onBlur={() =>
                        setDraft((prev) => {
                          if (!prev) return prev;
                          const off = prev.autoPowerOffBatteryBelowPercent;
                          const on = prev.autoPowerOnBatteryAbovePercent;
                          if (typeof on !== "number" || typeof off !== "number") return prev;
                          const minAllowed = off + 5;
                          if (on >= minAllowed) return prev;
                          return { ...prev, autoPowerOnBatteryAbovePercent: minAllowed };
                        })
                      }
                    />
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ flexWrap: "wrap", rowGap: 0.75, mb: 1.5 }}
                    >
                      <PresetButtons
                        values={batteryOnPresetValues}
                        onSelect={(preset) =>
                          setDraft((prev) => {
                            if (!prev) return prev;
                            const off = prev.autoPowerOffBatteryBelowPercent;
                            const safePreset =
                              typeof off === "number" ? Math.max(preset, off + 5) : preset;
                            return { ...prev, autoPowerOnBatteryAbovePercent: safePreset };
                          })
                        }
                        format={(preset) => `${preset}%`}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        onClick={() =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  autoPowerOnBatteryAbovePercent:
                                    typeof prev.autoPowerOffBatteryBelowPercent === "number"
                                      ? prev.autoPowerOffBatteryBelowPercent + 5
                                      : null,
                                }
                              : prev,
                          )
                        }
                        sx={{ borderRadius: 999 }}
                      >
                        {t(uiLang, "same_as_off_threshold")}
                      </Button>
                    </Stack>
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1.5}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={draft.autoPowerOnWhenGenerationCoversConsumption}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    autoPowerOnWhenGenerationCoversConsumption: e.target.checked,
                                  }
                                : prev,
                            )
                          }
                        />
                      }
                      label={t(uiLang, "auto_on_when_generation_covers_consumption_and_battery_not_discharging")}
                    />
                  </Stack>
                </Grid>
              </Grid>

              <Typography variant="caption" color="text.secondary">
                {t(uiLang, "hint_auto_on_battery_threshold_must_be_greater_or_equal_than_auto_off")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t(uiLang, "hint_auto_on_generation_cover_mode_requires_battery_not_discharging")}
              </Typography>
            </Stack>
          </Box>

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
              <Switch
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
        <CancelButton onClick={onClose}>
          {t(uiLang, "cancel")}
        </CancelButton>
        <Button onClick={onSave} disabled={minerSettingsSaving}>
          {minerSettingsSaving ? t(uiLang, "saving") : t(uiLang, "save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
