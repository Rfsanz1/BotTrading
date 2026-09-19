export class MarketAggregationEvent {
  constructor(
    public readonly symbol: string,
    public readonly timeframe: string,
    public readonly aggregated: Record<string, unknown>,
  ) {}
}
