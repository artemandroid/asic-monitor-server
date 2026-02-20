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
  authType?: string;
  expectedHashrate?: number;
  online?: boolean;
  readStatus?: "OK" | "FAILED" | "DUMMY" | "OFFLINE";
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
  autoPowerOffBatteryBelowPercent?: number | null;
  autoPowerOnBatteryAbovePercent?: number | null;
  autoPowerRestoreDelayMinutes?: number;
  overheatProtectionEnabled?: boolean;
  overheatShutdownTempC?: number | null;
  overheatLocked?: boolean;
  overheatLockedAt?: string | null;
  overheatLastTempC?: number | null;
  expectedHashrate?: number;
  lastMetric: MinerMetric | null;
};

export type CommandType = "RESTART" | "SLEEP" | "WAKE" | "RELOAD_CONFIG";
export type CommandStatus = "PENDING" | "DONE" | "FAILED";

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
};

export type Notification = {
  id: string;
  type: string;
  message: string;
  minerId?: string;
  action?: string;
  createdAt: string;
};
