import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { t, type UiLang } from "@/app/lib/ui-lang";

type DeyeStationSnapshot = {
  stationId: number;
  gridOnline: boolean | null;
  gridStateText: string | null;
  gridPowerKw: number | null;
  gridSignals: {
    source:
      | "wire_power"
      | "flag"
      | "text"
      | "power"
      | "charging_fallback"
      | "discharging_fallback"
      | "cached_previous"
      | "none";
    flag: {
      key: string | null;
      raw: string | number | boolean | null;
      parsed: boolean | null;
    };
    text: {
      key: string | null;
      value: string | null;
      parsed: boolean | null;
    };
    power: {
      key: string | null;
      raw: number | null;
      kw: number | null;
      parsed: boolean | null;
    };
    chargingFallbackParsed: boolean | null;
    dischargingFallbackParsed: boolean | null;
  };
  batterySoc: number | null;
  batteryStatus: string | null;
  batteryDischargePowerKw: number | null;
  generationPowerKw: number | null;
  consumptionPowerKw: number | null;
  energyToday?: {
    consumptionKwh: number;
    generationKwh: number;
    importKwhTotal: number;
    importKwhDay: number;
    importKwhNight: number;
    exportKwh: number;
    solarCoveragePercent: number;
    estimatedNetCost: number;
  };
  apiSignals: Array<{
    key: string;
    value: string | number | boolean | null;
  }>;
  updatedAt: string;
  error?: string;
};

type DeyeStationSectionProps = {
  uiLang: UiLang;
  deyeStation: DeyeStationSnapshot | null;
  deyeLoading: boolean;
  deyeCollapsed: boolean;
  batteryMode: string;
  batteryModeLabel: string;
  batteryColor: string;
  batteryFill: number;
  kwUnit: string;
  formatUpdatedAt: (iso?: string | null) => string;
  onToggleCollapsed: () => void;
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
  batteryMode,
  batteryModeLabel,
  batteryColor,
  batteryFill,
  kwUnit,
  formatUpdatedAt,
  onToggleCollapsed,
}: DeyeStationSectionProps) {
  const theme = useTheme();
  const neutralGray = theme.palette.custom.deyeNeutralGray;
  const fullBlue = theme.palette.custom.deyeFullBlue;
  const negativeRed = theme.palette.custom.deyeNegativeRed;
  const greenChipText = theme.palette.custom.chipTextOnSuccess;
  const valueTextColor = theme.palette.text.primary;
  const formatGridParsed = (value: boolean | null) =>
    value === true ? t(uiLang, "connected") : value === false ? t(uiLang, "disconnected") : t(uiLang, "unknown");

  const gridStatusLabel = formatGridParsed(deyeStation?.gridOnline ?? null);
  const gridStatusColor: "success" | "default" = deyeStation?.gridOnline === true
    ? "success"
    : "default";
  const gridStatusVariant: "filled" | "outlined" =
    deyeStation?.gridOnline === true ? "filled" : "outlined";

  const signalRows = (deyeStation?.apiSignals ?? []).map((signal) => ({
    key: signal.key,
    value:
      signal.value === null
        ? "null"
        : typeof signal.value === "boolean"
          ? signal.value ? "true" : "false"
        : String(signal.value),
  }));
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
  const isGridImport =
    typeof gridPowerKw === "number" ? gridPowerKw > 0.01 : false;
  const gridPowerLabel =
    isGridImport
      ? t(uiLang, "grid_import_power")
      : t(uiLang, "grid_export_power");
  const gridLabelColor = isGridImport ? negativeRed : fullBlue;

  return (
    <Paper sx={{ p: 1.25, mb: 1.25 }}>
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
            {t(uiLang, "deye_station")} {deyeStation?.stationId ? `#${deyeStation.stationId}` : ""}
          </Typography>
          <Stack
            direction="row"
            spacing={1.6}
            alignItems="center"
            minWidth={0}
            sx={{ flexWrap: "wrap", rowGap: 0.8 }}
          >
            <Chip
              label={gridStatusLabel}
              size="small"
              color={gridStatusColor}
              variant={gridStatusVariant}
              sx={{
                borderWidth: deyeStation?.gridOnline === false ? 2 : undefined,
                fontWeight: 700,
                color: deyeStation?.gridOnline === true ? greenChipText : undefined,
                "& .MuiChip-label": {
                  color: deyeStation?.gridOnline === true ? greenChipText : undefined,
                },
              }}
            />
            <Box
              sx={{
                px: 0.9,
                py: 0.35,
                borderRadius: 1.2,
                border: `1px solid ${batteryVisualColor}`,
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
              }}
            >
              <BatteryPill batteryColor={batteryColor} batteryFill={batteryFill} />
              <Typography variant="body2" sx={{ color: valueTextColor, fontWeight: 500 }} noWrap>
                {typeof batterySoc === "number" ? `${batterySoc.toFixed(1)}%` : "-"}
              </Typography>
            </Box>
            {batteryModeLabel && showBatteryStatusPill ? (
              <Box
                sx={{
                  px: 0.9,
                  py: 0.35,
                  borderRadius: 1.2,
                  border: `1px solid ${batteryStatusColor}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.6,
                }}
              >
                <Typography variant="body2" sx={{ color: batteryStatusColor }} noWrap>
                  {batteryModeLabel}:
                </Typography>
                <Typography variant="body2" sx={{ color: valueTextColor, fontWeight: 500 }} noWrap>
                  {batteryPowerText}
                </Typography>
              </Box>
            ) : null}
            {hasGeneration ? (
              <Box
                sx={{
                  px: 0.9,
                  py: 0.35,
                  borderRadius: 1.2,
                  border: `1px solid ${generationLabelColor}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.6,
                }}
              >
                <Typography variant="body2" sx={{ color: generationLabelColor }} noWrap>
                  {t(uiLang, "generation")}:
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: valueTextColor,
                    fontWeight: 500,
                  }}
                  noWrap
                >
                  {typeof generationKw === "number" ? `${generationKw.toFixed(2)} ${kwUnit}` : "-"}
                </Typography>
              </Box>
            ) : null}
            <Box
              sx={{
                px: 0.9,
                py: 0.35,
                borderRadius: 1.2,
                border: `1px solid ${gridLabelColor}`,
                display: "inline-flex",
                alignItems: "center",
                gap: 0.6,
              }}
            >
              <Typography variant="body2" sx={{ color: gridLabelColor }} noWrap>
                {gridPowerLabel}:
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: valueTextColor,
                  fontWeight: 500,
                }}
                noWrap
              >
                {typeof gridPowerKw === "number" ? `${Math.abs(gridPowerKw).toFixed(2)} ${kwUnit}` : "-"}
              </Typography>
            </Box>
          </Stack>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {deyeLoading
              ? t(uiLang, "updating")
              : `${t(uiLang, "updated")}: ${formatUpdatedAt(deyeStation?.updatedAt)}`}
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">
            {deyeCollapsed ? "▸" : "▾"}
          </Typography>
        </Stack>
      </Stack>

      {!deyeCollapsed && deyeStation?.error ? (
        <Typography variant="caption" color="error.main" sx={{ mt: 0.75, display: "block" }}>
          {t(uiLang, "deye_api_error")}: {deyeStation.error}
        </Typography>
      ) : null}

      {!deyeCollapsed && signalRows.length > 0 ? (
        <Box
          sx={{
            mt: 0.9,
            pt: 0.85,
            borderTop: (theme) => `1px dashed ${theme.palette.divider}`,
          }}
        >
          <Typography variant="caption" sx={{ color: "text.primary", fontWeight: 700 }}>
            {t(uiLang, "api_signals")} ({signalRows.length})
          </Typography>
          <Box
            sx={{
              mt: 0.5,
              display: "grid",
              gap: 0.4,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {signalRows.map((signal) => (
              <Typography
                key={signal.key}
                variant="caption"
                sx={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "text.secondary",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={`${signal.key}=${signal.value}`}
              >
                {signal.key}: <Box component="span" sx={{ color: "text.primary" }}>{signal.value}</Box>
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}
    </Paper>
  );
}
