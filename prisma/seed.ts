// Seeds demo data matching the original LEDGRS sample portfolio.
// Run with: npm run db:seed   (or npm run db:reset to wipe + reseed)

import { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

const prisma = new PrismaClient();

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  // Skip if data already exists.
  if ((await prisma.buy.count()) > 0) {
    console.log("Database already has buys — skipping seed.");
    return;
  }

  const lastMonth = isoDaysAgo(30);
  const today = isoDaysAgo(0);

  const btc = await prisma.buy.create({
    data: { wallet: "Main", asset: "BTC", amount: "0.2", price: "42000", date: lastMonth },
  });
  await prisma.buy.create({
    data: { wallet: "Main", asset: "ETH", amount: "2.5", price: "2800", date: lastMonth },
  });
  await prisma.buy.create({
    data: { wallet: "Ledger", asset: "XAUT", amount: "0.5", price: "2750", date: lastMonth },
  });

  // Demo sell: 0.1 BTC at 51000.
  const amount = new Decimal("0.1");
  const sellPrice = new Decimal("51000");
  const profit = amount.times(sellPrice).minus(amount.times("42000"));
  await prisma.sell.create({
    data: {
      buyId: btc.id,
      amount: amount.toString(),
      sellPrice: sellPrice.toString(),
      sellDate: today,
      profit: profit.toString(),
    },
  });

  await prisma.setting.upsert({
    where: { key: "usd_balance" },
    create: { key: "usd_balance", value: "10000" },
    update: {},
  });

  console.log("Seeded demo portfolio.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
