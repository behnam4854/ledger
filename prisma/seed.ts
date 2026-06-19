// Seeds a demo user and portfolio.
// Run with: npm run db:seed   (or npm run db:reset to wipe + reseed)

import { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  // Skip if data already exists.
  if ((await prisma.user.count()) > 0) {
    console.log("Database already has users — skipping seed.");
    return;
  }

  const hash = await bcrypt.hash("demo1234", 12);
  const user = await prisma.user.create({
    data: { email: "demo@ledgrs.dev", password: hash },
  });

  const lastMonth = isoDaysAgo(30);
  const today = isoDaysAgo(0);

  const btc = await prisma.buy.create({
    data: { userId: user.id, wallet: "Main", asset: "BTC", amount: "0.2", price: "42000", date: lastMonth },
  });
  await prisma.buy.create({
    data: { userId: user.id, wallet: "Main", asset: "ETH", amount: "2.5", price: "2800", date: lastMonth },
  });
  await prisma.buy.create({
    data: { userId: user.id, wallet: "Ledger", asset: "XAUT", amount: "0.5", price: "2750", date: lastMonth },
  });

  const amount = new Decimal("0.1");
  const sellPrice = new Decimal("51000");
  const profit = amount.times(sellPrice).minus(amount.times("42000"));
  await prisma.sell.create({
    data: {
      userId: user.id,
      buyId: btc.id,
      amount: amount.toString(),
      sellPrice: sellPrice.toString(),
      sellDate: today,
      profit: profit.toString(),
    },
  });

  await prisma.setting.create({
    data: { userId: user.id, key: "usd_balance", value: "10000" },
  });

  console.log("Seeded demo user (demo@ledgrs.dev / demo1234) with portfolio.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
