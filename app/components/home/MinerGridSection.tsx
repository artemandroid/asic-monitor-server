"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
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
            const statusLabel =
              online === true
                ? t(uiLang, "online")
                : online === false
                  ? t(uiLang, "offline")
                  : t(uiLang, "unknown");
            const statusColor = online === true ? "success" : online === false ? "error" : "default";

            const control = minerControlStates[miner.minerId];
            const controlAgeSec = control ? Math.max(0, Math.floor((nowMs - control.since) / 1000)) : 0;
            const controlAgeMin = Math.floor(controlAgeSec / 60);
            const controlAgeRemSec = controlAgeSec % 60;
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

            const overheatLocked = miner.overheatLocked === true;
            const controlText =
              overheatLocked
                ? t(uiLang, "overheat_lock_active")
                : effectivePhase === "RESTARTING"
                ? t(uiLang, "restarting")
                : effectivePhase === "SLEEPING"
                  ? t(uiLang, "sleeping")
                  : effectivePhase === "WAKING"
                    ? t(uiLang, "waking")
                    : effectivePhase === "WARMING_UP"
                      ? t(uiLang, "warm_up_after_restart_wake")
                      : null;

            const buttonsLocked =
              effectivePhase === "RESTARTING" ||
              effectivePhase === "WAKING" ||
              effectivePhase === "WARMING_UP";

            const pendingAction = pendingActionByMiner[miner.minerId];
            const hasPendingAction = Boolean(pendingAction);
            const restartDisabled = hasPendingAction || buttonsLocked || effectivePhase === "SLEEPING";
            const sleepDisabled = hasPendingAction || buttonsLocked || effectivePhase === "SLEEPING";
            const wakeDisabled = hasPendingAction || buttonsLocked || overheatLocked;
            const restartDisabledFinal = restartDisabled || overheatLocked;
            const restartInProgress =
              pendingAction === "RESTART" ||
              effectivePhase === "RESTARTING" ||
              effectivePhase === "WARMING_UP";

            const alias = minerAliases[miner.minerId]?.trim();
            const titleText = alias || `${metric?.asicType ?? "Antminer"} ${miner.minerId}`;
            const linkedDevice = deviceById.get(tuyaBindingByMiner[miner.minerId] ?? "");

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
            const networkNormal =
              online === true &&
              (metric?.boardStates?.some((s) => s.toLowerCase().includes("network:ok")) ?? true);
            const fanNormal = (metric?.fan ?? 0) > 1000;
            const tempNormal = (metric?.temp ?? 0) > 0 && (metric?.temp ?? 0) < 80;
            const hashrateNormal =
              typeof expectedMh === "number" && expectedMh > 0 && typeof currentMh === "number"
                ? currentMh >= expectedMh * 0.9
                : true;

            return (
              <Grid key={miner.minerId} size={{ xs: 12, lg: 4 }}>
                <Paper sx={{ p: 1.1, display: "grid", gap: 1 }}>
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
                          <Stack direction="row" spacing={0.5} alignItems="center" minWidth={0}>
                            <Typography variant="subtitle1" fontWeight={800} noWrap title={titleText}>
                              {titleText}
                            </Typography>
                            <Tooltip title="Rename">
                              <IconButton size="small" color="inherit" onClick={() => onStartAliasEdit(miner.minerId, alias || "")}> 
                                <EditRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                          {linkedDevice ? (
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {t(uiLang, "automat")}: {linkedDevice.name} [{linkedDevice.on === null ? "?" : linkedDevice.on ? onText : offText}]
                            </Typography>
                          ) : null}
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
                          <ArrowUpwardRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                    <Chip
                      label={statusLabel}
                      size="small"
                      color={statusColor === "default" ? "default" : statusColor}
                      variant={statusColor === "default" ? "outlined" : "filled"}
                    />
                    {controlText ? (
                      <Chip
                        label={`${controlText} (${controlAgeMin}m ${controlAgeRemSec}s)`}
                        size="small"
                        color={overheatLocked ? "error" : "warning"}
                        variant="outlined"
                      />
                    ) : null}
                    <Chip label={`${totalHashrateGh} GH/s`} size="small" variant="outlined" />
                    <Chip label={formatLastSeen(miner.lastSeen)} size="small" variant="outlined" />
                    {overheatLocked ? (
                      <Chip
                        label={`${t(uiLang, "locked")} ${typeof miner.overheatLastTempC === "number" ? `(${miner.overheatLastTempC.toFixed(1)}C)` : ""}`}
                        size="small"
                        color="error"
                      />
                    ) : null}
                  </Stack>

                  <Stack
                    direction={statusBadgesVertical ? "column" : "row"}
                    spacing={0.6}
                    flexWrap="wrap"
                  >
                    {[
                      { label: t(uiLang, "hashrate"), ok: hashrateNormal },
                      { label: t(uiLang, "network"), ok: networkNormal },
                      { label: t(uiLang, "fan"), ok: fanNormal },
                      { label: t(uiLang, "temp"), ok: tempNormal },
                    ].map((item) => (
                      <Chip
                        key={`${miner.minerId}-${item.label}`}
                        label={`${item.label}: ${item.ok ? "OK" : t(uiLang, "warn")}`}
                        size="small"
                        color={item.ok ? "success" : "warning"}
                        variant="outlined"
                      />
                    ))}
                  </Stack>

                  <Grid container spacing={0.8}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Paper variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
                        <Stack spacing={0.6}>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "real_time")}</Typography>
                          <Typography variant="h5" fontWeight={800}>{realtimeGh} <Typography component="span" variant="body2">GH/s</Typography></Typography>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "average")}: {averageGh} GH/s</Typography>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "reject")}: {typeof metric?.poolRejectionRate === "number" ? `${metric.poolRejectionRate.toFixed(2)}%` : "-"}</Typography>
                          <Typography variant="caption" color="text.secondary">{t(uiLang, "uptime")}: {formatRuntime(metric?.runtimeSeconds)}</Typography>
                        </Stack>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Paper variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
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

                  <TableContainer sx={{ maxHeight: 170 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t(uiLang, "bd")}</TableCell>
                          <TableCell align="center">{t(uiLang, "chip")}</TableCell>
                          <TableCell align="center">HW</TableCell>
                          <TableCell align="center">{t(uiLang, "frq")}</TableCell>
                          <TableCell align="center">{t(uiLang, "real")}</TableCell>
                          <TableCell align="center">{t(uiLang, "theo")}</TableCell>
                          <TableCell align="center">{t(uiLang, "in")}</TableCell>
                          <TableCell align="center">{t(uiLang, "out")}</TableCell>
                          <TableCell align="center">{t(uiLang, "st")}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={`${miner.minerId}-board-${row.board}`} hover>
                            <TableCell>{row.board}</TableCell>
                            <TableCell align="center">{row.chips}</TableCell>
                            <TableCell align="center">{row.hw}</TableCell>
                            <TableCell align="center">{row.freq}</TableCell>
                            <TableCell align="center" sx={{ color: "success.main", fontWeight: 700 }}>
                              {typeof row.real === "number" ? `${row.real} GH/s` : row.real}
                            </TableCell>
                            <TableCell align="center">{typeof row.ideal === "number" ? `${row.ideal} GH/s` : row.ideal}</TableCell>
                            <TableCell align="center">{row.inlet}</TableCell>
                            <TableCell align="center">{row.outlet}</TableCell>
                            <TableCell align="center">
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

                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Stack direction="row" spacing={0.6} flexWrap="wrap">
                      <Button
                        size="small"
                        variant={restartDisabledFinal ? "outlined" : "contained"}
                        color="primary"
                        disabled={restartDisabledFinal}
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
                        title={overheatLocked ? "Overheat lock is active. Unlock control first." : undefined}
                        onClick={() => onRequestMinerCommandConfirm(miner.minerId, "WAKE")}
                        startIcon={pendingAction === "WAKE" ? <ButtonSpinnerIcon color={wakeDisabled ? "#9ca3af" : "currentColor"} /> : null}
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

                    {metric?.error ? (
                      <Tooltip title={metric.error}>
                        <Typography variant="caption" color="error.main" sx={{ fontWeight: 700, cursor: "help" }}>
                          {t(uiLang, "error")}
                        </Typography>
                      </Tooltip>
                    ) : null}
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
