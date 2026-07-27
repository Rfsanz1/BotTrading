export interface TradingViewAlert {
  symbol: string;
  price?: number;
  side?: 'buy' | 'sell' | 'long' | 'short' | 'neutral';
  meta?: Record<string, any>;
}

export interface TradingViewProvider {
  parseWebhook(payload: any): TradingViewAlert[];
}
