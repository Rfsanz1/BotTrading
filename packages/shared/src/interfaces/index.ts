import {
  RoleName,
  PermissionKey,
  Side,
  OrderStatus,
  PositionStatus,
  RecommendationType,
  AlertStatus,
  AIProvider,
} from '../enums';

// ─── Auth / User ──────────────────────────────────────────────────────────────

export interface IUser {
  id:        string;
  email:     string;
  name?:     string | null;
  isActive:  boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserPublic {
  id:        string;
  email:     string;
  name?:     string | null;
  roles:     RoleName[];
  isActive:  boolean;
}

export interface IRole {
  id:          string;
  name:        RoleName;
  description?: string | null;
  permissions: PermissionKey[];
}

export interface ISession {
  id:        string;
  userId:    string;
  ip?:       string | null;
  userAgent?: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface IJwtPayload {
  sub:   string;   // user id
  email: string;
  roles: RoleName[];
  iat?: number;
  exp?: number;
}

// ─── Exchange / Trading ───────────────────────────────────────────────────────

export interface IExchangeAccount {
  id:        string;
  userId:    string;
  exchange:  string;
  accountId: string;
  isActive:  boolean;
  createdAt: Date;
}

export interface IPortfolio {
  id:          string;
  userId:      string;
  name:        string;
  description?: string | null;
  totalValue:  number;
  createdAt:   Date;
  updatedAt:   Date;
}

export interface IPosition {
  id:          string;
  portfolioId: string;
  symbol:      string;
  side:        Side;
  entryPrice:  number;
  quantity:    number;
  status:      PositionStatus;
  createdAt:   Date;
  updatedAt:   Date;
}

export interface IOrder {
  id:          string;
  portfolioId: string;
  symbol:      string;
  side:        Side;
  status:      OrderStatus;
  price:       number;
  quantity:    number;
  filled:      number;
  createdAt:   Date;
  updatedAt:   Date;
}

export interface ITrade {
  id:          string;
  portfolioId: string;
  symbol:      string;
  side:        Side;
  price:       number;
  quantity:    number;
  fee:         number;
  realizedPnl: number;
  executedAt:  Date;
}

// ─── Alerts / Recommendations ─────────────────────────────────────────────────

export interface IAlert {
  id:        string;
  userId:    string;
  symbol:    string;
  status:    AlertStatus;
  payload:   Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRecommendation {
  id:         string;
  userId:     string;
  symbol:     string;
  type:       RecommendationType;
  confidence: number;
  reasoning:  string;
  provider:   AIProvider;
  createdAt:  Date;
}

// ─── Generic wrappers ────────────────────────────────────────────────────────

export interface IPaginated<T> {
  data:  T[];
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

export interface IApiResponse<T = unknown> {
  success: boolean;
  data?:   T;
  message?: string;
  error?:  string;
  meta?:   Record<string, unknown>;
}
