import { RiskDecision, RiskTradeIntent, isTrustedRiskDecision } from './risk-engine';

export type AuthorizationStatus = 'APPROVED' | 'REJECTED';
export type AuthorizationMode = 'PAPER' | 'TESTNET' | 'LIVE';

export interface RiskApproval {
  readonly status: 'APPROVED';
  readonly decisionId: string;
  readonly riskDecisionId: string;
  readonly riskVersion: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
  readonly entry: number;
  readonly mode: AuthorizationMode;
  readonly accountId: string;
  readonly intent?: RiskTradeIntent;
  readonly positionId?: string;
  readonly expiresAt: number;
}

export interface TrustedExecutionAuthorization extends RiskApproval {
  readonly status: 'APPROVED';
  readonly issuedAt: number;
}

const trustedApprovals = new WeakSet<object>();
const trustedAuthorizations = new WeakSet<object>();

function assertText(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid authorization ${name}`);
  }
}

export function isTrustedRiskApproval(value: unknown): value is RiskApproval {
  return typeof value === 'object' && value !== null && trustedApprovals.has(value);
}

export function isTrustedExecutionAuthorization(value: unknown): value is TrustedExecutionAuthorization {
  return typeof value === 'object' && value !== null && trustedAuthorizations.has(value);
}

export class AuthorizationService {
  private readonly consumed = new Set<string>();

  issueFromDecision(
    decision: RiskDecision,
    context: {
      mode: AuthorizationMode;
      accountId: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      intent?: RiskTradeIntent;
      positionId?: string;
    },
  ): TrustedExecutionAuthorization {
    if (!isTrustedRiskDecision(decision)) {
      throw new Error('Risk approval must originate from RiskEngine.evaluate');
    }
    if (!decision.approved) throw new Error('Cannot authorize a rejected risk decision');
    assertText(decision.decisionId, 'decisionId');
    assertText(decision.riskDecisionId, 'riskDecisionId');
    assertText(decision.riskVersion, 'riskVersion');
    assertText(context.accountId, 'accountId');
    assertText(context.symbol, 'symbol');
    if (!Number.isFinite(context.quantity) || context.quantity <= 0) {
      throw new Error('Invalid authorization quantity');
    }
    if (Math.abs(context.quantity - decision.requestedPositionSize) > 1e-9) {
      throw new Error('Authorization quantity does not match risk decision');
    }
    if (!decision.authorizationExpiresAt || decision.authorizationExpiresAt <= Date.now()) {
      throw new Error('Risk approval is expired');
    }

    const approval: RiskApproval = Object.freeze({
      status: 'APPROVED',
      decisionId: decision.decisionId,
      riskDecisionId: decision.riskDecisionId,
      riskVersion: decision.riskVersion,
      symbol: context.symbol,
      side: context.side,
      quantity: context.quantity,
      entry: decision.entry,
      mode: context.mode,
      accountId: context.accountId,
      intent: context.intent,
      positionId: context.positionId,
      expiresAt: decision.authorizationExpiresAt,
    });
    trustedApprovals.add(approval);

    const authorization: TrustedExecutionAuthorization = Object.freeze({
      ...approval,
      issuedAt: Date.now(),
    });
    trustedAuthorizations.add(authorization);
    return authorization;
  }

  verify(
    authorization: unknown,
    expected: {
      decisionId: string;
      riskDecisionId: string;
      riskVersion: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      entry: number;
      mode: AuthorizationMode;
      accountId: string;
      intent?: RiskTradeIntent;
      positionId?: string;
    },
  ): authorization is TrustedExecutionAuthorization {
    if (!isTrustedExecutionAuthorization(authorization)) return false;
    if (authorization.status !== 'APPROVED') return false;
    if (Date.now() >= authorization.expiresAt) return false;
    return authorization.decisionId === expected.decisionId
      && authorization.riskDecisionId === expected.riskDecisionId
      && authorization.riskVersion === expected.riskVersion
      && authorization.symbol === expected.symbol
      && authorization.side === expected.side
      && Math.abs(authorization.entry - expected.entry) <= 1e-9
      && authorization.mode === expected.mode
      && authorization.accountId === expected.accountId
      && authorization.intent === expected.intent
      && authorization.positionId === expected.positionId
      && Math.abs(authorization.quantity - expected.quantity) <= 1e-9;
  }

  consume(authorization: TrustedExecutionAuthorization, clientOrderId: string): void {
    const key = `${authorization.decisionId}:${clientOrderId}`;
    if (this.consumed.has(key)) throw new Error('Authorization replay rejected');
    this.consumed.add(key);
  }
}

export const authorizationService = new AuthorizationService();
