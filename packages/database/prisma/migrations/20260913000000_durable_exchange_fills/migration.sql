ALTER TABLE "Trade" ADD COLUMN "exchange" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Trade" ADD COLUMN "exchangeAccountId" TEXT;
ALTER TABLE "Trade" ADD COLUMN "executionKey" TEXT;
ALTER TABLE "Trade" ADD COLUMN "exchangeTimestamp" TIMESTAMP(3);
ALTER TABLE "Trade" ADD COLUMN "localEventTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Trade_executionKey_key" ON "Trade"("executionKey");
