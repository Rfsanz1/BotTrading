/**
 * Generic Repository interface following Repository Pattern
 */
export interface IRepository<T, ID> {
  create(data: Partial<T>): Promise<T>;
  findById(id: ID): Promise<T | null>;
  findAll(query?: Record<string, any>): Promise<T[]>;
  findOne(criteria: Partial<T>): Promise<T | null>;
  update(id: ID, data: Partial<T>): Promise<T>;
  delete(id: ID): Promise<boolean>;
  exists(criteria: Partial<T>): Promise<boolean>;
  count(criteria?: Partial<T>): Promise<number>;
}

/**
 * Repository for Alert model
 */
export interface IAlertRepository extends IRepository<any, string> {
  findByUserId(userId: string, limit?: number, offset?: number): Promise<any[]>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
  findByStatus(status: string, limit?: number): Promise<any[]>;
  updateStatus(id: string, status: string): Promise<any>;
}

/**
 * Repository for Analysis model
 */
export interface IAnalysisRepository extends IRepository<any, string> {
  findByAlertId(alertId: string): Promise<any[]>;
  findByProvider(provider: string, limit?: number): Promise<any[]>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
}

/**
 * Repository for Consensus model
 */
export interface IConsensusRepository extends IRepository<any, string> {
  findByAlertId(alertId: string): Promise<any | null>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
}

/**
 * Repository for Recommendation model
 */
export interface IRecommendationRepository extends IRepository<any, string> {
  findByAlertId(alertId: string): Promise<any | null>;
  findByUserId(userId: string, limit?: number): Promise<any[]>;
  findByStatus(status: string, limit?: number): Promise<any[]>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
  updateStatus(id: string, status: string): Promise<any>;
}

/**
 * Repository for Order model
 */
export interface IOrderRepository extends IRepository<any, string> {
  findByUserId(userId: string, limit?: number): Promise<any[]>;
  findByStatus(status: string, limit?: number): Promise<any[]>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
  updateStatus(id: string, status: string): Promise<any>;
}

/**
 * Repository for Trade model
 */
export interface ITradeRepository extends IRepository<any, string> {
  findByUserId(userId: string, limit?: number): Promise<any[]>;
  findByOrderId(orderId: string): Promise<any[]>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
}

/**
 * Repository for Position model
 */
export interface IPositionRepository extends IRepository<any, string> {
  findByUserId(userId: string): Promise<any[]>;
  findBySymbol(symbol: string): Promise<any[]>;
  findOpenPositions(userId: string): Promise<any[]>;
  findClosedPositions(userId: string): Promise<any[]>;
}

/**
 * Repository for Portfolio model
 */
export interface IPortfolioRepository extends IRepository<any, string> {
  findByUserId(userId: string): Promise<any>;
  findAssets(portfolioId: string): Promise<any[]>;
}

/**
 * Repository for AuditLog model
 */
export interface IAuditLogRepository extends IRepository<any, string> {
  findByUserId(userId: string, limit?: number): Promise<any[]>;
  findByAction(action: string, limit?: number): Promise<any[]>;
}

/**
 * Repository for TradingStatistics model
 */
export interface ITradingStatisticsRepository extends IRepository<any, string> {
  findByUserId(userId: string): Promise<any | null>;
  updateStats(userId: string, stats: Partial<any>): Promise<any>;
}

/**
 * Repository for AIPerformance model
 */
export interface IAIPerformanceRepository extends IRepository<any, string> {
  findByProvider(provider: string, limit?: number): Promise<any[]>;
  findBySymbol(symbol: string, limit?: number): Promise<any[]>;
  aggregateStats(provider: string): Promise<Record<string, any>>;
}
