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

export type MinerState = {
  minerId: string;
  lastSeen: string | null;
  lastRestartAt?: string | null;
  pendingCommandType?: CommandType | null;
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
};

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
