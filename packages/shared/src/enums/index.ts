// ─── Role & Permission ────────────────────────────────────────────────────────

export enum RoleName {
  USER  = 'USER',
  ADMIN = 'ADMIN',
  BOT   = 'BOT',
}

export enum PermissionKey {
  READ  = 'READ',
  WRITE = 'WRITE',
  TRADE = 'TRADE',
  ADMIN = 'ADMIN',
}

// ─── Trading ─────────────────────────────────────────────────────────────────

export enum Side {
  BUY  = 'BUY',
  SELL = 'SELL',
}

export enum OrderStatus {
  NEW              = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED           = 'FILLED',
  CANCELED         = 'CANCELED',
  REJECTED         = 'REJECTED',
}

export enum PositionStatus {
  OPEN       = 'OPEN',
  CLOSED     = 'CLOSED',
  LIQUIDATED = 'LIQUIDATED',
}

export enum RecommendationType {
  BUY  = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

// ─── Alert ───────────────────────────────────────────────────────────────────

export enum AlertStatus {
  RECEIVED    = 'RECEIVED',
  VALIDATED   = 'VALIDATED',
  PROCESSING  = 'PROCESSING',
  ANALYZED    = 'ANALYZED',
  RECOMMENDED = 'RECOMMENDED',
  EXECUTED    = 'EXECUTED',
  COMPLETED   = 'COMPLETED',
  REJECTED    = 'REJECTED',
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export enum AIProvider {
  OPENAI    = 'OPENAI',
  CLAUDE    = 'CLAUDE',
  GEMINI    = 'GEMINI',
  GROQ      = 'GROQ',
  DEEPSEEK  = 'DEEPSEEK',
  OLLAMA    = 'OLLAMA',
}

export enum MemoryType {
  TRADE        = 'TRADE',
  SIGNAL       = 'SIGNAL',
  PROFIT       = 'PROFIT',
  LOSS         = 'LOSS',
  STRATEGY     = 'STRATEGY',
  CONVERSATION = 'CONVERSATION',
  RESPONSE     = 'RESPONSE',
  MARKET       = 'MARKET',
  SESSION      = 'SESSION',
  NOTE         = 'NOTE',
}
