import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  const line = env.split(/\r?\n/).find((entry) => entry.trim().startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL is required to clean up end-to-end test accounts");
  process.env.DATABASE_URL = line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

export default async function globalTeardown() {
  loadDatabaseUrl();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "e2e-",
          endsWith: "@tests.ledgrs.local",
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
