import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type AccessConfig = {
  allowedEmails: string[];
  minerAccess?: Record<string, string[]>;
};

const DEFAULT_CONFIG_PATH = "access.config.json";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function loadConfig(): AccessConfig {
  const path = process.env.ACCESS_CONFIG_PATH
    ? resolve(process.env.ACCESS_CONFIG_PATH)
    : resolve(process.cwd(), DEFAULT_CONFIG_PATH);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<AccessConfig>;
    const allowedEmails = Array.isArray(parsed.allowedEmails)
      ? parsed.allowedEmails.filter((v): v is string => typeof v === "string").map(normalizeEmail)
      : [];
    const minerAccess: Record<string, string[]> = {};
    if (parsed.minerAccess && typeof parsed.minerAccess === "object") {
      for (const [email, ids] of Object.entries(parsed.minerAccess)) {
        if (!Array.isArray(ids)) continue;
        minerAccess[normalizeEmail(email)] = ids
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean);
      }
    }
    return { allowedEmails, minerAccess };
  } catch {
    return { allowedEmails: [], minerAccess: {} };
  }
}

export function isEmailAllowed(email: string): boolean {
  const cfg = loadConfig();
  return cfg.allowedEmails.includes(normalizeEmail(email));
}

export function getAllowedMinerIds(email: string, allMinerIds: string[]): Set<string> {
  const cfg = loadConfig();
  const normalizedEmail = normalizeEmail(email);
  const explicit = cfg.minerAccess?.[normalizedEmail];
  if (explicit && explicit.length > 0) {
    if (explicit.includes("*")) {
      return new Set(allMinerIds);
    }
    return new Set(explicit);
  }
  // If minerAccess map exists, user must be explicitly listed there.
  if (cfg.minerAccess && Object.keys(cfg.minerAccess).length > 0) {
    return new Set<string>();
  }
  // Without minerAccess map, default to all miners for whitelisted users.
  return new Set(allMinerIds);
}

export function canAccessMiner(email: string, minerId: string, allMinerIds: string[]): boolean {
  return getAllowedMinerIds(email, allMinerIds).has(minerId);
}
