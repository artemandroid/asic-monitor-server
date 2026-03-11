import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { SectionPaper } from "@/app/components/ui/SectionPaper";
import { StatPill } from "@/app/components/ui/StatPill";
import { StatusChip } from "@/app/components/ui/StatusChip";
import { EnergyHistoryModal } from "@/app/components/home/EnergyHistoryModal";
import { useTheme } from "@mui/material/styles";
import type { DeyeStationSnapshot } from "@/app/lib/deye-types";
import { t, type UiLang } from "@/app/lib/ui-lang";

type DeyeStationSectionProps = {
  uiLang: UiLang;
  deyeStation: DeyeStationSnapshot | null;
  deyeLoading: boolean;
  deyeCollapsed: boolean;
  tuyaDevices: Array<{ id: string; name: string }>;
  stationAutomatIds: string[];
  deyeAutomatsSaving: boolean;
  batteryMode: string;
  batteryModeLabel: string;
  batteryColor: string;
  batteryFill: number;
  kwUnit: string;
  formatUpdatedAt: (iso?: string | null) => string;
  onToggleCollapsed: () => void;
  onBindAutomat: (deviceId: string) => void;
  onUnbindAutomat: (deviceId: string) => void;
};

function BatteryPill({
  batteryColor,
  batteryFill,
}: {
  batteryColor: string;
  batteryFill: number;
}) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: "relative",
        width: 19,
        height: 10,
        borderRadius: 0.5,
        border: `1.5px solid ${batteryColor}`,
        display: "inline-flex",
        alignItems: "center",
        p: "1px",
        boxSizing: "border-box",
      }}
    >
      <Box
        sx={{
          width: `${batteryFill}%`,
          height: "100%",
          borderRadius: 0.4,
          background: batteryColor,
          opacity: 0.95,
        }}
      />
      <Box
        sx={{
          position: "absolute",
          right: -3,
          top: 2,
          width: 2,
          height: 4,
          borderRadius: 0.5,
          background: batteryColor,
        }}
      />
    </Box>
  );
}

export function DeyeStationSection({
  uiLang,
  deyeStation,
  deyeLoading,
  deyeCollapsed,
  tuyaDevices,
  stationAutomatIds,
  deyeAutomatsSaving,
  batteryMode,
  batteryModeLabel,
  batteryColor,
  batteryFill,
  kwUnit,
  formatUpdatedAt,
  onToggleCollapsed,
  onBindAutomat,
  onUnbindAutomat,
}: DeyeStationSectionProps) {
  const theme = useTheme();
  const [addAutomatAnchorEl, setAddAutomatAnchorEl] = useState<HTMLElement | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const neutralGray = theme.palette.custom.deyeNeutralGray;
  const fullBlue = theme.palette.custom.deyeFullBlue;
  const negativeRed = theme.palette.custom.deyeNegativeRed;
  const valueTextColor = theme.palette.text.primary;
  const formatGridParsed = (value: boolean | null) =>
    value === true ? t(uiLang, "connected") : value === false ? t(uiLang, "disconnected") : t(uiLang, "unknown");

  const gridStatusLabel = formatGridParsed(deyeStation?.gridOnline ?? null);

  const batteryPowerKw = deyeStation?.batteryDischargePowerKw ?? null;
  const showBatteryPower =
    typeof batteryPowerKw === "number" && Number.isFinite(batteryPowerKw) && Math.abs(batteryPowerKw) > 0.01;
  const batteryPowerText = `${showBatteryPower ? Math.abs(batteryPowerKw).toFixed(2) : "0.00"} ${kwUnit}`;
  const isCharging = batteryMode === "charging";
  const isDischarging = batteryMode === "discharging";
  const isIdle = batteryMode === "idle";
  const showBatteryStatusPill = !isIdle || showBatteryPower;
  const batterySoc = deyeStation?.batterySoc ?? null;
  const batteryFull = typeof batterySoc === "number" && batterySoc >= 99;
  const batteryStatusColor = isCharging
    ? fullBlue
    : isDischarging
      ? negativeRed
      : neutralGray;
  const batteryVisualColor = batteryFull && !isCharging && !isDischarging
    ? fullBlue
    : batteryStatusColor;

  const generationKw = deyeStation?.generationPowerKw ?? null;
  const hasGeneration =
    typeof generationKw === "number" && Number.isFinite(generationKw) && generationKw > 0.01;
  const generationLabelColor = hasGeneration ? fullBlue : neutralGray;

  const gridPowerKw = deyeStation?.gridPowerKw ?? null;
  const showGridFlow = deyeStation?.gridOnline !== false;
  const isGridImport =
    typeof gridPowerKw === "number" ? gridPowerKw > 0.01 : false;
  const gridPowerLabel =
    isGridImport
      ? t(uiLang, "grid_import_power")
      : t(uiLang, "grid_export_power");
  const gridLabelColor = isGridImport ? negativeRed : fullBlue;

  const energyToday = deyeStation?.energyToday ?? null;
  const stationAutomatSet = useMemo(() => new Set(stationAutomatIds), [stationAutomatIds]);
  const availableAutomats = tuyaDevices.filter((device) => !stationAutomatSet.has(device.id));
  const tuyaDeviceById = useMemo(
    () => new Map(tuyaDevices.map((device) => [device.id, device])),
    [tuyaDevices],
  );
  const stationTitle =
    typeof deyeStation?.stationId === "number" && Number.isFinite(deyeStation.stationId)
      ? String(Math.trunc(deyeStation.stationId))
      : "-";
  const stationAutomatsHeader =
    stationTitle !== "-"
      ? `${t(uiLang, "station_automats")} #${stationTitle}:`
      : `${t(uiLang, "station_automats")}:`;
  const addAutomatMenuOpen = Boolean(addAutomatAnchorEl);

  return (
    <SectionPaper sx={{ mb: 1.25 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        onClick={onToggleCollapsed}
        sx={{ cursor: "pointer" }}
      >
        <Stack direction="row" alignItems="center" spacing={1.2} minWidth={0}>
          <SolarPowerRoundedIcon sx={{ fontSize: 18, color: "warning.light", flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={800}>
            {deyeCollapsed
              ? t(uiLang, "deye_station")
              : `${t(uiLang, "deye_station")} (${stationTitle !== "-" ? `#${stationTitle}` : "-"})`}
          </Typography>
          <Stack
            direction="row"
            spacing={1.6}
            alignItems="center"
            minWidth={0}
            sx={{ flexWrap: "wrap", rowGap: 0.8 }}
          >
            <StatusChip
              isActive={deyeStation?.gridOnline}
              label={gridStatusLabel}
            />
            <Tooltip title={t(uiLang, "tooltip_battery_soc")} placement="top" arrow>
              <StatPill borderColor={batteryVisualColor} gap={0.75}>
                <BatteryPill batteryColor={batteryColor} batteryFill={batteryFill} />
                <Typography variant="body2" sx={{ color: valueTextColor, fontWeight: 500 }} noWrap>
                  {typeof batterySoc === "number" ? `${batterySoc.toFixed(1)}%` : "-"}
                </Typography>
              </StatPill>
            </Tooltip>
            {batteryModeLabel && showBatteryStatusPill ? (
              <Tooltip title={t(uiLang, "tooltip_battery_power")} placement="top" arrow>
                <StatPill borderColor={batteryStatusColor}>
                  <Typography variant="body2" sx={{ color: batteryStatusColor }} noWrap>
                    {batteryModeLabel}:
                  </Typography>
                  <Typography variant="body2" sx={{ color: valueTextColor, fontWeight: 500 }} noWrap>
                    {batteryPowerText}
                  </Typography>
                </StatPill>
              </Tooltip>
            ) : null}
            {hasGeneration ? (
              <Tooltip title={t(uiLang, "tooltip_generation")} placement="top" arrow>
                <StatPill borderColor={generationLabelColor}>
                  <Typography variant="body2" sx={{ color: generationLabelColor }} noWrap>
                    {t(uiLang, "generation")}:
                  </Typography>
                  <Typography variant="body2" sx={{ color: valueTextColor, fontWeight: 500 }} noWrap>
                    {typeof generationKw === "number" ? `${generationKw.toFixed(2)} ${kwUnit}` : "-"}
                  </Typography>
                </StatPill>
              </Tooltip>
            ) : null}
            {showGridFlow ? (
              <Tooltip title={t(uiLang, "tooltip_grid_flow")} placement="top" arrow>
                <StatPill borderColor={gridLabelColor}>
                  <Typography variant="body2" sx={{ color: gridLabelColor }} noWrap>
                    {gridPowerLabel}:
                  </Typography>
                  <Typography variant="body2" sx={{ color: valueTextColor, fontWeight: 500 }} noWrap>
                    {typeof gridPowerKw === "number" ? `${Math.abs(gridPowerKw).toFixed(2)} ${kwUnit}` : "-"}
                  </Typography>
                </StatPill>
              </Tooltip>
            ) : null}
          </Stack>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {deyeLoading
              ? t(uiLang, "updating")
              : `${t(uiLang, "updated")}: ${formatUpdatedAt(deyeStation?.updatedAt)}`}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            sx={{ minWidth: 0, px: 0.8, py: 0.2, fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation();
              setHistoryModalOpen(true);
            }}
          >
            {t(uiLang, "details")}
          </Button>
          <Typography variant="subtitle2" color="text.secondary">
            {deyeCollapsed ? "▸" : "▾"}
          </Typography>
        </Stack>
      </Stack>

      {!deyeCollapsed ? (
        <Box
          sx={{
            mt: 0.85,
            pt: 0.85,
            borderTop: (themeCtx) => `1px dashed ${themeCtx.palette.divider}`,
          }}
        >
          <Typography variant="caption" sx={{ color: "text.primary", fontWeight: 700 }}>
            {stationAutomatsHeader}
          </Typography>
          <Stack
            direction="row"
            spacing={0.6}
            useFlexGap
            flexWrap="wrap"
            alignItems="center"
            sx={{ mt: 0.7 }}
          >
            {stationAutomatIds.map((deviceId) => (
              <Chip
                key={`deye-station-bound-${deviceId}`}
                size="small"
                label={tuyaDeviceById.get(deviceId)?.name ?? deviceId}
                onDelete={
                  deyeAutomatsSaving
                    ? undefined
                    : () => {
                        onUnbindAutomat(deviceId);
                      }
                }
              />
            ))}
            <Button
              variant="contained"
              size="small"
              sx={{
                minWidth: 24,
                width: 24,
                height: 24,
                minHeight: 24,
                p: 0,
                lineHeight: 1,
                fontSize: 16,
                fontWeight: 800,
                borderRadius: 999,
                alignSelf: "center",
                bgcolor: "info.main",
                color: "common.white",
                "&:hover": { bgcolor: "info.dark" },
              }}
              disabled={deyeAutomatsSaving || availableAutomats.length === 0}
              onClick={(event) => {
                setAddAutomatAnchorEl((prev) => (prev ? null : event.currentTarget));
              }}
            >
              +
            </Button>
            <Menu
              anchorEl={addAutomatAnchorEl}
              open={addAutomatMenuOpen}
              onClose={() => setAddAutomatAnchorEl(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
            >
              {availableAutomats.map((device) => (
                <MenuItem
                  key={`deye-station-automat-pick-${device.id}`}
                  onClick={() => {
                    onBindAutomat(device.id);
                    setAddAutomatAnchorEl(null);
                  }}
                >
                  {device.name}
                </MenuItem>
              ))}
            </Menu>
          </Stack>
          {stationAutomatIds.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: "block" }}>
              {t(uiLang, "no_station_automats_bound")}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {!deyeCollapsed && deyeStation?.error ? (
        <Typography variant="caption" color="error.main" sx={{ mt: 0.75, display: "block" }}>
          {t(uiLang, "deye_api_error")}: {deyeStation.error}
        </Typography>
      ) : null}

      {historyModalOpen ? (
        <EnergyHistoryModal
          uiLang={uiLang}
          todayData={energyToday}
          onClose={() => setHistoryModalOpen(false)}
        />
      ) : null}
    </SectionPaper>
  );
}
