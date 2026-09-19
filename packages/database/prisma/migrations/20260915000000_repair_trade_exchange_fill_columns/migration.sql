DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Trade'
      AND column_name = 'exchangeOrderId'
  ) THEN
    ALTER TABLE "Trade" ADD COLUMN "exchangeOrderId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Trade'
      AND column_name = 'exchangeTradeId'
  ) THEN
    ALTER TABLE "Trade" ADD COLUMN "exchangeTradeId" TEXT;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Trade_exchangeTradeId_key"
ON "Trade"("exchangeTradeId");
