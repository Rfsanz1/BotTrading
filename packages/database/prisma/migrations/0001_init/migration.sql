-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('USER', 'ADMIN', 'BOT');

-- CreateEnum
CREATE TYPE "PermissionKey" AS ENUM ('READ', 'WRITE', 'TRADE', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED', 'LIQUIDATED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'PROCESSING', 'ANALYZED', 'RECOMMENDED', 'EXECUTED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('BUY', 'SELL', 'HOLD');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('OPENAI', 'CLAUDE', 'GEMINI', 'GROQ', 'DEEPSEEK', 'OLLAMA');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('TRADE', 'SIGNAL', 'PROFIT', 'LOSS', 'STRATEGY', 'CONVERSATION', 'RESPONSE', 'MARKET', 'SESSION', 'NOTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" "PermissionKey" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExchangeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchangeAccountId" TEXT,
    "keyHash" TEXT NOT NULL,
    "secretEncrypted" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioAsset" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "avgPrice" DECIMAL(30,12),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "exchange" TEXT NOT NULL,
    "externalId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "price" DECIMAL(30,12),
    "quantity" DECIMAL(30,12) NOT NULL,
    "filled" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "price" DECIMAL(30,12) NOT NULL,
    "quantity" DECIMAL(30,12) NOT NULL,
    "fee" DECIMAL(30,12),
    "side" "Side" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "entryPrice" DECIMAL(30,12) NOT NULL,
    "quantity" DECIMAL(30,12) NOT NULL,
    "unrealizedPnL" DECIMAL(30,12),
    "realizedPnL" DECIMAL(30,12),
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "meta" JSONB,
    "stopLoss" DECIMAL(30,12),
    "takeProfit" DECIMAL(30,12),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT,
    "symbol" TEXT NOT NULL,
    "confidence" DECIMAL(6,4),
    "riskLevel" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "topics" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "MemoryType" NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "webhookSource" TEXT,
    "webhookPayload" JSONB,
    "status" "AlertStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "provider" "AIProvider" NOT NULL,
    "analysis" TEXT NOT NULL,
    "confidence" DECIMAL(6,4) NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "sentiment" TEXT,
    "keyPoints" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consensus" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "recommendation" "RecommendationType" NOT NULL,
    "confidenceScore" DECIMAL(6,4) NOT NULL,
    "riskScore" DECIMAL(6,4) NOT NULL,
    "bulletPoints" TEXT[],
    "analysis" TEXT NOT NULL,
    "providerVotes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consensus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "consensusId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "recommendationType" "RecommendationType" NOT NULL,
    "entryPrice" DECIMAL(30,12),
    "targetPrice" DECIMAL(30,12),
    "stopLoss" DECIMAL(30,12),
    "riskReward" DECIMAL(10,4),
    "positionSizePercentage" DECIMAL(6,4),
    "urgency" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAnalysisLink" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAnalysisLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPerformance" (
    "id" TEXT NOT NULL,
    "provider" "AIProvider" NOT NULL,
    "symbol" TEXT NOT NULL,
    "recommendation" "RecommendationType" NOT NULL,
    "actualOutcome" TEXT NOT NULL,
    "accuracy" DECIMAL(6,4),
    "profitLoss" DECIMAL(30,12),
    "isCorrect" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingStatistics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "winningTrades" INTEGER NOT NULL DEFAULT 0,
    "losingTrades" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL(6,4),
    "totalProfit" DECIMAL(30,12),
    "totalLoss" DECIMAL(30,12),
    "avgWin" DECIMAL(30,12),
    "avgLoss" DECIMAL(30,12),
    "profitFactor" DECIMAL(10,4),
    "maxDrawdown" DECIMAL(6,4),
    "sharpeRatio" DECIMAL(10,4),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingStatistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "executedAction" TEXT,
    "executedPrice" DECIMAL(30,12),
    "executedSize" DECIMAL(30,12),
    "entryPrice" DECIMAL(30,12),
    "exitPrice" DECIMAL(30,12),
    "pnl" DECIMAL(30,12),
    "pnlPercentage" DECIMAL(10,4),
    "duration" INTEGER,
    "exitReason" TEXT,
    "slippage" DECIMAL(10,4),
    "outcome" TEXT NOT NULL,
    "lessons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TradeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeDecisionSnapshot" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "exchange" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT,
    "marketSnapshot" JSONB,
    "regime" TEXT,
    "regimeConfidence" DECIMAL(6,4),
    "setup" TEXT,
    "setupConfidence" DECIMAL(6,4),
    "featureSnapshot" JSONB,
    "aiOutputs" JSONB,
    "consensus" JSONB,
    "rawConfidence" DECIMAL(6,4),
    "calibratedProbability" DECIMAL(6,4),
    "calibrationStatus" TEXT,
    "expectedValue" DECIMAL(12,6),
    "expectedValueAfterCost" DECIMAL(12,6),
    "entry" DECIMAL(30,12),
    "stopLoss" DECIMAL(30,12),
    "takeProfit" DECIMAL(30,12),
    "riskReward" DECIMAL(10,4),
    "positionSize" DECIMAL(30,12),
    "riskAmount" DECIMAL(30,12),
    "portfolioHeat" DECIMAL(10,4),
    "decision" TEXT,
    "reasoning" TEXT,
    "invalidationConditions" JSONB,
    "strategyVersion" TEXT,
    "featureVersion" TEXT,
    "promptVersion" TEXT,
    "decisionVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDecisionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOutcome" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "entryPrice" DECIMAL(30,12),
    "exitPrice" DECIMAL(30,12),
    "realizedPnL" DECIMAL(30,12),
    "realizedR" DECIMAL(10,4),
    "fees" DECIMAL(30,12),
    "slippage" DECIMAL(10,4),
    "mfe" DECIMAL(10,4),
    "mae" DECIMAL(10,4),
    "holdingTime" INTEGER,
    "exitReason" TEXT,
    "winLoss" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPerformance" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "symbol" TEXT,
    "regime" TEXT,
    "setup" TEXT,
    "predictionCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL(6,4),
    "avgR" DECIMAL(10,4),
    "profitFactor" DECIMAL(10,4),
    "avgConfidence" DECIMAL(6,4),
    "calibrationError" DECIMAL(6,4),
    "recentWinRate" DECIMAL(6,4),
    "recentAvgR" DECIMAL(10,4),
    "sampleStatus" TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelWeightHistory" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "symbol" TEXT,
    "regime" TEXT,
    "setup" TEXT,
    "oldWeight" DECIMAL(10,6) NOT NULL,
    "newWeight" DECIMAL(10,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelWeightHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationRecord" (
    "id" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "confidenceBucket" TEXT NOT NULL,
    "predictionCount" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "predictedProbability" DECIMAL(6,4),
    "empiricalProbability" DECIMAL(6,4),
    "calibrationError" DECIMAL(6,4),
    "status" TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalibrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "successRate" DECIMAL(6,4) NOT NULL,
    "avgWin" DECIMAL(30,12),
    "avgLoss" DECIMAL(30,12),
    "profitFactor" DECIMAL(10,4),
    "totalTrades" INTEGER NOT NULL,
    "insights" JSONB NOT NULL,
    "improvements" TEXT[],
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "examples" JSONB,
    "isCustom" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "indicators" TEXT[],
    "riskManagement" JSONB NOT NULL,
    "backtest" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT,
    "improvementType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImprovementLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "ExchangeAccount_userId_idx" ON "ExchangeAccount"("userId");

-- CreateIndex
CREATE INDEX "ExchangeAccount_exchange_idx" ON "ExchangeAccount"("exchange");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");

-- CreateIndex
CREATE INDEX "Asset_symbol_idx" ON "Asset"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioAsset_portfolioId_assetId_key" ON "PortfolioAsset"("portfolioId", "assetId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_symbol_idx" ON "Order"("symbol");

-- CreateIndex
CREATE INDEX "Trade_orderId_idx" ON "Trade"("orderId");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_symbol_idx" ON "Position"("symbol");

-- CreateIndex
CREATE INDEX "BalanceHistory_userId_idx" ON "BalanceHistory"("userId");

-- CreateIndex
CREATE INDEX "BalanceHistory_exchange_idx" ON "BalanceHistory"("exchange");

-- CreateIndex
CREATE INDEX "BalanceHistory_asset_idx" ON "BalanceHistory"("asset");

-- CreateIndex
CREATE INDEX "BalanceHistory_timestamp_idx" ON "BalanceHistory"("timestamp");

-- CreateIndex
CREATE INDEX "Signal_symbol_idx" ON "Signal"("symbol");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "MemoryItem_userId_idx" ON "MemoryItem"("userId");

-- CreateIndex
CREATE INDEX "MemoryItem_type_idx" ON "MemoryItem"("type");

-- CreateIndex
CREATE INDEX "MemoryItem_conversationId_idx" ON "MemoryItem"("conversationId");

-- CreateIndex
CREATE INDEX "MemoryItem_createdAt_idx" ON "MemoryItem"("createdAt");

-- CreateIndex
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");

-- CreateIndex
CREATE INDEX "Alert_symbol_idx" ON "Alert"("symbol");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "Analysis_alertId_idx" ON "Analysis"("alertId");

-- CreateIndex
CREATE INDEX "Analysis_provider_idx" ON "Analysis"("provider");

-- CreateIndex
CREATE INDEX "Analysis_symbol_idx" ON "Analysis"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Consensus_alertId_key" ON "Consensus"("alertId");

-- CreateIndex
CREATE INDEX "Consensus_alertId_idx" ON "Consensus"("alertId");

-- CreateIndex
CREATE INDEX "Consensus_symbol_idx" ON "Consensus"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_consensusId_key" ON "Recommendation"("consensusId");

-- CreateIndex
CREATE INDEX "Recommendation_userId_idx" ON "Recommendation"("userId");

-- CreateIndex
CREATE INDEX "Recommendation_alertId_idx" ON "Recommendation"("alertId");

-- CreateIndex
CREATE INDEX "Recommendation_symbol_idx" ON "Recommendation"("symbol");

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");

-- CreateIndex
CREATE INDEX "OrderAnalysisLink_orderId_idx" ON "OrderAnalysisLink"("orderId");

-- CreateIndex
CREATE INDEX "OrderAnalysisLink_alertId_idx" ON "OrderAnalysisLink"("alertId");

-- CreateIndex
CREATE INDEX "AIPerformance_provider_idx" ON "AIPerformance"("provider");

-- CreateIndex
CREATE INDEX "AIPerformance_symbol_idx" ON "AIPerformance"("symbol");

-- CreateIndex
CREATE INDEX "AIPerformance_createdAt_idx" ON "AIPerformance"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradingStatistics_userId_key" ON "TradingStatistics"("userId");

-- CreateIndex
CREATE INDEX "TradingStatistics_userId_idx" ON "TradingStatistics"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeRecord_recommendationId_key" ON "TradeRecord"("recommendationId");

-- CreateIndex
CREATE INDEX "TradeRecord_userId_idx" ON "TradeRecord"("userId");

-- CreateIndex
CREATE INDEX "TradeRecord_symbol_idx" ON "TradeRecord"("symbol");

-- CreateIndex
CREATE INDEX "TradeRecord_outcome_idx" ON "TradeRecord"("outcome");

-- CreateIndex
CREATE INDEX "TradeRecord_createdAt_idx" ON "TradeRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDecisionSnapshot_decisionId_key" ON "TradeDecisionSnapshot"("decisionId");

-- CreateIndex
CREATE INDEX "TradeDecisionSnapshot_symbol_idx" ON "TradeDecisionSnapshot"("symbol");

-- CreateIndex
CREATE INDEX "TradeDecisionSnapshot_decision_idx" ON "TradeDecisionSnapshot"("decision");

-- CreateIndex
CREATE INDEX "TradeDecisionSnapshot_createdAt_idx" ON "TradeDecisionSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOutcome_decisionId_key" ON "TradeOutcome"("decisionId");

-- CreateIndex
CREATE INDEX "TradeOutcome_decisionId_idx" ON "TradeOutcome"("decisionId");

-- CreateIndex
CREATE INDEX "TradeOutcome_winLoss_idx" ON "TradeOutcome"("winLoss");

-- CreateIndex
CREATE INDEX "ModelPerformance_provider_idx" ON "ModelPerformance"("provider");

-- CreateIndex
CREATE INDEX "ModelPerformance_symbol_idx" ON "ModelPerformance"("symbol");

-- CreateIndex
CREATE INDEX "ModelPerformance_regime_idx" ON "ModelPerformance"("regime");

-- CreateIndex
CREATE INDEX "ModelPerformance_setup_idx" ON "ModelPerformance"("setup");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPerformance_provider_model_symbol_regime_setup_key" ON "ModelPerformance"("provider", "model", "symbol", "regime", "setup");

-- CreateIndex
CREATE INDEX "ModelWeightHistory_provider_idx" ON "ModelWeightHistory"("provider");

-- CreateIndex
CREATE INDEX "ModelWeightHistory_model_idx" ON "ModelWeightHistory"("model");

-- CreateIndex
CREATE INDEX "ModelWeightHistory_createdAt_idx" ON "ModelWeightHistory"("createdAt");

-- CreateIndex
CREATE INDEX "CalibrationRecord_confidenceBucket_idx" ON "CalibrationRecord"("confidenceBucket");

-- CreateIndex
CREATE INDEX "CalibrationRecord_status_idx" ON "CalibrationRecord"("status");

-- CreateIndex
CREATE INDEX "LearningRecord_userId_idx" ON "LearningRecord"("userId");

-- CreateIndex
CREATE INDEX "LearningRecord_period_idx" ON "LearningRecord"("period");

-- CreateIndex
CREATE UNIQUE INDEX "LearningRecord_userId_period_symbol_key" ON "LearningRecord"("userId", "period", "symbol");

-- CreateIndex
CREATE INDEX "PromptTemplate_userId_idx" ON "PromptTemplate"("userId");

-- CreateIndex
CREATE INDEX "PromptTemplate_category_idx" ON "PromptTemplate"("category");

-- CreateIndex
CREATE INDEX "StrategyTemplate_userId_idx" ON "StrategyTemplate"("userId");

-- CreateIndex
CREATE INDEX "ImprovementLog_userId_idx" ON "ImprovementLog"("userId");

-- CreateIndex
CREATE INDEX "ImprovementLog_symbol_idx" ON "ImprovementLog"("symbol");

-- CreateIndex
CREATE INDEX "ImprovementLog_improvementType_idx" ON "ImprovementLog"("improvementType");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeAccount" ADD CONSTRAINT "ExchangeAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_exchangeAccountId_fkey" FOREIGN KEY ("exchangeAccountId") REFERENCES "ExchangeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioAsset" ADD CONSTRAINT "PortfolioAsset_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioAsset" ADD CONSTRAINT "PortfolioAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceHistory" ADD CONSTRAINT "BalanceHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryItem" ADD CONSTRAINT "MemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consensus" ADD CONSTRAINT "Consensus_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_consensusId_fkey" FOREIGN KEY ("consensusId") REFERENCES "Consensus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAnalysisLink" ADD CONSTRAINT "OrderAnalysisLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAnalysisLink" ADD CONSTRAINT "OrderAnalysisLink_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAnalysisLink" ADD CONSTRAINT "OrderAnalysisLink_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingStatistics" ADD CONSTRAINT "TradingStatistics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRecord" ADD CONSTRAINT "TradeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRecord" ADD CONSTRAINT "TradeRecord_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOutcome" ADD CONSTRAINT "TradeOutcome_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "TradeDecisionSnapshot"("decisionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRecord" ADD CONSTRAINT "LearningRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyTemplate" ADD CONSTRAINT "StrategyTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementLog" ADD CONSTRAINT "ImprovementLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

