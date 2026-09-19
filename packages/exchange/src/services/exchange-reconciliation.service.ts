export type ReconciliationStatus = 'HEALTHY' | 'DEGRADED' | 'HALTED';

export interface ReconciliationResult {
  status: ReconciliationStatus;
  mismatches: string[];
  warnings: string[];
  timestamp: number;
}

function comparable(value: unknown): string {
  return JSON.stringify(value, Object.keys((value ?? {}) as object).sort());
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeSide(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'buy' || normalized === 'long') return 'long';
  if (normalized === 'sell' || normalized === 'short') return 'short';
  return normalized;
}

export class ExchangeReconciliationService {
  async reconcileAccount(account: any, exchangeAccount: any): Promise<string[]> {
    const mismatches: string[] = [];
    if (!account && exchangeAccount) mismatches.push('missing-account-cache');
    if (account && exchangeAccount && comparable(account) !== comparable(exchangeAccount)) {
      mismatches.push('account-mismatch');
    }
    return mismatches;
  }

  async reconcileOrders(localOrders: any[] = [], exchangeOrders: any[] = []): Promise<string[]> {
    const mismatches: string[] = [];
    const localIndex = new Map((localOrders || []).map((o) => [o.clientOrderId ?? o.id, o]));
    const exchangeIndex = new Map((exchangeOrders || []).map((o) => [o.clientOrderId ?? o.id, o]));
    for (const exchangeOrder of exchangeOrders || []) {
      const key = exchangeOrder.clientOrderId ?? exchangeOrder.id;
      if (!key) continue;
      const local = localIndex.get(key);
      if (!local) {
        mismatches.push(`orphan-exchange-order:${key}`);
      } else if (
        String(local.status).toUpperCase() !== String(exchangeOrder.status).toUpperCase()
        || numeric(local.filled ?? local.filledQuantity) !== numeric(exchangeOrder.filled ?? exchangeOrder.filledQuantity)
      ) {
        mismatches.push(`order-mismatch:${key}`);
      }
    }
    for (const localOrder of localOrders || []) {
      const key = localOrder.clientOrderId ?? localOrder.id;
      if (key && !exchangeIndex.has(key)) mismatches.push(`orphan-local-order:${key}`);
    }
    return mismatches;
  }

  async reconcilePositions(
    localPositions: any[] = [],
    exchangePositions: any[] = [],
    authoritative = true,
  ): Promise<string[]> {
    if (!authoritative) return [];
    const mismatches: string[] = [];
    const localIndex = new Map((localPositions || []).map((p) => [p.symbol, p]));
    const exchangeIndex = new Map((exchangePositions || []).map((p) => [p.symbol, p]));
    for (const exchangePosition of exchangePositions || []) {
      const symbol = exchangePosition.symbol;
      if (!symbol) continue;
      const local = localIndex.get(symbol);
      if (!local) {
        mismatches.push(`orphan-exchange-position:${symbol}`);
      } else if (
        normalizeSide(local.side) !== normalizeSide(exchangePosition.side)
        || numeric(local.quantity ?? local.size) !== numeric(exchangePosition.quantity ?? exchangePosition.size)
      ) {
        mismatches.push(`position-mismatch:${symbol}`);
      }
    }
    for (const localPosition of localPositions || []) {
      if (localPosition.symbol && !exchangeIndex.has(localPosition.symbol)) {
        mismatches.push(`orphan-local-position:${localPosition.symbol}`);
      }
    }
    return mismatches;
  }

  async reconcileAll(
    localAccount?: any,
    localOrders: any[] = [],
    localPositions: any[] = [],
    exchangeAccount: any = localAccount,
    exchangeOrders: any[] = localOrders,
    exchangePositions: any[] = localPositions,
    positionsAuthoritative = true,
  ): Promise<ReconciliationResult> {
    const mismatches: string[] = [];
    const warnings: string[] = [];

    mismatches.push(...(await this.reconcileAccount(localAccount, exchangeAccount)));
    mismatches.push(...(await this.reconcileOrders(localOrders, exchangeOrders)));
    mismatches.push(...(await this.reconcilePositions(localPositions, exchangePositions, positionsAuthoritative)));

    const status: ReconciliationStatus = mismatches.length > 0 ? 'DEGRADED' : 'HEALTHY';
    return { status, mismatches, warnings, timestamp: Date.now() };
  }
}

export default new ExchangeReconciliationService();
