import {
  CommandType,
  MinerControlPhase,
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

    if (now - current.since > CONTROL_ACTION_LOCK_MS * 6) {
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
