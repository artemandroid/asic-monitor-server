import { type UiLang, t } from "@/app/lib/ui-lang";
import { CommandType, type MinerState, type Notification } from "@/app/lib/types";
import { toGh } from "@/app/lib/format-utils";

export function groupKeyFor(note: Notification): string {
  if (note.type === "CLIENT_ERROR") {
    return `${note.type}|${note.message}`;
  }
  return `${note.type}|${note.minerId ?? ""}|${note.action ?? ""}`;
}

export function localizeNotificationMessage(uiLang: UiLang, note: Notification): string {
  const formatTempC = (raw: string): string => {
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) return raw;
    return Number(num.toFixed(1)).toString();
  };
  const message = note.message;

  const autoRestart =
    /^Hashrate on (.+) dropped to ([\d.]+) GH\/s\. Auto-restart issued\.$/.exec(message);
  if (autoRestart) {
    return t(uiLang, "hashrate_dropped_auto_restart_issued", {
      minerId: autoRestart[1],
      hashrate: autoRestart[2],
    });
  }

  const restartPrompt =
    /^Hashrate on (.+) dropped to ([\d.]+) GH\/s\. Auto-restart is disabled\. Restart now\?$/.exec(
      message,
    );
  if (restartPrompt) {
    return t(uiLang, "hashrate_dropped_auto_restart_disabled_restart_now", {
      minerId: restartPrompt[1],
      hashrate: restartPrompt[2],
    });
  }

  if (note.type === "OVERHEAT_COOLDOWN") {
    const overheatCooldown =
      /^Overheat protection on (.+): ([\d.]+)C >= ([\d.]+)C\. SLEEP command issued for (\d+) minutes(?: \(until (.+)\))?\. Then WAKE will be sent automatically\. If power is unavailable at wake time, WAKE will be deferred until power is restored\.$/.exec(
        message,
      );
    if (overheatCooldown) {
      return t(uiLang, "overheat_cooldown_started_auto_wake", {
        minerId: overheatCooldown[1],
        tempC: formatTempC(overheatCooldown[2]),
        limitC: formatTempC(overheatCooldown[3]),
        minutes: overheatCooldown[4],
      });
    }
  }

  if (note.type === "OVERHEAT_WAKE_DEFERRED") {
    const deferredWake =
      /^Overheat cooldown finished for (.+), but WAKE is deferred: power is unavailable \(switch OFF or blocked by battery\/grid policy\)\. WAKE will be sent automatically after power is restored\.$/.exec(
        message,
      );
    if (deferredWake) {
      return t(uiLang, "overheat_wake_deferred_power_unavailable", {
        minerId: deferredWake[1],
      });
    }
  }

  if (note.type === "OVERHEAT_WAKE_SENT") {
    const wakeAfterDeferred =
      /^Power restored for (.+)\. Deferred WAKE sent after (\d+)-minute overheat cooldown\.$/.exec(
        message,
      );
    if (wakeAfterDeferred) {
      return t(uiLang, "overheat_wake_sent_after_power_restore", {
        minerId: wakeAfterDeferred[1],
      });
    }
    const wakeAfterCooldown =
      /^(\d+)-minute overheat cooldown finished for (.+)\. WAKE command sent automatically\.$/.exec(
        message,
      );
    if (wakeAfterCooldown) {
      return t(uiLang, "overheat_wake_sent_after_cooldown", {
        minerId: wakeAfterCooldown[2],
      });
    }
  }

  if (note.type === "OVERHEAT_UNLOCKED") {
    const unlocked =
      /^Overheat lock was manually unlocked for (.+)\. Wake now\?$/.exec(message);
    if (unlocked) {
      return uiLang === "uk"
        ? `Перегрів-блок для ${unlocked[1]} розблоковано вручну. Пробудити зараз?`
        : `Overheat lock for ${unlocked[1]} was manually unlocked. Wake now?`;
    }
  }

  const boardDrift = /^Board hashrate drift on (.+): (.+)\.$/.exec(message);
  if (boardDrift) {
    return t(uiLang, "board_hashrate_drift_detected", {
      minerId: boardDrift[1],
      summary: boardDrift[2],
    });
  }

  const commandSuccess =
    /^Command (RESTART|SLEEP|WAKE|RELOAD_CONFIG) succeeded on (.+)\.$/.exec(message);
  if (commandSuccess) {
    return t(uiLang, "command_succeeded_on_miner", {
      command: commandSuccess[1],
      minerId: commandSuccess[2],
    });
  }

  const commandFailed =
    /^Command (RESTART|SLEEP|WAKE|RELOAD_CONFIG) failed on (.+?)(?:: (.+))?\.$/.exec(message);
  if (commandFailed) {
    return t(uiLang, "command_failed_on_miner", {
      command: commandFailed[1],
      minerId: commandFailed[2],
      reason: commandFailed[3] ? `: ${commandFailed[3]}` : "",
    });
  }

  const autoOffCritical =
    /^Auto OFF requested for (.+): grid is OFF and battery < ([\d.]+)%\.$/.exec(message);
  if (autoOffCritical) {
    return t(uiLang, "auto_off_requested_battery_critical", {
      deviceName: autoOffCritical[1],
      threshold: autoOffCritical[2],
    });
  }

  const autoOff = /^Auto OFF requested for (.+)\.$/.exec(message);
  if (autoOff) {
    return t(uiLang, "auto_off_requested_generic", {
      deviceName: autoOff[1],
    });
  }

  const autoOffRetry =
    /^Auto OFF re-requested for (.+): ON conditions are still not met, so auto-shutdown remains active\.$/.exec(
      message,
    );
  if (autoOffRetry) {
    return t(uiLang, "auto_off_rerequested_conditions_not_met", {
      deviceName: autoOffRetry[1],
    });
  }

  const autoOnGrid =
    /^Auto ON requested for (.+) because grid is available\.$/.exec(message);
  if (autoOnGrid) {
    return t(uiLang, "auto_on_requested_grid_available", {
      deviceName: autoOnGrid[1],
    });
  }

  const autoOnDelay =
    /^Auto ON requested for (.+) after threshold recovery delay\.$/.exec(message);
  if (autoOnDelay) {
    return t(uiLang, "auto_on_requested_after_delay", {
      deviceName: autoOnDelay[1],
    });
  }

  return message;
}

export function restartActionStateForNote(
  note: Notification,
  minerById: Map<string, MinerState>,
  pendingActionByMiner: Record<string, CommandType | undefined>,
  uiLang: UiLang,
): { enabled: boolean; title?: string } {
  if (note.action !== "RESTART" || !note.minerId) {
    return { enabled: false, title: "Action is not available" };
  }
  const miner = minerById.get(note.minerId);
  if (!miner) {
    return { enabled: false, title: "Miner is not available" };
  }
  if (miner.overheatLocked === true) {
    return { enabled: false, title: "Overheat lock is active" };
  }
  if (pendingActionByMiner[miner.minerId]) {
    return { enabled: false, title: "Command already requested" };
  }
  if (
    miner.pendingCommandType === CommandType.RESTART ||
    miner.pendingCommandType === CommandType.SLEEP ||
    miner.pendingCommandType === CommandType.WAKE
  ) {
    return { enabled: false, title: t(uiLang, "command_is_already_pending") };
  }

  const metric = (miner.lastMetric ?? null) as {
    online?: boolean;
    hashrateRealtime?: number;
    hashrate?: number;
  } | null;
  if (!metric || metric.online !== true) {
    return { enabled: false, title: t(uiLang, "miner_is_offline") };
  }

  const currentGh = toGh(metric.hashrateRealtime ?? metric.hashrate ?? null);
  const thresholdGh =
    typeof miner.lowHashrateThresholdGh === "number" ? miner.lowHashrateThresholdGh : null;
  if (currentGh === null || thresholdGh === null) {
    return { enabled: false, title: t(uiLang, "no_hashrate_data") };
  }
  if (currentGh >= thresholdGh) {
    return { enabled: false, title: t(uiLang, "hashrate_is_normal_now") };
  }

  if (miner.lastRestartAt) {
    const restartAtMs = new Date(miner.lastRestartAt).getTime();
    const graceMs = Math.max(miner.postRestartGraceMinutes ?? 10, 0) * 60 * 1000;
    if (Number.isFinite(restartAtMs) && Date.now() - restartAtMs < graceMs) {
      return { enabled: false, title: t(uiLang, "post_restart_grace_period_is_active") };
    }
  }

  return { enabled: true };
}

export function wakeActionStateForNote(
  note: Notification,
  minerById: Map<string, MinerState>,
  pendingActionByMiner: Record<string, CommandType | undefined>,
): { enabled: boolean; title?: string } {
  if (note.action !== "WAKE" || !note.minerId) {
    return { enabled: false, title: "Action is not available" };
  }
  const miner = minerById.get(note.minerId);
  if (!miner) {
    return { enabled: false, title: "Miner is not available" };
  }
  if (miner.overheatLocked === true) {
    return { enabled: false, title: "Overheat lock is active" };
  }
  if (pendingActionByMiner[miner.minerId]) {
    return { enabled: false, title: "Command already requested" };
  }
  if (
    miner.pendingCommandType === CommandType.RESTART ||
    miner.pendingCommandType === CommandType.SLEEP ||
    miner.pendingCommandType === CommandType.WAKE
  ) {
    return { enabled: false, title: "Command already requested" };
  }
  return { enabled: true };
}
