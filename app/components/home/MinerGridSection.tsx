"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import KeyboardArrowUpRoundedIcon from "@mui/icons-material/KeyboardArrowUpRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { CommandType, MinerState } from "@/app/lib/types";
import { t, type UiLang } from "@/app/lib/ui-lang";
import { ButtonSpinnerIcon } from "@/app/components/icons";

type MinerControlPhase = "RESTARTING" | "SLEEPING" | "WAKING" | "WARMING_UP";

type MinerControlState = {
  phase: MinerControlPhase;
  since: number;
  source?: "RESTART" | "WAKE" | "POWER_ON";
};

type MinerMetric = {
  online?: boolean;
  ip?: string;
  asicType?: string;
  firmware?: string;
  authType?: string;
  readStatus?: string;
  error?: string;
  hashrate?: number;
  temp?: number;
  fan?: number;
  fanSpeeds?: number[];
  boardTemps?: number[];
  boardInletTemps?: number[];
  boardOutletTemps?: number[];
  boardHashrates?: number[];
  boardTheoreticalHashrates?: number[];
  boardFreqs?: number[];
  boardHwErrors?: number[];
  boardChips?: number[];
  boardStates?: string[];
  statesOk?: boolean;
  hashrateRealtime?: number;
  minerMode?: number;
  hashrateAverage?: number;
  runtimeSeconds?: number;
  poolRejectionRate?: number;
  expectedHashrate?: number;
};

type TuyaLinkedDevice = {
  name: string;
  on: boolean | null;
};

type IsHashrateReadyMetric = {
  expectedHashrate?: number;
  hashrate?: number;
  hashrateRealtime?: number;
  online?: boolean;
};

type MinerGridSectionProps = {
  uiLang: UiLang;
  miners: MinerState[];
  orderedMiners: MinerState[];
  minerOrder: string[];
  gridRef: RefObject<HTMLDivElement | null>;
  settingsIcon: ReactNode;
  minerControlStates: Record<string, MinerControlState>;
  pendingActionByMiner: Record<string, CommandType | undefined>;
  minerAliases: Record<string, string>;
  tuyaBindingByMiner: Record<string, string>;
  deviceById: ReadonlyMap<string, TuyaLinkedDevice>;
  onText: string;
  offText: string;
  statusBadgesVertical: boolean;
  boardCountByMiner: Record<string, number>;
  editingAliasFor: string | null;
  aliasDraft: string;
  lowHashrateRestartGraceMs: number;
  formatRuntime: (seconds?: number) => string;
  formatLastSeen: (iso: string | null) => string;
  isHashrateReady: (metric: IsHashrateReadyMetric | null) => boolean;
  onOpenMinerSettings: (minerId: string) => void;
  onMoveCardToTop: (minerId: string) => void;
  onStartAliasEdit: (minerId: string, current: string) => void;
  onAliasDraftChange: (value: string) => void;
  onSaveAlias: (minerId: string) => void;
  onCancelAliasEdit: () => void;
  onRequestMinerCommandConfirm: (minerId: string, command: CommandType) => void;
  onUnlockOverheatControl: (minerId: string) => void;
};

export function MinerGridSection({
  uiLang,
  miners,
  orderedMiners,
  minerOrder,
  gridRef,
  settingsIcon,
  minerControlStates,
  pendingActionByMiner,
  minerAliases,
  tuyaBindingByMiner,
  deviceById,
  onText,
  offText,
  statusBadgesVertical,
  boardCountByMiner,
  editingAliasFor,
  aliasDraft,
  lowHashrateRestartGraceMs,
  formatRuntime,
  formatLastSeen,
  isHashrateReady,
  onOpenMinerSettings,
  onMoveCardToTop,
  onStartAliasEdit,
  onAliasDraftChange,
  onSaveAlias,
  onCancelAliasEdit,
  onRequestMinerCommandConfirm,
  onUnlockOverheatControl,
}: MinerGridSectionProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const compactCellSx = { whiteSpace: "nowrap", px: 0.75, py: 0.5, lineHeight: 1.15 };

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Box>
      {miners.length === 0 && (
        <Alert severity="info" variant="outlined" sx={{ mb: 1.25 }}>
          {t(uiLang, "no_miners_yet_start_the_agent_and_wait_for_sync")}
        </Alert>
      )}

      <Grid
        ref={gridRef}
        container
        spacing={1.25}
        alignItems="stretch"
      >
        {(() => {
          const orderedCards = [...orderedMiners.map((m) => m.minerId)].sort((a, b) => {
            const ai = minerOrder.indexOf(a);
            const bi = minerOrder.indexOf(b);
            const av = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
            const bv = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
            return av - bv;
          });

          return orderedCards.map((cardId) => {
            const miner = orderedMiners.find((m) => m.minerId === cardId);
            if (!miner) return null;
            const metric = (miner.lastMetric ?? null) as MinerMetric | null;

            const online = metric?.online;

            const control = minerControlStates[miner.minerId];
            const restartAtMs = miner.lastRestartAt ? new Date(miner.lastRestartAt).getTime() : NaN;

            const serverPendingPhase: MinerControlPhase | null =
              miner.pendingCommandType === "RESTART"
                ? "RESTARTING"
                : miner.pendingCommandType === "SLEEP"
                  ? "SLEEPING"
                  : miner.pendingCommandType === "WAKE"
                    ? "WAKING"
                    : null;

            const hasServerWarmup =
              Number.isFinite(restartAtMs) &&
              nowMs - restartAtMs < lowHashrateRestartGraceMs &&
              online === true &&
              !isHashrateReady(metric ?? null);

            const effectivePhase: MinerControlPhase | null =
              control?.phase ?? serverPendingPhase ?? (hasServerWarmup ? "WARMING_UP" : null);
            const pendingAction = pendingActionByMiner[miner.minerId];
            const minerMode = typeof metric?.minerMode === "number" ? metric.minerMode : null;
            const isSleepingLike =
              effectivePhase === "SLEEPING" ||
              minerMode === 1;
            const statusLabel = isSleepingLike
              ? t(uiLang, "sleep")
              : online === true
                ? t(uiLang, "online")
                : online === false
                  ? t(uiLang, "offline")
                  : t(uiLang, "unknown");
            const statusColor: "success" | "default" =
              online === true && !isSleepingLike ? "success" : "default";
            const statusVariant: "filled" | "outlined" =
              online === true && !isSleepingLike ? "filled" : "outlined";
            const hasOnlineBorder = online === true && !isSleepingLike;
            const hasOfflineBorder = online === false;

            const overheatLocked = miner.overheatLocked === true;

            const buttonsLocked =
              effectivePhase === "RESTARTING" ||
              effectivePhase === "WAKING" ||
              effectivePhase === "WARMING_UP";
            const hasPendingAction = Boolean(pendingAction);
            const restartDisabled = hasPendingAction || buttonsLocked || overheatLocked || online !== true || isSleepingLike;
            const sleepDisabled = hasPendingAction || buttonsLocked || online !== true || isSleepingLike;
            const wakeDisabled =
              hasPendingAction || buttonsLocked || overheatLocked || !isSleepingLike;
            const restartDisabledFinal = restartDisabled || overheatLocked;
            const restartInProgress =
              pendingAction === "RESTART" ||
              effectivePhase === "RESTARTING" ||
              (effectivePhase === "WARMING_UP" && control?.source === "RESTART");
            const wakeInProgress =
              pendingAction === "WAKE" ||
              effectivePhase === "WAKING" ||
              (effectivePhase === "WARMING_UP" &&
                (control?.source === "WAKE" || control?.source === "POWER_ON"));
            const actionButtonSx = {
              borderRadius: "8px !important",
              minWidth: 86,
              textTransform: "none",
              fontWeight: 700,
              "&.Mui-disabled": {
                bgcolor: "transparent",
                color: "#9ca3af",
                borderColor: "#d1d5db",
              },
            } as const;

            const alias = minerAliases[miner.minerId]?.trim();
            const titleText = alias || `${metric?.asicType ?? "Antminer"} ${miner.minerId}`;
            const linkedDevice = deviceById.get(tuyaBindingByMiner[miner.minerId] ?? "");
            const linkedDeviceVariant: "filled" | "outlined" =
              linkedDevice?.on === true ? "filled" : "outlined";
            const linkedDeviceColor: "success" | "default" =
              linkedDevice?.on === true ? "success" : "default";

            const chips = metric?.boardChips ?? [];
            const hwErrors = metric?.boardHwErrors ?? [];
            const freqs = metric?.boardFreqs ?? [];
            const realRates = metric?.boardHashrates ?? [];
            const idealRates = metric?.boardTheoreticalHashrates ?? [];
            const inletTemps = metric?.boardInletTemps ?? [];
            const outletTemps = metric?.boardOutletTemps ?? [];
            const fanSpeeds = metric?.fanSpeeds ?? [];

            const stateMap = new Map<number, string>();
            for (const state of metric?.boardStates ?? []) {
              const m = /^chain(\d+):(.*)$/i.exec(state);
              if (!m) continue;
              stateMap.set(Number.parseInt(m[1], 10), m[2].trim());
            }

            const boardCount = Math.max(
              chips.length,
              hwErrors.length,
              freqs.length,
              realRates.length,
              idealRates.length,
              inletTemps.length,
              outletTemps.length,
              stateMap.size,
              boardCountByMiner[miner.minerId] ?? 0,
              1,
            );

            const rows = Array.from({ length: boardCount }, (_, i) => ({
              board: i + 1,
              chips: chips[i] ?? "-",
              hw: hwErrors[i] ?? "-",
              freq: freqs[i] ?? "-",
              real: realRates[i] ?? "-",
              ideal: idealRates[i] ?? "-",
              inlet: inletTemps[i] ?? "-",
              outlet: outletTemps[i] ?? "-",
              state: stateMap.get(i) ?? "-",
            }));

            const totalHashrateGh = typeof metric?.hashrate === "number" ? (metric.hashrate / 1000).toFixed(2) : "-";
            const realtimeGh =
              metric?.hashrateRealtime ?? metric?.hashrate
                ? (metric?.hashrateRealtime ?? (metric?.hashrate ?? 0) / 1000).toFixed(2)
                : "-";
            const averageGh =
              metric?.hashrateAverage ?? metric?.hashrate
                ? (metric?.hashrateAverage ?? (metric?.hashrate ?? 0) / 1000).toFixed(2)
                : "-";

            const expectedMh = metric?.expectedHashrate;
            const currentMh = metric?.hashrate;
            const inStartupPhase =
              effectivePhase === "RESTARTING" ||
              effectivePhase === "WAKING" ||
              effectivePhase === "WARMING_UP";
            const isOffline = online === false;
            const boardHashrateAbnormalByState = rows.some((row) =>
              String(row.state).toLowerCase().includes("stateabnormal"),
            );
            const boardHashrateAbnormalByRate = rows.some((row) => {
              if (typeof row.real !== "number" || typeof row.ideal !== "number") return false;
              if (row.ideal <= 0) return false;
              return row.real < row.ideal * 0.9;
            });
            const networkNormal = isOffline
              ? null
              : inStartupPhase
                ? null
              : online === true
                ? (metric?.boardStates?.some((s) => s.toLowerCase().includes("network:ok")) ?? true)
                : null;
            const fanNormal = isOffline || inStartupPhase ? null : (metric?.fan ?? 0) > 1000;
            const tempNormal = isOffline || inStartupPhase ? null : (metric?.temp ?? 0) > 0 && (metric?.temp ?? 0) < 82;
            const hashrateNormal = isOffline
              ? null
              : inStartupPhase
                ? null
              : boardHashrateAbnormalByState || boardHashrateAbnormalByRate
                ? false
              : typeof expectedMh === "number" && expectedMh > 0 && typeof currentMh === "number"
                ? currentMh >= expectedMh * 0.9
                : true;

            return (
              <Grid key={miner.minerId} size={{ xs: 12, lg: 4 }} sx={{ display: "flex" }}>
                <Paper
                  sx={{
                    p: 1.1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    flex: 1,
                    height: "100%",
                    borderStyle: "solid",
                    borderWidth: 1,
                    borderColor: (theme) =>
                      hasOnlineBorder
                        ? theme.palette.success.main
                        : hasOfflineBorder
                          ? theme.palette.grey[600]
                          : theme.palette.grey[500],
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box minWidth={0} flex={1}>
                      {editingAliasFor === miner.minerId ? (
                        <Stack direction="row" spacing={0.6} alignItems="center">
                          <TextField
                            value={aliasDraft}
                            onChange={(e) => onAliasDraftChange(e.target.value)}
                            placeholder={`${metric?.asicType ?? "Antminer"} ${miner.minerId}`}
                            size="small"
                            fullWidth
                          />
                          <Button size="small" color="success" onClick={() => onSaveAlias(miner.minerId)}>Save</Button>
                          <Button size="small" variant="outlined" color="inherit" onClick={onCancelAliasEdit}>Cancel</Button>
                        </Stack>
                      ) : (
                        <Stack spacing={0.35}>
                          <Stack
                            direction="row"
                            spacing={0.7}
                            alignItems="center"
                            minWidth={0}
                            flexWrap="nowrap"
                            sx={{ overflow: "hidden" }}
                          >
                            {linkedDevice ? (
                              <Chip
                                size="small"
                                color={linkedDeviceColor}
                                variant={linkedDeviceVariant}
                                label={linkedDevice.name}
                                title={linkedDevice.name}
                                sx={{
                                  maxWidth: 220,
                                  borderWidth: linkedDevice?.on === false ? 2 : undefined,
                                  "& .MuiChip-label": {
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontWeight: 700,
                                  },
                                }}
                              />
                            ) : null}
                            <Chip
                              label={statusLabel}
                              size="small"
                              color={statusColor}
                              variant={statusVariant}
                              sx={{
                                borderWidth:
                                  statusLabel === t(uiLang, "offline") ? 2 : undefined,
                                fontWeight: 700,
                              }}
                            />
                            <Stack direction="row" spacing={0.2} alignItems="center" sx={{ minWidth: 0, flexShrink: 1, maxWidth: "100%" }}>
                              <Typography
                                variant="subtitle1"
                                fontWeight={800}
                                noWrap
                                title={titleText}
                                sx={{ minWidth: 0 }}
                              >
                                {titleText}
                              </Typography>
                              <Tooltip title="Rename">
                                <IconButton
                                  size="small"
                                  color="inherit"
                                  sx={{ p: 0.35 }}
                                  onClick={() => onStartAliasEdit(miner.minerId, alias || "")}
                                >
                                  <EditRoundedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </Stack>
                        </Stack>
                      )}
                    </Box>

                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Miner settings">
                        <IconButton color="primary" size="small" onClick={() => onOpenMinerSettings(miner.minerId)}>
                          {settingsIcon}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Move to top">
                        <IconButton color="primary" size="small" onClick={() => onMoveCardToTop(miner.minerId)}>
                          <KeyboardArrowUpRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                    {overheatLocked ? (
                      <Chip
                        label={`${t(uiLang, "locked")} ${typeof miner.overheatLastTempC === "number" ? `(${miner.overheatLastTempC.toFixed(1)}C)` : ""}`}
                        size="small"
                        color="error"
                      />
                    ) : null}
                  </Stack>

                  <Box
                    sx={{
                      display: "grid",
                      gap: 0.6,
                      gridTemplateColumns: statusBadgesVertical
                        ? "minmax(0, 1fr)"
                        : "repeat(4, minmax(0, 1fr))",
                    }}
                  >
                    {[
                      { label: t(uiLang, "hashrate"), ok: hashrateNormal },
                      { label: t(uiLang, "network"), ok: networkNormal },
                      { label: t(uiLang, "fan"), ok: fanNormal },
                      { label: t(uiLang, "temp"), ok: tempNormal },
                    ].map((item) => (
                      <Chip
                        key={`${miner.minerId}-${item.label}`}
                        label={`${item.label}: ${item.ok === null ? "-" : item.ok ? "OK" : t(uiLang, "warn")}`}
                        size="small"
                        color={item.ok === null ? "default" : item.ok ? "success" : "warning"}
                        variant="outlined"
                        sx={{
                          width: "100%",
                          borderWidth: hasOnlineBorder ? 1 : item.ok === null ? 1 : 2,
                          borderColor: (theme) =>
                            item.ok === true ? theme.palette.success.main : theme.palette.grey[600],
                        }}
                      />
                    ))}
                  </Box>

                  <Grid container spacing={0.8} alignItems="stretch">
                    <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex" }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.35,
                          borderRadius: 2,
                          height: "100%",
                          width: "100%",
                          borderWidth: hasOnlineBorder ? 1 : hasOfflineBorder ? 1 : 2,
                          borderColor: (theme) =>
                            hasOnlineBorder
                              ? theme.palette.success.main
                              : hasOfflineBorder
                                ? theme.palette.grey[600]
                                : theme.palette.grey[500],
                        }}
                      >
                        <Stack spacing={0.6}>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "real_time")}</Typography>
                          <Typography variant="h5" fontWeight={800}>{realtimeGh} <Typography component="span" variant="body2">GH/s</Typography></Typography>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "average")}: {averageGh} GH/s</Typography>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "reject")}: {typeof metric?.poolRejectionRate === "number" ? `${metric.poolRejectionRate.toFixed(2)}%` : "-"}</Typography>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "uptime")}: {formatRuntime(metric?.runtimeSeconds)}</Typography>
                        </Stack>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex" }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.35,
                          borderRadius: 2,
                          height: "100%",
                          width: "100%",
                          borderWidth: hasOnlineBorder ? 1 : hasOfflineBorder ? 1 : 2,
                          borderColor: (theme) =>
                            hasOnlineBorder
                              ? theme.palette.success.main
                              : hasOfflineBorder
                                ? theme.palette.grey[600]
                                : theme.palette.grey[500],
                        }}
                      >
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                          {t(uiLang, "chains_rate")}
                        </Typography>
                        {realRates.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            {t(uiLang, "no_data_yet_data_is_currently_unavailable")}
                          </Typography>
                        ) : (
                          <Stack spacing={0.5}>
                            {realRates.map((rate, i) => {
                              const percent = Math.max(
                                0,
                                Math.min(100, ((Number(rate) || 0) / (Number(idealRates[i]) || Number(rate) || 1)) * 100),
                              );
                              return (
                                <Box key={`${miner.minerId}-chain-rate-${i}`}>
                                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption">{t(uiLang, "chain")} {i + 1}</Typography>
                                    <Typography variant="caption" color="success.main">{typeof rate === "number" ? `${rate} GH/s` : "-"}</Typography>
                                  </Stack>
                                  <LinearProgress variant="determinate" value={percent} sx={{ height: 7, borderRadius: 999 }} />
                                </Box>
                              );
                            })}
                          </Stack>
                        )}
                      </Paper>
                    </Grid>
                  </Grid>

                  <TableContainer sx={{ overflowY: "visible", overflowX: "auto", flex: 1, minHeight: 0 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={compactCellSx}>{t(uiLang, "bd")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "chip")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>HW</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "frq")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "real")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "theo")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "in")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "out")}</TableCell>
                          <TableCell align="center" sx={compactCellSx}>{t(uiLang, "st")}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={`${miner.minerId}-board-${row.board}`} hover>
                            <TableCell sx={compactCellSx}>{row.board}</TableCell>
                            <TableCell align="center" sx={compactCellSx}>{row.chips}</TableCell>
                            <TableCell align="center" sx={compactCellSx}>{row.hw}</TableCell>
                            <TableCell align="center" sx={compactCellSx}>{row.freq}</TableCell>
                            <TableCell
                              align="center"
                              sx={{
                                ...compactCellSx,
                                color:
                                  typeof row.real === "number" &&
                                  typeof row.ideal === "number" &&
                                  row.ideal > 0 &&
                                  row.real < row.ideal * 0.9
                                    ? "warning.main"
                                    : "success.main",
                                fontWeight: 700,
                              }}
                            >
                              {typeof row.real === "number" ? `${row.real} GH/s` : row.real}
                            </TableCell>
                            <TableCell align="center" sx={compactCellSx}>{typeof row.ideal === "number" ? `${row.ideal} GH/s` : row.ideal}</TableCell>
                            <TableCell align="center" sx={compactCellSx}>{row.inlet}</TableCell>
                            <TableCell align="center" sx={compactCellSx}>{row.outlet}</TableCell>
                            <TableCell
                              align="center"
                              sx={{
                                ...compactCellSx,
                                color: String(row.state).toLowerCase().includes("stateabnormal")
                                  ? "warning.main"
                                  : "inherit",
                                fontWeight: String(row.state).toLowerCase().includes("stateabnormal")
                                  ? 700
                                  : undefined,
                              }}
                            >
                              {String(row.state).toUpperCase() === "OK" ? t(uiLang, "normal") : row.state}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t(uiLang, "fan_2")}</TableCell>
                          {Array.from({ length: Math.max(fanSpeeds.length, 4) }, (_, i) => (
                            <TableCell key={`${miner.minerId}-fan-h-${i}`} align="center">F{i + 1}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>{t(uiLang, "rpm")}</TableCell>
                          {Array.from({ length: Math.max(fanSpeeds.length, 4) }, (_, i) => (
                            <TableCell key={`${miner.minerId}-fan-v-${i}`} align="center">{fanSpeeds[i] ?? "-"}</TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="flex-end"
                    spacing={1}
                    sx={{ width: "100%" }}
                  >
                    <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ ml: "auto", flexShrink: 0, justifyContent: "flex-end" }}>
                      <Button
                        size="small"
                        variant={restartDisabledFinal ? "outlined" : "contained"}
                        color="primary"
                        disabled={restartDisabledFinal}
                        sx={actionButtonSx}
                        title={overheatLocked ? "Overheat lock is active. Unlock control first." : undefined}
                        onClick={() => onRequestMinerCommandConfirm(miner.minerId, "RESTART")}
                        startIcon={restartInProgress ? <ButtonSpinnerIcon color={restartDisabledFinal ? "#94a3b8" : "currentColor"} /> : null}
                      >
                        {t(uiLang, "restart")}
                      </Button>
                      <Button
                        size="small"
                        variant={sleepDisabled ? "outlined" : "contained"}
                        color="inherit"
                        disabled={sleepDisabled}
                        sx={actionButtonSx}
                        onClick={() => onRequestMinerCommandConfirm(miner.minerId, "SLEEP")}
                        startIcon={pendingAction === "SLEEP" ? <ButtonSpinnerIcon color={sleepDisabled ? "#9ca3af" : "currentColor"} /> : null}
                      >
                        {t(uiLang, "sleep")}
                      </Button>
                      <Button
                        size="small"
                        variant={wakeDisabled ? "outlined" : "contained"}
                        color="success"
                        disabled={wakeDisabled}
                        sx={actionButtonSx}
                        title={overheatLocked ? "Overheat lock is active. Unlock control first." : undefined}
                        onClick={() => onRequestMinerCommandConfirm(miner.minerId, "WAKE")}
                        startIcon={wakeInProgress ? <ButtonSpinnerIcon color={wakeDisabled ? "#9ca3af" : "currentColor"} /> : null}
                      >
                        {t(uiLang, "wake")}
                      </Button>
                      {overheatLocked ? (
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={() => onUnlockOverheatControl(miner.minerId)}
                        >
                          Unlock control
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>
            );
          });
        })()}
      </Grid>
    </Box>
  );
}
