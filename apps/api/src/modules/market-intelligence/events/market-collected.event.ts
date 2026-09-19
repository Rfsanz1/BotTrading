export class MarketCollectedEvent {
  constructor(
    public readonly source: string,
    public readonly symbol: string,
    public readonly timeframe: string,
    public readonly snapshot: Record<string, unknown>,
  ) {}
}
