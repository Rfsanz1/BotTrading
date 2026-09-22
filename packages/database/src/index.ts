export { prisma, prisma as default } from './client';
export {
  resolveCanonicalExchangeAccount,
} from './canonical-exchange-account';
export type {
  CanonicalRuntimeMode,
  CanonicalExchangeAccount,
} from './canonical-exchange-account';

// Re-export all generated Prisma types so consumers only need @rfsanz/database
export type {
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  Session,
  ExchangeAccount,
  ApiKey,
  KillSwitchState,
  Portfolio,
  Position,
  Order,
  Trade,
  Alert,
  Recommendation,
  Subscription,
  AuditLog,
  TradeRecord,
  LearningRecord,
  TradingStatistics,
  PromptTemplate,
  StrategyTemplate,
  ImprovementLog,
  Prisma,
} from '@prisma/client';

export {
  RoleName,
  PermissionKey,
  OrderStatus,
  Side,
  PositionStatus,
  AlertStatus,
  RecommendationType,
  AIProvider,
  MemoryType,
} from '@prisma/client';
