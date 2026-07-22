CREATE TABLE "FuturesActivity" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "positionId" INTEGER NOT NULL,
    "asset" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuturesActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FuturesActivity_userId_createdAt_idx" ON "FuturesActivity"("userId", "createdAt");
CREATE INDEX "FuturesActivity_positionId_createdAt_idx" ON "FuturesActivity"("positionId", "createdAt");

ALTER TABLE "FuturesActivity" ADD CONSTRAINT "FuturesActivity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
