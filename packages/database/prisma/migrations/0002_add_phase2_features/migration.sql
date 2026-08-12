/*
  Warnings:

  - You are about to drop the column `stopLoss` on the `Position` table. All the data in the column will be lost.
  - You are about to drop the column `takeProfit` on the `Position` table. All the data in the column will be lost.

*/
-- CreateTable "BalanceHistory"
CREATE TABLE "BalanceHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "free" DECIMAL(30,12) NOT NULL,
    "locked" DECIMAL(30,12) NOT NULL,
    "total" DECIMAL(30,12) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "BalanceHistory_pkey" PRIMARY KEY ("id")
);

-- AlterTable "Position"
ALTER TABLE "Position" ADD COLUMN "stopLoss" DECIMAL(30,12),
ADD COLUMN "takeProfit" DECIMAL(30,12);

-- CreateIndex
CREATE INDEX "BalanceHistory_userId_idx" ON "BalanceHistory"("userId");

-- CreateIndex
CREATE INDEX "BalanceHistory_exchange_idx" ON "BalanceHistory"("exchange");

-- CreateIndex
CREATE INDEX "BalanceHistory_asset_idx" ON "BalanceHistory"("asset");

-- CreateIndex
CREATE INDEX "BalanceHistory_timestamp_idx" ON "BalanceHistory"("timestamp");

-- CreateIndex
CREATE INDEX "BalanceHistory_userId_exchange_asset_timestamp_idx" ON "BalanceHistory"("userId", "exchange", "asset", "timestamp");

-- AddForeignKey
ALTER TABLE "BalanceHistory" ADD CONSTRAINT "BalanceHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
