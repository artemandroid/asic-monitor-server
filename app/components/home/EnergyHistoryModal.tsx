import { useEffect, useState } from "react";
import {
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { CancelButton } from "@/app/components/ui/CancelButton";
import { t, type UiLang } from "@/app/lib/ui-lang";
import type { DeyeEnergyTodaySummary } from "@/app/lib/deye-types";

type Period = "today" | "yesterday" | "week" | "this_month" | "prev_month" | "custom";

type EnergyHistoryModalProps = {
  uiLang: UiLang;
  todayData: DeyeEnergyTodaySummary | null;
  onClose: () => void;
};

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPeriodDates(period: Period, customFrom: string, customTo: string): { from: string; to: string } | null {
  const today = new Date();
  if (period === "today") {
    const d = toLocalDateString(today);
    return { from: d, to: d };
  }
  if (period === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const d = toLocalDateString(y);
    return { from: d, to: d };
  }
  if (period === "week") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toLocalDateString(from), to: toLocalDateString(today) };
  }
  if (period === "this_month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toLocalDateString(from), to: toLocalDateString(today) };
  }
  if (period === "prev_month") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0); // day 0 = last day of prev month
    return { from: toLocalDateString(from), to: toLocalDateString(to) };
  }
  if (period === "custom") {
    if (!customFrom || !customTo) return null;
    return { from: customFrom, to: customTo };
  }
  return null;
}

function formatDateRange(from: string, to: string): string {
  if (from === to) {
    return new Date(from).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const f = new Date(from).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const tStr = new Date(to).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${f} – ${tStr}`;
}

function EnergyCard({
  label,
  value,
  accentColor,
  valueColor,
  tooltip,
}: {
  label: string;
  value: string;
  accentColor: string;
  valueColor: string;
  tooltip?: string;
}) {
  const card = (
    <Box
      sx={{
        border: `1.5px solid ${accentColor}`,
        borderRadius: 2,
        px: 1.75,
        py: 1.25,
        flex: "1 1 130px",
        minWidth: 0,
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: accentColor, display: "block", lineHeight: 1.3, mb: 0.5, fontWeight: 500 }}
      >
        {label}
      </Typography>
      <Typography variant="h6" sx={{ color: valueColor, fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
  );
  if (tooltip) {
    return (
      <Tooltip title={tooltip} placement="top" arrow>
        {card}
      </Tooltip>
    );
  }
  return card;
}

export function EnergyHistoryModal({ uiLang, todayData, onClose }: EnergyHistoryModalProps) {
  const theme = useTheme();
  const neutralGray = theme.palette.custom.deyeNeutralGray;
  const fullBlue = theme.palette.custom.deyeFullBlue;
  const negativeRed = theme.palette.custom.deyeNegativeRed;
  const successGreen = theme.palette.success.main;
  const valueTextColor = theme.palette.text.primary;

  const todayStr = toLocalDateString(new Date());
  const [period, setPeriod] = useState<Period>("today");
  const [customFrom, setCustomFrom] = useState(todayStr);
  const [customTo, setCustomTo] = useState(todayStr);
  const [data, setData] = useState<DeyeEnergyTodaySummary | null>(todayData);
  const [useNetMeteringForGreenTariff, setUseNetMeteringForGreenTariff] = useState(false);
  const [miningStartDate, setMiningStartDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periods: Period[] = ["today", "yesterday", "week", "this_month", "prev_month", "custom"];
  const periodLabels: Record<Period, string> = {
    today: t(uiLang, "period_today"),
    yesterday: t(uiLang, "period_yesterday"),
    week: t(uiLang, "period_week"),
    this_month: t(uiLang, "period_this_month"),
    prev_month: t(uiLang, "period_prev_month"),
    custom: t(uiLang, "period_custom"),
  };

  useEffect(() => {
    const dates = getPeriodDates(period, customFrom, customTo);
    if (!dates) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/deye/energy?from=${dates.from}&to=${dates.to}`)
      .then((r) => r.json())
      .then((res: {
        summary?: DeyeEnergyTodaySummary | null;
        error?: string;
        useNetMeteringForGreenTariff?: boolean;
        miningStartDate?: string | null;
      }) => {
        if (res.error) {
          setError(res.error);
          setData(null);
        } else {
          setData(res.summary ?? null);
          setUseNetMeteringForGreenTariff(res.useNetMeteringForGreenTariff === true);
          const nextMiningStartDate =
            typeof res.miningStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(res.miningStartDate)
              ? res.miningStartDate
              : null;
          setMiningStartDate(nextMiningStartDate);
          if (period === "custom" && nextMiningStartDate && customFrom !== nextMiningStartDate) {
            setCustomFrom(nextMiningStartDate);
            setCustomTo(todayStr);
          }
        }
      })
      .catch(() => {
        setError("Network error");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo, todayStr]);

  const handlePeriodChange = (next: Period) => {
    if (next === "custom") {
      setCustomFrom(miningStartDate ?? todayStr);
      setCustomTo(todayStr);
    }
    setPeriod(next);
  };

  const displayDates = getPeriodDates(period, customFrom, customTo);
  const dateRangeLabel = displayDates ? formatDateRange(displayDates.from, displayDates.to) : null;

  const formatKwh = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(2)} kWh` : "-";
  const formatUah = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(2)} ₴` : null;
  const formatPct = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "-";
  const formatSignedKwh = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${v > 0 ? "+" : ""}${v.toFixed(2)} kWh`
      : "-";

  const genCoveragePercent =
    typeof data?.generationKwh === "number" &&
    typeof data?.consumptionKwh === "number" &&
    data.consumptionKwh > 0
      ? Math.min(100, (data.generationKwh / data.consumptionKwh) * 100)
      : null;
  const generationMinusConsumptionKwh =
    typeof data?.generationKwh === "number" &&
    typeof data?.consumptionKwh === "number" &&
    Number.isFinite(data.generationKwh) &&
    Number.isFinite(data.consumptionKwh)
      ? data.generationKwh - data.consumptionKwh
      : null;
  const genCovered = typeof genCoveragePercent === "number" && genCoveragePercent >= 100;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, pb: 1 }}>
        {t(uiLang, "energy_history")}
        {dateRangeLabel ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, mt: 0.25 }}>
            {dateRangeLabel}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {/* Period selector */}
          <ButtonGroup size="small" variant="outlined" fullWidth sx={{ "& .MuiButton-root": { whiteSpace: "nowrap", minWidth: 0, px: 1 } }}>
            {periods.map((p) => (
              <Button
                key={p}
                variant={period === p ? "contained" : "outlined"}
                onClick={() => handlePeriodChange(p)}
              >
                {periodLabels[p]}
              </Button>
            ))}
          </ButtonGroup>

          {/* Custom range from settings: mining start date → today */}
          {period === "custom" ? (
            <Stack direction="row" spacing={1}>
              <TextField
                type="date"
                size="small"
                label={t(uiLang, "date_from")}
                value={customFrom}
                InputLabelProps={{ shrink: true }}
                inputProps={{ style: { colorScheme: theme.palette.mode } }}
                disabled
                fullWidth
              />
              <TextField
                type="date"
                size="small"
                label={t(uiLang, "date_to")}
                value={customTo}
                InputLabelProps={{ shrink: true }}
                inputProps={{ style: { colorScheme: theme.palette.mode } }}
                disabled
                fullWidth
              />
            </Stack>
          ) : null}

          {/* Loading / error / no data */}
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
            <Typography variant="body2" color="error.main">{error}</Typography>
          ) : data === null ? (
            <Typography variant="body2" color="text.secondary">
              {t(uiLang, "no_data_for_period")}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {/* Row 1: Generation + Consumption */}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                <EnergyCard
                  label={period === "today" ? t(uiLang, "generated_today") : t(uiLang, "generated_period")}
                  value={formatKwh(data.generationKwh)}
                  accentColor={fullBlue}
                  valueColor={valueTextColor}
                  tooltip={t(uiLang, "tooltip_generation")}
                />
                <EnergyCard
                  label={t(uiLang, "consumption_kwh")}
                  value={formatKwh(data.consumptionKwh)}
                  accentColor={neutralGray}
                  valueColor={valueTextColor}
                  tooltip={t(uiLang, "tooltip_consumption")}
                />
              </Box>

              {/* Row 2: Solar coverage + Generation surplus/coverage */}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                <EnergyCard
                  label={t(uiLang, "solar_coverage_label")}
                  value={formatPct(data.solarCoveragePercent)}
                  accentColor={neutralGray}
                  valueColor={valueTextColor}
                  tooltip={t(uiLang, "tooltip_solar_coverage")}
                />
                {genCoveragePercent !== null || generationMinusConsumptionKwh !== null ? (
                  <EnergyCard
                    label={
                      t(
                        uiLang,
                        useNetMeteringForGreenTariff ? "gen_surplus_label" : "gen_coverage_label",
                      )
                    }
                    value={
                      useNetMeteringForGreenTariff
                        ? formatSignedKwh(generationMinusConsumptionKwh)
                        : genCovered
                          ? "100% ✓"
                          : formatPct(genCoveragePercent)
                    }
                    accentColor={
                      useNetMeteringForGreenTariff
                        ? typeof generationMinusConsumptionKwh === "number" &&
                          generationMinusConsumptionKwh >= 0
                          ? fullBlue
                          : negativeRed
                        : genCovered
                          ? fullBlue
                          : neutralGray
                    }
                    valueColor={
                      useNetMeteringForGreenTariff
                        ? typeof generationMinusConsumptionKwh === "number" &&
                          generationMinusConsumptionKwh >= 0
                          ? fullBlue
                          : negativeRed
                        : genCovered
                          ? fullBlue
                          : valueTextColor
                    }
                    tooltip={t(uiLang, "tooltip_gen_coverage")}
                  />
                ) : null}
              </Box>

              {/* Row 3: Import day + Import night + Export */}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                <EnergyCard
                  label={t(uiLang, "import_day")}
                  value={formatKwh(data.importKwhDay)}
                  accentColor={neutralGray}
                  valueColor={valueTextColor}
                  tooltip={t(uiLang, "tooltip_import_day")}
                />
                <EnergyCard
                  label={t(uiLang, "import_night")}
                  value={formatKwh(data.importKwhNight)}
                  accentColor={neutralGray}
                  valueColor={valueTextColor}
                  tooltip={t(uiLang, "tooltip_import_night")}
                />
                {typeof data.exportKwh === "number" && data.exportKwh > 0 ? (
                  <EnergyCard
                    label={t(uiLang, "export_today")}
                    value={formatKwh(data.exportKwh)}
                    accentColor={fullBlue}
                    valueColor={valueTextColor}
                    tooltip={t(uiLang, "tooltip_export_today")}
                  />
                ) : null}
              </Box>

              {/* Row 4: Cost (if available) */}
              {data.estimatedNetCost !== null ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                  <EnergyCard
                    label={t(uiLang, "estimated_cost_today")}
                    value={formatUah(data.estimatedNetCost) ?? "-"}
                    accentColor={negativeRed}
                    valueColor={valueTextColor}
                    tooltip={t(uiLang, "tooltip_estimated_cost")}
                  />
                  {data.estimatedCostWithoutAsics !== null ? (
                    <EnergyCard
                      label={t(uiLang, "estimated_without_asics")}
                      value={formatUah(data.estimatedCostWithoutAsics) ?? "-"}
                      accentColor={data.estimatedCostWithoutAsics < 0 ? successGreen : fullBlue}
                      valueColor={data.estimatedCostWithoutAsics < 0 ? successGreen : valueTextColor}
                      tooltip={t(uiLang, "tooltip_estimated_without_asics")}
                    />
                  ) : null}
                  {data.estimatedNetCostWithGreen !== null ? (
                    <EnergyCard
                      label={t(uiLang, "estimated_cost_today_with_green")}
                      value={formatUah(data.estimatedNetCostWithGreen) ?? "-"}
                      accentColor={data.estimatedNetCostWithGreen < 0 ? successGreen : fullBlue}
                      valueColor={data.estimatedNetCostWithGreen < 0 ? successGreen : valueTextColor}
                      tooltip={t(uiLang, "tooltip_estimated_cost_green")}
                    />
                  ) : null}
                </Box>
              ) : null}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <Box sx={{ px: 2, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <CancelButton onClick={onClose}>{t(uiLang, "ok")}</CancelButton>
      </Box>
    </Dialog>
  );
}
