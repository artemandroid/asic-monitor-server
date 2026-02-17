import { prisma } from "./prisma";

export type SettingsPayload = {
  autoRestartEnabled?: boolean;
  restartDelayMinutes?: number;
  hashrateDeviationPercent?: number;
  notifyAutoRestart?: boolean;
  notifyRestartPrompt?: boolean;
};

export async function getSettings() {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.settings.create({ data: { id: 1 } });
}

export async function updateSettings(payload: SettingsPayload) {
  await getSettings();
  return prisma.settings.update({
    where: { id: 1 },
    data: {
      autoRestartEnabled: payload.autoRestartEnabled,
      restartDelayMinutes: payload.restartDelayMinutes,
      hashrateDeviationPercent: payload.hashrateDeviationPercent,
      notifyAutoRestart: payload.notifyAutoRestart,
      notifyRestartPrompt: payload.notifyRestartPrompt,
    },
  });
}
