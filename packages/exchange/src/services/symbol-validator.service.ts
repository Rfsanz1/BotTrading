import { Injectable, Logger } from '@nestjs/common';
import { IExchange, ExchangeSymbolInfo, ExchangeSymbolFilter } from '../IExchange';
import { OrderParams } from '../types';

type RoundingMode = 'floor' | 'ceil' | 'nearest';

type DecimalValue = {
  coefficient: bigint;
  scale: number;
};

function parseDecimal(value: string): DecimalValue {
  const text = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid decimal value: ${value}`);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const coefficient = BigInt(`${whole}${fraction}` || '0') * (negative ? -1n : 1n);
  return { coefficient, scale: fraction.length };
}

function pow10(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function align(value: DecimalValue, scale: number): bigint {
  return value.coefficient * pow10(scale - value.scale);
}

function decimalToString(value: DecimalValue): string {
  const negative = value.coefficient < 0n;
  const absolute = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, '0');
  if (value.scale === 0) return `${negative ? '-' : ''}${absolute}`;
  const split = absolute.length - value.scale;
  const whole = absolute.slice(0, split);
  const fraction = absolute.slice(split).replace(/0+$/, '');
  return fraction.length === 0
    ? `${negative ? '-' : ''}${whole}`
    : `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function normalizeDecimalToStep(value: string, step: string, mode: RoundingMode): string {
  const parsed = parseDecimal(value);
  const increment = parseDecimal(step);
  if (increment.coefficient <= 0n) throw new Error(`Invalid decimal step: ${step}`);
  const scale = Math.max(parsed.scale, increment.scale);
  const raw = align(parsed, scale);
  const unit = align(increment, scale);
  let quotient = raw / unit;
  const remainder = raw % unit;
  if (remainder !== 0n) {
    if (mode === 'ceil' && raw > 0n) quotient += 1n;
    if (mode === 'floor' && raw < 0n) quotient -= 1n;
    if (mode === 'nearest' && (remainder * 2n >= unit)) quotient += raw >= 0n ? 1n : -1n;
  }
  return decimalToString({ coefficient: quotient * unit, scale });
}

export function normalizePriceForSide(price: string, tickSize: string, side: 'BUY' | 'SELL'): string {
  return normalizeDecimalToStep(price, tickSize, side === 'BUY' ? 'floor' : 'ceil');
}

interface SymbolFilter extends ExchangeSymbolFilter {}

@Injectable()
export class SymbolValidator {
  private readonly logger = new Logger(SymbolValidator.name);
  private symbolCache = new Map<string, ExchangeSymbolInfo>();

  async validateAndFixOrderParams(
    exchange: IExchange,
    symbol: string,
    params: OrderParams,
  ): Promise<OrderParams> {
    const symbolInfo = await this.getSymbolInfo(exchange, symbol);
    if (!symbolInfo) return params;
    let validated = this.validateLotSize(params, symbolInfo);
    if (validated.price) validated = this.validatePrice(validated, symbolInfo);
    if (validated.price) validated = this.validateNotional(validated, symbolInfo);
    return validated;
  }

  normalizeProtectionPrice(price: number | undefined, exchangeInfo: ExchangeSymbolInfo, side: 'BUY' | 'SELL', kind: 'stop' | 'target'): number | undefined {
    if (price === undefined) return undefined;
    const filter = this.findFilter(exchangeInfo, 'PRICE_FILTER');
    if (!filter?.tickSize) return price;
    const mode = side === 'BUY'
      ? (kind === 'stop' ? 'floor' : 'ceil')
      : (kind === 'stop' ? 'ceil' : 'floor');
    return Number(normalizeDecimalToStep(String(price), filter.tickSize, mode));
  }

  async getExchangeSymbolInfo(exchange: IExchange, symbol: string): Promise<ExchangeSymbolInfo | null> {
    return this.getSymbolInfo(exchange, symbol);
  }

  clearCache(): void {
    this.symbolCache.clear();
  }

  private validateLotSize(params: OrderParams, symbolInfo: ExchangeSymbolInfo): OrderParams {
    const filter = this.findFilter(symbolInfo, 'LOT_SIZE');
    if (!filter?.stepSize) return params;
    const quantity = Number(params.quantity);
    const min = Number(filter.minQty ?? '0');
    const max = Number(filter.maxQty ?? Number.MAX_VALUE);
    if (!Number.isFinite(quantity) || quantity < min || quantity > max) {
      throw new Error(`Quantity ${params.quantity} outside LOT_SIZE bounds for ${symbolInfo.symbol}`);
    }
    const normalized = normalizeDecimalToStep(params.quantity, filter.stepSize, 'floor');
    if (Number(normalized) < min) throw new Error(`Quantity ${normalized} below minimum ${min} for ${symbolInfo.symbol}`);
    return { ...params, quantity: normalized };
  }

  private validatePrice(params: OrderParams, symbolInfo: ExchangeSymbolInfo): OrderParams {
    const filter = this.findFilter(symbolInfo, 'PRICE_FILTER');
    if (!filter?.tickSize || params.price === undefined) return params;
    const price = Number(params.price);
    const min = Number(filter.minPrice ?? '0');
    const max = Number(filter.maxPrice ?? Number.MAX_VALUE);
    if (!Number.isFinite(price) || price < min || price > max) {
      throw new Error(`Price ${params.price} outside PRICE_FILTER bounds for ${symbolInfo.symbol}`);
    }
    const normalized = normalizePriceForSide(params.price, filter.tickSize, params.side.toUpperCase() as 'BUY' | 'SELL');
    const normalizedNumber = Number(normalized);
    if (normalizedNumber < min || normalizedNumber > max) {
      throw new Error(`Normalized price ${normalized} outside PRICE_FILTER bounds for ${symbolInfo.symbol}`);
    }
    return { ...params, price: normalized };
  }

  private validateNotional(params: OrderParams, symbolInfo: ExchangeSymbolInfo): OrderParams {
    const filter = this.findFilter(symbolInfo, 'NOTIONAL') ?? this.findFilter(symbolInfo, 'MIN_NOTIONAL');
    if (!filter?.minNotional || params.price === undefined) return params;
    const notional = Number(params.quantity) * Number(params.price);
    if (!Number.isFinite(notional) || notional < Number(filter.minNotional)) {
      throw new Error(`Order value ${notional} below minimum ${filter.minNotional} for ${symbolInfo.symbol}`);
    }
    return params;
  }

  private findFilter(symbolInfo: ExchangeSymbolInfo, type: string): SymbolFilter | undefined {
    return symbolInfo.filters.find((filter) => filter.filterType === type);
  }

  private async getSymbolInfo(exchange: IExchange, symbol: string): Promise<ExchangeSymbolInfo | null> {
    const cached = this.symbolCache.get(symbol);
    if (cached) return cached;
    if (typeof exchange.fetchSymbolInfo !== 'function') {
      this.logger.warn(`Exchange does not expose symbol metadata for ${symbol}`);
      return null;
    }
    const info = await exchange.fetchSymbolInfo(symbol);
    this.symbolCache.set(symbol, info);
    return info;
  }
}

export default SymbolValidator;
