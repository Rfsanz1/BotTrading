ALTER TABLE "Alert" ADD COLUMN "webhookId" TEXT;
CREATE UNIQUE INDEX "Alert_webhookId_key" ON "Alert"("webhookId");
