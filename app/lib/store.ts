import type { Command, MinerState, Notification, Settings } from "./types";

type Store = {
  minerStates: Map<
    string,
    MinerState & {
      expectedHashrate?: number | null;
      ip?: string | null;
      asicType?: string | null;
      firmware?: string | null;
      authType?: string | null;
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
      online?: boolean | null;
      readStatus?: string | null;
      error?: string | null;
      lastOnlineAt?: string | null;
      lastRestartAt?: string | null;
      lastLowHashrateAt?: string | null;
    }
  >;
  commands: Command[];
  notifications: Notification[];
  settings: Settings;
};

const globalStore = globalThis as unknown as { __minerStore?: Store };

const store: Store =
  globalStore.__minerStore ?? {
    minerStates: new Map(),
    commands: [],
    notifications: [],
    settings: {
      autoRestartEnabled: true,
      minerSyncIntervalSec: 60,
      deyeSyncIntervalSec: 60,
      tuyaSyncIntervalSec: 60,
      restartDelayMinutes: 10,
      postRestartGraceMinutes: 10,
      lowHashrateThresholdGh: 10,
      hashrateDeviationPercent: 10,
      notifyAutoRestart: true,
      notifyRestartPrompt: true,
      notificationVisibleCount: 2,
      criticalBatteryOffPercent: 30,
    },
  };

if (!globalStore.__minerStore) {
  globalStore.__minerStore = store;
}

export const minerStates = store.minerStates;
export const commands = store.commands;
export const notifications = store.notifications;
export const memorySettings = store.settings;
