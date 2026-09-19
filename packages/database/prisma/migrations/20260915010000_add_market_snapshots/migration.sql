-- Additive schema for market-intelligence snapshot persistence.
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "normalized" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketSnapshot_symbol_timeframe_createdAt_idx"
ON "MarketSnapshot"("symbol", "timeframe", "createdAt");

CREATE INDEX "MarketSnapshot_source_idx"
ON "MarketSnapshot"("source");
