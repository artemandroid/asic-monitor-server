import {
  Box,
  Chip,
  Collapse,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { t, type UiLang } from "@/app/lib/ui-lang";

type DeyeStationSnapshot = {
  stationId: number;
  gridOnline: boolean | null;
  batterySoc: number | null;
  batteryStatus: string | null;
  batteryDischargePowerKw: number | null;
  generationPowerKw: number | null;
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
  return (
    <Paper sx={{ p: 1.25, mb: 1.25 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ cursor: "pointer" }}
        onClick={onToggleCollapsed}
      >
        <Stack direction="row" alignItems="center" spacing={1.2} minWidth={0}>
          <Typography variant="subtitle2" fontWeight={800}>
            {t(uiLang, "deye_station")} {deyeStation?.stationId ? `#${deyeStation.stationId}` : ""}
          </Typography>

          {deyeCollapsed && (
            <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
              <Chip
                label={deyeStation?.gridOnline === true ? t(uiLang, "connected") : t(uiLang, "disconnected")}
                size="small"
                color={deyeStation?.gridOnline === true ? "success" : "error"}
                variant="outlined"
              />
              {batteryModeLabel ? (
                <Typography variant="body2" color="text.secondary" noWrap>
                  {batteryModeLabel}
                  {typeof deyeStation?.batteryDischargePowerKw === "number" && deyeStation.batteryDischargePowerKw > 0
                    ? ` ${deyeStation.batteryDischargePowerKw.toFixed(2)} ${kwUnit}`
                    : ""}
                </Typography>
              ) : null}
              <Stack direction="row" spacing={0.75} alignItems="center">
                <BatteryPill batteryColor={batteryColor} batteryFill={batteryFill} />
                <Typography variant="body2" color="text.secondary">
                  {typeof deyeStation?.batterySoc === "number" ? `${deyeStation.batterySoc.toFixed(1)}%` : "-"}
                </Typography>
              </Stack>
            </Stack>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {deyeLoading
              ? t(uiLang, "updating")
              : `${t(uiLang, "updated")}: ${formatUpdatedAt(deyeStation?.updatedAt)}`}
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">{deyeCollapsed ? "▸" : "▾"}</Typography>
        </Stack>
      </Stack>

      <Collapse in={!deyeCollapsed}>
        <Grid container spacing={1.2} sx={{ mt: 0.8 }}>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">{t(uiLang, "grid")}</Typography>
            <Typography variant="body2" fontWeight={700}>
              {deyeStation?.gridOnline === true
                ? t(uiLang, "connected")
                : deyeStation?.gridOnline === false
                  ? t(uiLang, "disconnected")
                  : "✕"}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">{t(uiLang, "battery")}</Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <BatteryPill batteryColor={batteryColor} batteryFill={batteryFill} />
              <Typography variant="body2" fontWeight={700} title={`Battery: ${batteryMode}`}>
                {typeof deyeStation?.batterySoc === "number" ? `${deyeStation.batterySoc.toFixed(1)}%` : "-"}
              </Typography>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">{t(uiLang, "battery_status_power")}</Typography>
            <Typography variant="body2" fontWeight={700}>
              {batteryModeLabel || "-"}
              {typeof deyeStation?.batteryDischargePowerKw === "number"
                ? ` · ${deyeStation.batteryDischargePowerKw.toFixed(2)} ${kwUnit}`
                : ""}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">{t(uiLang, "generation")}</Typography>
            <Typography variant="body2" fontWeight={700}>
              {typeof deyeStation?.generationPowerKw === "number" ? `${deyeStation.generationPowerKw.toFixed(2)} ${kwUnit}` : "-"}
            </Typography>
          </Grid>
        </Grid>
      </Collapse>

      {deyeStation?.error ? (
        <Typography variant="caption" color="error.main" sx={{ mt: 0.75, display: "block" }}>
          {t(uiLang, "deye_api_error")}: {deyeStation.error}
        </Typography>
      ) : null}
    </Paper>
  );
}
