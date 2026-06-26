import {
  CommandStatus,
  CommandType,
  ControlMode,
  MinerControlPhase,
  MinerStatus,
  type MinerControlState,
  type MinerState,
} from "@/app/lib/types";
import { CONTROL_ACTION_LOCK_MS } from "@/app/lib/constants";

export function extractBoardCount(metric: unknown): number {
  if (!metric || typeof metric !== "object") return 0;
  const m = metric as {
    boardChips?: unknown[];
    boardHwErrors?: unknown[];
    boardFreqs?: unknown[];
    boardHashrates?: unknown[];
    boardTheoreticalHashrates?: unknown[];
    boardInletTemps?: unknown[];
    boardOutletTemps?: unknown[];
    boardStates?: unknown[];
  };

  const chainIndexMax = Array.isArray(m.boardStates)
    ? m.boardStates.reduce<number>((max, state) => {
        if (typeof state !== "string") return max;
        const hit = /^chain(\d+):/i.exec(state.trim());
        if (!hit) return max;
        const idx = Number.parseInt(hit[1], 10);
        return Number.isFinite(idx) ? Math.max(max, idx + 1) : max;
      }, 0)
    : 0;

  return Math.max(
    Array.isArray(m.boardChips) ? m.boardChips.length : 0,
    Array.isArray(m.boardHwErrors) ? m.boardHwErrors.length : 0,
    Array.isArray(m.boardFreqs) ? m.boardFreqs.length : 0,
    Array.isArray(m.boardHashrates) ? m.boardHashrates.length : 0,
    Array.isArray(m.boardTheoreticalHashrates) ? m.boardTheoreticalHashrates.length : 0,
    Array.isArray(m.boardInletTemps) ? m.boardInletTemps.length : 0,
    Array.isArray(m.boardOutletTemps) ? m.boardOutletTemps.length : 0,
    chainIndexMax,
  );
}

export function normalizeDeyeStationAutomatBindings(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const next: Record<string, string[]> = {};
  for (const [stationKeyRaw, deviceIdsRaw] of Object.entries(value as Record<string, unknown>)) {
    const stationNum = Number.parseInt(stationKeyRaw, 10);
    if (!Number.isFinite(stationNum) || stationNum <= 0 || !Array.isArray(deviceIdsRaw)) continue;
    const unique = new Set<string>();
    for (const item of deviceIdsRaw) {
      if (typeof item !== "string") continue;
      const normalized = item.trim();
      if (!normalized) continue;
      unique.add(normalized);
    }
    if (unique.size > 0) {
      next[String(Math.trunc(stationNum))] = [...unique];
    }
  }
  return next;
}

type HashrateMetric = {
  expectedHashrate?: number;
  hashrate?: number;
  hashrateRealtime?: number;
  online?: boolean;
} | null;

export function isHashrateReady(metric: HashrateMetric): boolean {
  if (!metric || metric.online !== true) return false;
  if (typeof metric.expectedHashrate !== "number" || metric.expectedHashrate <= 0) {
    return false;
  }
  if (typeof metric.hashrateRealtime !== "number") {
    return false;
  }
  const realtimeMh =
    metric.hashrateRealtime > 500 ? metric.hashrateRealtime : metric.hashrateRealtime * 1000;
  return realtimeMh >= metric.expectedHashrate * 0.9;
}

type SleepMetric = {
  expectedHashrate?: number;
  hashrate?: number;
  hashrateRealtime?: number;
  minerMode?: number;
  online?: boolean;
} | null;

export function isSleepingState(metric: SleepMetric): boolean {
  if (!metric) return false;
  return metric.minerMode === 1;
}

type SleepLikeMetric = {
  minerMode?: number;
  online?: boolean;
  runtimeSeconds?: number;
  boardHashrates?: unknown[];
  boardFreqs?: unknown[];
} | null;

/**
 * Broader sleep detection than {@link isSleepingState}: covers firmwares that do
 * not report `minerMode` but go to zero hashrate / zero frequency / zero uptime
 * while paused.
 */
export function isSleepingLike(metric: SleepLikeMetric): boolean {
  if (!metric) return false;
  if (metric.minerMode === 1) return true;
  if (metric.online !== true) return false;
  const zeroRuntime =
    typeof metric.runtimeSeconds === "number" &&
    Number.isFinite(metric.runtimeSeconds) &&
    metric.runtimeSeconds <= 0;
  const allZero = (arr: unknown[] | undefined) =>
    Array.isArray(arr) &&
    arr.length > 0 &&
    arr.every((v) => typeof v === "number" && Number.isFinite(v) && v <= 0);
  const zeroBoards = allZero(metric.boardHashrates) && allZero(metric.boardFreqs);
  return zeroRuntime || zeroBoards;
}

export function computeNextControlStates(
  prev: Record<string, MinerControlState>,
  data: MinerState[],
): Record<string, MinerControlState> {
  const next: Record<string, MinerControlState> = {};
  const now = Date.now();
  let changed = false;

  for (const miner of data) {
    const current = prev[miner.minerId];
    if (!current) continue;
    const metric = miner.lastMetric as (HashrateMetric & SleepMetric) | null;
    const online = metric?.online === true;
    const ready = isHashrateReady(metric);
    const sleeping = isSleepingState(metric);
    const hasPendingServerCommand =
      miner.pendingCommandType === CommandType.RESTART ||
      miner.pendingCommandType === CommandType.SLEEP ||
      miner.pendingCommandType === CommandType.WAKE;

    if (!hasPendingServerCommand && online && !sleeping) {
      if (
        current.phase === MinerControlPhase.RESTARTING ||
        current.phase === MinerControlPhase.WAKING ||
        current.phase === MinerControlPhase.WARMING_UP ||
        current.phase === MinerControlPhase.SLEEPING
      ) {
        changed = true;
        continue;
      }
    }

    // SLEEPING is a durable state and may last hours; do not expire it by transient UI lock timeout.
    if (current.phase !== MinerControlPhase.SLEEPING && now - current.since > CONTROL_ACTION_LOCK_MS * 6) {
      changed = true;
      continue;
    }

    if (current.phase === MinerControlPhase.RESTARTING) {
      if (!online) {
        changed = true;
        continue;
      }
      if (online && !ready) {
        next[miner.minerId] = {
          phase: MinerControlPhase.WARMING_UP,
          since: current.since,
          source: current.source,
        };
        changed = true;
        continue;
      }
      if (ready) {
        changed = true;
        continue;
      }
      next[miner.minerId] = current;
      continue;
    }

    if (current.phase === MinerControlPhase.WAKING) {
      if (!online) {
        changed = true;
        continue;
      }
      if (online && !ready) {
        next[miner.minerId] = {
          phase: MinerControlPhase.WARMING_UP,
          since: current.since,
          source: current.source,
        };
        changed = true;
        continue;
      }
      if (ready) {
        changed = true;
        continue;
      }
      next[miner.minerId] = current;
      continue;
    }

    if (current.phase === MinerControlPhase.WARMING_UP) {
      if (!online) {
        changed = true;
        continue;
      }
      if (ready) {
        changed = true;
        continue;
      }
      next[miner.minerId] = current;
      continue;
    }

    if (current.phase === MinerControlPhase.SLEEPING) {
      // Keep SLEEPING while miner is offline; many firmwares report sleep as offline.
      if (online !== true) {
        next[miner.minerId] = current;
        continue;
      }
      if (!sleeping) {
        changed = true;
        continue;
      }
      next[miner.minerId] = current;
      continue;
    }
  }

  for (const miner of data) {
    if (!(miner.minerId in next) && prev[miner.minerId]) {
      changed = true;
    }
  }

  return changed ? next : prev;
}

/**
 * Window during which a completed (DONE) command is still considered "in progress"
 * while the miner reboots / warms up to its target hashrate. Mirrors the control
 * state expiry in {@link computeNextControlStates}.
 */
const RECENT_COMMAND_WINDOW_MS = CONTROL_ACTION_LOCK_MS * 6;

/**
 * Single source of truth for a miner's high-level status. Every card element
 * (status chip, control buttons, hashrate visibility, spinners) should read from
 * this so all of them flip together at the same transition instead of drifting.
 *
 * Priority, highest first:
 *  1. Hard locks (`MANUAL_OFF`, `OVERHEAT_LOCKED`) — they also block commands.
 *  2. Optimistic in-flight click (`pendingAction`) — instant feedback before the
 *     server round-trip completes.
 *  3. Server-side PENDING command (`pendingCommandType`) — server has it but the
 *     ASIC has not executed it yet → `*_REQUESTED`.
 *  4. Confirmed paused (telemetry sleep or local SLEEPING bridge) → `PAUSED`.
 *  5. Last command executed (`lastCommand` DONE) but target not reached yet →
 *     `RESTART_IN_PROGRESS` / `WAKING_UP`.
 *  6. Steady metric states (`NORMAL` / `OFFLINE` / `NO_ACCESS` / `UNKNOWN`).
 */
export function deriveMinerStatus(
  miner: MinerState,
  control: MinerControlState | undefined,
  pendingAction: CommandType | undefined,
  now: number,
): MinerStatus {
  const metric = miner.lastMetric as
    | {
        online?: boolean;
        minerMode?: number;
        expectedHashrate?: number;
        hashrate?: number;
        hashrateRealtime?: number;
        readStatus?: string;
        runtimeSeconds?: number;
        boardHashrates?: unknown[];
        boardFreqs?: unknown[];
      }
    | null;

  const online = metric?.online === true;
  const offline = metric?.online === false;
  const ready = isHashrateReady(metric);
  const sleeping = isSleepingLike(metric);
  const readStatus = metric?.readStatus;

  // 1. Hard locks.
  if (miner.manualPowerHold === true) return MinerStatus.MANUAL_OFF;
  if (miner.overheatLocked === true) return MinerStatus.OVERHEAT_LOCKED;

  // 2. Optimistic in-flight click (UI -> our server, not yet acknowledged).
  if (pendingAction === CommandType.SLEEP) return MinerStatus.PAUSE_REQUESTED;
  if (pendingAction === CommandType.WAKE) return MinerStatus.WAKE_REQUESTED;
  if (pendingAction === CommandType.RESTART) return MinerStatus.RESTART_REQUESTED;

  // 3. Server holds a PENDING command — reached our server, not yet the ASIC.
  if (miner.pendingCommandType === CommandType.SLEEP) return MinerStatus.PAUSE_REQUESTED;
  if (miner.pendingCommandType === CommandType.WAKE) return MinerStatus.WAKE_REQUESTED;
  if (miner.pendingCommandType === CommandType.RESTART) return MinerStatus.RESTART_REQUESTED;

  // 4. Confirmed paused. Trust telemetry, with the local SLEEPING phase as a
  //    bridge for firmwares that report nothing / offline while asleep.
  if (sleeping) return MinerStatus.PAUSED;
  if (control?.phase === MinerControlPhase.SLEEPING && !ready) return MinerStatus.PAUSED;

  // 5. Last command was executed on the ASIC (PENDING -> DONE) but the miner has
  //    not reached its target yet → distinct *_IN_PROGRESS / WAKING_UP states.
  //    Two gates avoid false positives from later transient hashrate dips:
  //     - offline reboot: only for a short window right after execution;
  //     - online warm-up: gated by the local control phase, which clears once the
  //       miner becomes ready, so a dip an hour later is plain NORMAL, not RESTART.
  const last = miner.lastCommand;
  if (last && last.status === CommandStatus.DONE && !ready) {
    const ts = last.executedAt ?? last.createdAt;
    const ageMs = ts ? now - Date.parse(ts) : Number.POSITIVE_INFINITY;
    const controlRestart =
      control?.phase === MinerControlPhase.RESTARTING ||
      (control?.phase === MinerControlPhase.WARMING_UP && control.source === "RESTART");
    const controlWake =
      control?.phase === MinerControlPhase.WAKING ||
      (control?.phase === MinerControlPhase.WARMING_UP &&
        (control.source === "WAKE" || control.source === "POWER_ON"));
    if (!online && ageMs < CONTROL_ACTION_LOCK_MS) {
      if (last.type === CommandType.RESTART) return MinerStatus.RESTART_IN_PROGRESS;
      if (last.type === CommandType.WAKE) return MinerStatus.WAKING_UP;
    }
    if (online && ageMs < RECENT_COMMAND_WINDOW_MS) {
      if (last.type === CommandType.RESTART && controlRestart) return MinerStatus.RESTART_IN_PROGRESS;
      if (last.type === CommandType.WAKE && controlWake) return MinerStatus.WAKING_UP;
    }
  }

  // 6. Steady metric states.
  if (online) return MinerStatus.NORMAL; // low hashrate is surfaced via chips, not a transition state
  if (offline) {
    if (readStatus === "FAILED" || readStatus === "OFFLINE") return MinerStatus.NO_ACCESS;
    return MinerStatus.OFFLINE;
  }
  return MinerStatus.UNKNOWN;
}

/**
 * The control-mode axis (who may drive the miner) — orthogonal to {@link MinerStatus}.
 * Single place that fixes the precedence of the persisted hold flags so it stops
 * being scattered across inline boolean checks. Power-automation reads the raw
 * flags; the UI composes this with the lifecycle status.
 */
export function deriveControlMode(miner: {
  manualPowerHold?: boolean;
  overheatLocked?: boolean;
  manualPauseHold?: boolean;
}): ControlMode {
  if (miner.manualPowerHold === true) return ControlMode.MANUAL_OFF;
  if (miner.overheatLocked === true) return ControlMode.OVERHEAT_HOLD;
  if (miner.manualPauseHold === true) return ControlMode.MANUAL_PAUSE;
  return ControlMode.AUTO;
}

/** True while a control command is being requested or executed (buttons should lock). */
export function isBusyStatus(status: MinerStatus): boolean {
  return (
    status === MinerStatus.PAUSE_REQUESTED ||
    status === MinerStatus.WAKE_REQUESTED ||
    status === MinerStatus.RESTART_REQUESTED ||
    status === MinerStatus.RESTART_IN_PROGRESS ||
    status === MinerStatus.WAKING_UP
  );
}
