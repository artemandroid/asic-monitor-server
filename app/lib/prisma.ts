import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

type PrismaLike = any;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaLike | null };

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

    const { PrismaClient } = require("@prisma/client") as {
      PrismaClient: new (options?: { log?: string[] }) => PrismaLike;
    };
    return new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
  } catch {
    return null;
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
