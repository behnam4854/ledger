CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Coin" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coingeckoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Coin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FuturesPosition" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "asset" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "leverage" INTEGER NOT NULL,
    "margin" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "initialQuantity" TEXT,
    "initialMargin" TEXT,
    "entryPrice" TEXT NOT NULL,
    "stopLoss" TEXT,
    "takeProfit" TEXT,
    "riskPercent" TEXT,
    "plannedRisk" TEXT,
    "feeRateBps" TEXT,
    "entryFee" TEXT,
    "exitFee" TEXT,
    "fundingRate" TEXT,
    "fundingIntervalHours" INTEGER,
    "fundingPnl" TEXT,
    "grossPnl" TEXT,
    "maintenanceMarginRate" TEXT,
    "journalSetup" TEXT,
    "journalTags" TEXT,
    "journalNotes" TEXT,
    "journalScreenshot" TEXT,
    "autoCloseEnabled" BOOLEAN NOT NULL DEFAULT true,
    "closeReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "exitPrice" TEXT,
    "realizedPnl" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "FuturesPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FuturesExecution" (
    "id" SERIAL NOT NULL,
    "positionId" INTEGER NOT NULL,
    "quantity" TEXT NOT NULL,
    "exitPrice" TEXT NOT NULL,
    "allocatedMargin" TEXT NOT NULL,
    "entryFee" TEXT NOT NULL,
    "exitFee" TEXT NOT NULL,
    "fundingPnl" TEXT NOT NULL,
    "grossPnl" TEXT NOT NULL,
    "realizedPnl" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'MANUAL',
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuturesExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Buy" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Buy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sell" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "buyId" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "sellPrice" TEXT NOT NULL,
    "sellDate" TEXT NOT NULL,
    "profit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sell_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Candle" (
    "asset" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "close" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Candle_pkey" PRIMARY KEY ("asset", "date")
);

CREATE TABLE "Setting" (
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("userId", "key")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Coin_userId_idx" ON "Coin"("userId");
CREATE UNIQUE INDEX "Coin_userId_symbol_key" ON "Coin"("userId", "symbol");
CREATE UNIQUE INDEX "Coin_userId_coingeckoId_key" ON "Coin"("userId", "coingeckoId");
CREATE INDEX "FuturesPosition_userId_status_idx" ON "FuturesPosition"("userId", "status");
CREATE INDEX "FuturesExecution_positionId_closedAt_idx" ON "FuturesExecution"("positionId", "closedAt");
CREATE INDEX "Buy_userId_idx" ON "Buy"("userId");
CREATE INDEX "Buy_asset_idx" ON "Buy"("asset");
CREATE INDEX "Sell_userId_idx" ON "Sell"("userId");
CREATE INDEX "Sell_buyId_idx" ON "Sell"("buyId");
CREATE INDEX "Candle_asset_idx" ON "Candle"("asset");

ALTER TABLE "Coin" ADD CONSTRAINT "Coin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuturesPosition" ADD CONSTRAINT "FuturesPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FuturesExecution" ADD CONSTRAINT "FuturesExecution_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "FuturesPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Buy" ADD CONSTRAINT "Buy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sell" ADD CONSTRAINT "Sell_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sell" ADD CONSTRAINT "Sell_buyId_fkey" FOREIGN KEY ("buyId") REFERENCES "Buy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
