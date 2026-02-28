import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

const require = createRequire(import.meta.url);

type PrismaLike = PrismaClientType;

// Global cache holds a non-null value after first initialisation.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaLike };

function createPrismaClient(): PrismaLike | null {
  try {
    if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
      const localEngine = path.resolve(
        process.cwd(),
        "node_modules/.prisma/client/libquery-engine",
      );
      if (fs.existsSync(localEngine)) {
        process.env.PRISMA_QUERY_ENGINE_LIBRARY = localEngine;
      }
    }

    const { PrismaClient: PrismaClientCtor } = require("@prisma/client") as {
      PrismaClient: new (options?: { log?: string[] }) => PrismaLike;
    };
    return new PrismaClientCtor({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
  } catch {
    return null;
  }
}

// When the DB is not configured, return a Proxy that throws on every access.
// Routes catch these errors via their existing try/catch and fall back to the
// in-memory store — the same behaviour as the previous explicit null check.
function createUnavailablePrisma(): PrismaLike {
  return new Proxy(Object.create(null) as object, {
    get(_: object, prop: string | symbol): unknown {
      throw new Error(`Database not available (prisma.${String(prop)})`);
    },
  }) as unknown as PrismaLike;
}

export const prisma: PrismaLike =
  globalForPrisma.prisma ?? createPrismaClient() ?? createUnavailablePrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
