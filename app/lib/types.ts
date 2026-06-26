export type MinerMetric = {
  minerId: string;
  timestamp: string;
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
  ip?: string;
  asicType?: string;
  firmware?: string;
  firmwareFamily?: string;
  authType?: string;
  expectedHashrate?: number;
  online?: boolean;
  readStatus?: ReadStatus;
  error?: string;
};

export type LastCommand = {
  type: CommandType;
  status: CommandStatus;
  executedAt?: string | null;
  createdAt: string;
};

export type MinerState = {
  minerId: string;
  lastSeen: string | null;
  lastRestartAt?: string | null;
  pendingCommandType?: CommandType | null;
  lastCommand?: LastCommand | null;
  autoRestartEnabled?: boolean;
  postRestartGraceMinutes?: number;
  lowHashrateThresholdGh?: number | null;
  autoPowerOnGridRestore?: boolean;
  autoPowerOffGridLoss?: boolean;
  boundTuyaDeviceId?: string | null;
  autoPowerOffGenerationBelowKw?: number | null;
  autoPowerOnGenerationAboveKw?: number | null;
  autoPowerOnWhenGenerationCoversConsumption?: boolean;
  autoPowerOffBatteryBelowPercent?: number | null;
  autoPowerOnBatteryAbovePercent?: number | null;
  autoPowerRestoreDelayMinutes?: number;
  overheatProtectionEnabled?: boolean;
  overheatShutdownTempC?: number | null;
  overheatSleepMinutes?: number | null;
  overheatLocked?: boolean;
  overheatLockedAt?: string | null;
  overheatLastTempC?: number | null;
  manualPowerHold?: boolean;
  manualPauseHold?: boolean;
  expectedHashrate?: number | null;
  lastMetric: MinerMetric | null;
};

export enum CommandType {
  RESTART = "RESTART",
  SLEEP = "SLEEP",
  WAKE = "WAKE",
  RELOAD_CONFIG = "RELOAD_CONFIG",
}

export enum CommandStatus {
  PENDING = "PENDING",
  DONE = "DONE",
  FAILED = "FAILED",
}

export enum ReadStatus {
  OK = "OK",
  FAILED = "FAILED",
  DUMMY = "DUMMY",
  OFFLINE = "OFFLINE",
}

export type Command = {
  id: string;
  minerId: string;
  type: CommandType;
  status: CommandStatus;
  createdAt: string;
  executedAt?: string;
  error?: string;
};

export type Settings = {
  autoRestartEnabled: boolean;
  minerSyncIntervalSec: number;
  deyeSyncIntervalSec: number;
  tuyaSyncIntervalSec: number;
  restartDelayMinutes: number;
  postRestartGraceMinutes: number;
  lowHashrateThresholdGh: number;
  hashrateDeviationPercent: number;
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
  notificationVisibleCount: number;
  criticalBatteryOffPercent: number;
  useNetMeteringForGreenTariff: boolean;
  miningStartDate: string | null;
  protectiveSleepMinutes: number;
  overheatAction: string;
  pauseReactOverheat: boolean;
  pauseReactLowHashrate: boolean;
  pauseReactBatteryDischarge: boolean;
};

/** Reason a miner was put through the staged protective shutdown. */
export enum ProtectiveShutdownReason {
  OVERHEAT = "OVERHEAT",
  CRITICAL_BATTERY = "CRITICAL_BATTERY",
  GRID_LOSS = "GRID_LOSS",
  BATTERY_THRESHOLD = "BATTERY_THRESHOLD",
}

/** Stage of the staged protective shutdown. */
export enum ProtectiveShutdownPhase {
  SLEEPING = "SLEEPING",
  OFF = "OFF",
}

/** What automation does when a miner overheats. */
export enum OverheatAction {
  NAP = "NAP",
  SHUTDOWN = "SHUTDOWN",
}

export type Notification = {
  id: string;
  type: string;
  message: string;
  minerId?: string;
  action?: string;
  createdAt: string;
};

export enum MinerControlPhase {
  RESTARTING = "RESTARTING",
  SLEEPING = "SLEEPING",
  WAKING = "WAKING",
  WARMING_UP = "WARMING_UP",
}

export type MinerControlState = {
  phase: MinerControlPhase;
  since: number;
  source?: "RESTART" | "WAKE" | "POWER_ON";
};

/**
 * Single source of truth for what a miner card shows.
 *
 * `*_REQUESTED` = command exists on our server but the ASIC has not executed it
 * yet (DB command still PENDING, or an optimistic in-flight request from the UI).
 * `*_IN_PROGRESS` / `WAKING_UP` = the ASIC acknowledged and executed the command
 * (last command went PENDING -> DONE) but the miner has not reached its target
 * state yet (rebooting / warming up to expected hashrate).
 */
/**
 * Orthogonal "who is allowed to drive this miner right now" axis — independent of
 * the lifecycle {@link MinerStatus}. Derived from persisted flags via
 * deriveControlMode(); precedence highest-first: MANUAL_OFF > OVERHEAT_HOLD >
 * MANUAL_PAUSE > AUTO.
 *
 *  - AUTO:         power-automation may drive the bound Tuya switch and issue
 *                  SLEEP/WAKE; manual commands accepted. Default.
 *  - MANUAL_PAUSE: operator paused the miner (manual SLEEP). Automation is frozen
 *                  for this miner until a manual WAKE / power ON. The ASIC sleeps
 *                  (relay stays powered) — distinct from MANUAL_OFF.
 *  - OVERHEAT_HOLD: protection latch (overheatLocked). Automation owns the wake.
 *  - MANUAL_OFF:   operator cut mains via the bound relay (manualPowerHold).
 *                  Automation frozen; control commands blocked.
 */
export enum ControlMode {
  AUTO = "AUTO",
  MANUAL_PAUSE = "MANUAL_PAUSE",
  OVERHEAT_HOLD = "OVERHEAT_HOLD",
  MANUAL_OFF = "MANUAL_OFF",
}

export enum MinerStatus {
  NORMAL = "NORMAL",
  PAUSE_REQUESTED = "PAUSE_REQUESTED",
  PAUSED = "PAUSED",
  WAKE_REQUESTED = "WAKE_REQUESTED",
  WAKING_UP = "WAKING_UP",
  RESTART_REQUESTED = "RESTART_REQUESTED",
  RESTART_IN_PROGRESS = "RESTART_IN_PROGRESS",
  OFFLINE = "OFFLINE",
  NO_ACCESS = "NO_ACCESS",
  OVERHEAT_LOCKED = "OVERHEAT_LOCKED",
  MANUAL_OFF = "MANUAL_OFF",
  UNKNOWN = "UNKNOWN",
}
