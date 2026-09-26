import { Injectable } from '@nestjs/common';

export interface LiquidationEvent {
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: number;
}

@Injectable()
export class LiquidationService {
  private readonly history: LiquidationEvent[] = [];

  record(event: LiquidationEvent): {
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    imbalance: number | null;
    level: 'LIQUIDATION_NORMAL' | 'LIQUIDATION_ELEVATED' | 'LIQUIDATION_SPIKE';
    zScore: number | null;
    lastLiquidationTime: number;
  } {
    if (!Number.isFinite(event.quantity) || event.quantity <= 0 || !Number.isFinite(event.price)) throw new Error('Invalid liquidation event');
    this.history.push(event);
    while (this.history.length && this.history[0].timestamp < event.timestamp - 60 * 60 * 1000) this.history.shift();
    const recent = this.history.filter((item) => item.timestamp >= event.timestamp - 15 * 60 * 1000);
    const totalVolume = recent.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const buyVolume = recent.filter((item) => item.side === 'BUY').reduce((sum, item) => sum + item.quantity * item.price, 0);
    const sellVolume = recent.filter((item) => item.side === 'SELL').reduce((sum, item) => sum + item.quantity * item.price, 0);
    const hourly = this.history.filter((item) => item.timestamp < event.timestamp - 15 * 60 * 1000)
      .map((item) => item.quantity * item.price);
    const mean = hourly.length ? hourly.reduce((sum, value) => sum + value, 0) / hourly.length : totalVolume;
    const std = hourly.length > 1 ? Math.sqrt(hourly.reduce((sum, value) => sum + (value - mean) ** 2, 0) / hourly.length) : 0;
    const zScore = std === 0 ? null : (totalVolume - mean) / std;
    return {
      buyVolume,
      sellVolume,
      totalVolume,
      imbalance: totalVolume === 0 ? null : (buyVolume - sellVolume) / totalVolume,
      level: zScore !== null && zScore >= 3 ? 'LIQUIDATION_SPIKE' : zScore !== null && zScore >= 2 ? 'LIQUIDATION_ELEVATED' : 'LIQUIDATION_NORMAL',
      zScore,
      lastLiquidationTime: event.timestamp,
    };
  }
}
