export type MinerMetric = {
  minerId: string;
  timestamp: string;
  hashrate?: number;
  temp?: number;
  fan?: number;
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
  restartDelayMinutes: number;
  hashrateDeviationPercent: number;
  notifyAutoRestart: boolean;
  notifyRestartPrompt: boolean;
};

export type Notification = {
  id: string;
  type: string;
  message: string;
  minerId?: string;
  action?: string;
  createdAt: string;
};
