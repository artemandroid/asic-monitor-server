import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { MinerMetric } from "@/app/lib/types";
import { requireAgentAuth } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getSettings } from "@/app/lib/settings";

const NOTIFY_AUTO_RESTART = "AUTO_RESTART";
const NOTIFY_RESTART_PROMPT = "LOW_HASHRATE_PROMPT";

export async function POST(request: NextRequest) {
  const auth = requireAgentAuth(request);
  if (auth) return auth;

  let body: MinerMetric;
  try {
    body = (await request.json()) as MinerMetric;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.minerId) {
    return NextResponse.json({ error: "minerId is required" }, { status: 400 });
  }

  const now = new Date();
  const minerId = body.minerId;
  const existing = await prisma.miner.findUnique({ where: { id: minerId } });
  const wasOnline = existing?.online ?? null;
  const isOnline = body.online ?? null;

  let lastOnlineAt = existing?.lastOnlineAt ?? null;
  if (isOnline === true && wasOnline !== true) {
    lastOnlineAt = now;
  }

  const upserted = await prisma.miner.upsert({
    where: { id: minerId },
    create: {
      id: minerId,
      ip: body.ip ?? minerId,
      asicType: body.asicType ?? null,
      firmware: body.firmware ?? null,
      authType: body.authType ?? null,
      expectedHashrate: body.expectedHashrate ?? null,
      lastSeen: now,
      online: isOnline ?? null,
      readStatus: body.readStatus ?? null,
      error: body.error ?? null,
      lastMetric: body,
      lastOnlineAt,
    },
    update: {
      ip: body.ip ?? existing?.ip ?? minerId,
      asicType: body.asicType ?? existing?.asicType ?? null,
      firmware: body.firmware ?? existing?.firmware ?? null,
      authType: body.authType ?? existing?.authType ?? null,
      expectedHashrate:
        body.expectedHashrate ?? existing?.expectedHashrate ?? null,
      lastSeen: now,
      online: isOnline ?? existing?.online ?? null,
      readStatus: body.readStatus ?? existing?.readStatus ?? null,
      error: body.error ?? null,
      lastMetric: body,
      lastOnlineAt,
    },
  });

  const settings = await getSettings();

  const expected = body.expectedHashrate ?? upserted.expectedHashrate ?? null;
  const hashrate = body.hashrate ?? null;
  const deviation = settings.hashrateDeviationPercent ?? 0;
  const delayMs = Math.max(settings.restartDelayMinutes, 0) * 60 * 1000;

  const isLowHashrate =
    isOnline === true &&
    typeof hashrate === "number" &&
    typeof expected === "number" &&
    expected > 0 &&
    hashrate < expected * (1 - deviation / 100);

  if (isLowHashrate) {
    const anchor =
      upserted.lastRestartAt ?? upserted.lastOnlineAt ?? upserted.lastSeen ?? now;
    const ready = !anchor || now.getTime() - anchor.getTime() >= delayMs;

    if (settings.autoRestartEnabled) {
      if (ready) {
        const pendingRestart = await prisma.command.findFirst({
          where: { minerId, type: "RESTART", status: "PENDING" },
        });
        if (!pendingRestart) {
          await prisma.command.create({
            data: {
              id: crypto.randomUUID(),
              minerId,
              type: "RESTART",
              status: "PENDING",
              createdAt: now,
            },
          });
          await prisma.miner.update({
            where: { id: minerId },
            data: { lastRestartAt: now },
          });

          if (settings.notifyAutoRestart) {
            await prisma.notification.create({
              data: {
                type: NOTIFY_AUTO_RESTART,
                minerId,
                action: null,
                message: `Hashrate on ${minerId} dropped to ${hashrate}. Auto-restart issued.`,
              },
            });
          }
        }
      }
    } else if (settings.notifyRestartPrompt) {
      const lastPromptAt = upserted.lastLowHashrateAt;
      const promptReady =
        !lastPromptAt || now.getTime() - lastPromptAt.getTime() >= delayMs;
      if (promptReady) {
        await prisma.notification.create({
          data: {
            type: NOTIFY_RESTART_PROMPT,
            minerId,
            action: "RESTART",
            message: `Hashrate on ${minerId} dropped to ${hashrate}. Auto-restart is disabled. Restart now?`,
          },
        });
        await prisma.miner.update({
          where: { id: minerId },
          data: { lastLowHashrateAt: now },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
