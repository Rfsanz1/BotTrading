export interface DepthSnapshot {
  lastUpdateId: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export interface DepthUpdate {
  firstUpdateId: number;
  finalUpdateId: number;
  previousUpdateId?: number;
  eventTime: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export interface OrderBookState {
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadBps: number | null;
  bidDepth5: number;
  askDepth5: number;
  bidDepth10: number;
  askDepth10: number;
  bidDepth20: number;
  askDepth20: number;
  imbalance5: number | null;
  imbalance10: number | null;
  imbalance20: number | null;
  microPrice: number | null;
  weightedMidPrice: number | null;
  bidWall: [number, number] | null;
  askWall: [number, number] | null;
  estimatedBuySlippage: number | null;
  estimatedSellSlippage: number | null;
  lastUpdateId: number | null;
  lastEventTime: number | null;
  dataAgeMs: number | null;
  sequenceHealthy: boolean;
}

export class LocalOrderBookEngine {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private lastUpdateId: number | null = null;
  private lastEventTime: number | null = null;
  private sequenceHealthy = false;

  initialize(snapshot: DepthSnapshot): void {
    this.bids.clear();
    this.asks.clear();
    for (const [price, quantity] of snapshot.bids) this.setLevel(this.bids, price, quantity);
    for (const [price, quantity] of snapshot.asks) this.setLevel(this.asks, price, quantity);
    this.lastUpdateId = snapshot.lastUpdateId;
    this.lastEventTime = null;
    this.sequenceHealthy = true;
  }

  applyUpdate(update: DepthUpdate): boolean {
    if (this.lastUpdateId === null || !this.sequenceHealthy) return false;
    if (update.finalUpdateId <= this.lastUpdateId) return true;
    const expected = this.lastUpdateId + 1;
    const bridgesSnapshot = update.firstUpdateId <= expected && update.finalUpdateId >= expected;
    const followsPrevious = update.previousUpdateId === undefined || update.previousUpdateId === this.lastUpdateId;
    if (!bridgesSnapshot || !followsPrevious) {
      this.sequenceHealthy = false;
      return false;
    }
    for (const [price, quantity] of update.bids) this.setLevel(this.bids, price, quantity);
    for (const [price, quantity] of update.asks) this.setLevel(this.asks, price, quantity);
    this.lastUpdateId = update.finalUpdateId;
    this.lastEventTime = update.eventTime;
    return true;
  }

  invalidate(): void {
    this.sequenceHealthy = false;
  }

  state(now = Date.now()): OrderBookState {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]);
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]);
    const bestBid = bids[0]?.[0] ?? null;
    const bestAsk = asks[0]?.[0] ?? null;
    const midPrice = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    const depth = (levels: Array<[number, number]>, count: number) =>
      levels.slice(0, count).reduce((sum, [, quantity]) => sum + quantity, 0);
    const bidDepth5 = depth(bids, 5);
    const askDepth5 = depth(asks, 5);
    const bidDepth10 = depth(bids, 10);
    const askDepth10 = depth(asks, 10);
    const bidDepth20 = depth(bids, 20);
    const askDepth20 = depth(asks, 20);
    const imbalance = (bid: number, ask: number) => bid + ask === 0 ? null : (bid - ask) / (bid + ask);
    const microPrice = bestBid !== null && bestAsk !== null && bidDepth5 + askDepth5 > 0
      ? (bestAsk * bidDepth5 + bestBid * askDepth5) / (bidDepth5 + askDepth5)
      : null;
    const weightedMidPrice = bestBid !== null && bestAsk !== null && bidDepth10 + askDepth10 > 0
      ? (bestBid * askDepth10 + bestAsk * bidDepth10) / (bidDepth10 + askDepth10)
      : null;
    return {
      bestBid,
      bestAsk,
      midPrice,
      spread,
      spreadBps: spread !== null && midPrice ? (spread / midPrice) * 10_000 : null,
      bidDepth5,
      askDepth5,
      bidDepth10,
      askDepth10,
      bidDepth20,
      askDepth20,
      imbalance5: imbalance(bidDepth5, askDepth5),
      imbalance10: imbalance(bidDepth10, askDepth10),
      imbalance20: imbalance(bidDepth20, askDepth20),
      microPrice,
      weightedMidPrice,
      bidWall: bids.slice(0, 20).sort((a, b) => b[1] - a[1])[0] ?? null,
      askWall: asks.slice(0, 20).sort((a, b) => b[1] - a[1])[0] ?? null,
      estimatedBuySlippage: this.estimateSlippage(asks, 1),
      estimatedSellSlippage: this.estimateSlippage(bids, 1),
      lastUpdateId: this.lastUpdateId,
      lastEventTime: this.lastEventTime,
      dataAgeMs: this.lastEventTime === null ? null : Math.max(0, now - this.lastEventTime),
      sequenceHealthy: this.sequenceHealthy,
    };
  }

  private setLevel(book: Map<number, number>, price: number, quantity: number): void {
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity < 0) {
      throw new Error('Invalid order-book level');
    }
    if (quantity === 0) book.delete(price);
    else book.set(price, quantity);
  }

  private estimateSlippage(levels: Array<[number, number]>, targetQuantity: number): number | null {
    if (!levels.length) return null;
    let remaining = targetQuantity;
    let notional = 0;
    let filled = 0;
    for (const [price, quantity] of levels) {
      const amount = Math.min(remaining, quantity);
      notional += amount * price;
      filled += amount;
      remaining -= amount;
      if (remaining <= 0) break;
    }
    return filled === 0 ? null : notional / filled;
  }
}
