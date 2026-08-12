/**
 * Symbol Validator Service
 * PHASE 1: Precision/lot size validation
 * Validates order quantities against exchange symbol filters (LOT_SIZE, MIN_NOTIONAL, etc)
 */

import { Injectable, Logger } from '@nestjs/common';
import { IExchange } from './IExchange';
import { OrderParams } from './types';

interface SymbolFilter {
  filterType: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  applyToMarket?: boolean;
  avgPriceMins?: number;
}

interface SymbolInfo {
  symbol: string;
  status: string;
  filters: SymbolFilter[];
}

/**
 * Validates and rounds order quantities according to exchange symbol rules
 */
@Injectable()
export class SymbolValidator {
  private readonly logger = new Logger(SymbolValidator.name);
  private symbolCache: Map<string, SymbolInfo> = new Map();

  /**
   * Validate and fix order parameters for the given symbol
   * Returns corrected OrderParams that will be accepted by exchange
   */
  async validateAndFixOrderParams(
    exchange: IExchange,
    symbol: string,
    params: OrderParams,
  ): Promise<OrderParams> {
    try {
      // Get symbol filters
      const symbolInfo = await this.getSymbolInfo(exchange, symbol);

      if (!symbolInfo) {
        this.logger.warn(`No symbol info found for ${symbol}, using raw params`);
        return params;
      }

      // Validate quantity against LOT_SIZE filter
      params = this.validateLotSize(params, symbolInfo);

      // Validate notional value (quantity × price) against MIN_NOTIONAL
      if (params.price) {
        params = this.validateNotional(params, symbolInfo);
      }

      // Validate price against PRICE_FILTER
      if (params.price) {
        params = this.validatePrice(params, symbolInfo);
      }

      return params;
    } catch (error) {
      this.logger.warn(
        `Symbol validation error for ${symbol}: ${error instanceof Error ? error.message : String(error)}, using raw params`,
      );
      return params; // Fallback to raw params if validation fails
    }
  }

  /**
   * Validate LOT_SIZE (quantity step size)
   * Example: Binance BTC LOT_SIZE is 0.00001, so quantity must be multiple of 0.00001
   */
  private validateLotSize(params: OrderParams, symbolInfo: SymbolInfo): OrderParams {
    const lotSizeFilter = symbolInfo.filters.find((f) => f.filterType === 'LOT_SIZE');

    if (!lotSizeFilter) {
      return params;
    }

    const minQty = parseFloat(lotSizeFilter.minQty || '0');
    const maxQty = parseFloat(lotSizeFilter.maxQty || '999999999');
    const stepSize = parseFloat(lotSizeFilter.stepSize || '1');
    const quantity = parseFloat(params.quantity);

    // Check minimum quantity
    if (quantity < minQty) {
      this.logger.warn(
        `Quantity ${quantity} below minimum ${minQty} for ${symbolInfo.symbol}`,
      );
      throw new Error(
        `Quantity ${quantity} below minimum ${minQty} for ${symbolInfo.symbol}`,
      );
    }

    // Check maximum quantity
    if (quantity > maxQty) {
      this.logger.warn(
        `Quantity ${quantity} above maximum ${maxQty} for ${symbolInfo.symbol}`,
      );
      throw new Error(
        `Quantity ${quantity} above maximum ${maxQty} for ${symbolInfo.symbol}`,
      );
    }

    // Round quantity to step size
    if (stepSize > 0) {
      const rounded = Math.floor(quantity / stepSize) * stepSize;

      if (rounded !== quantity) {
        this.logger.log(
          `Rounding quantity ${quantity} to ${rounded} (stepSize: ${stepSize})`,
        );
        params = { ...params, quantity: rounded.toString() };
      }
    }

    return params;
  }

  /**
   * Validate MIN_NOTIONAL (minimum order value)
   * Notional = quantity × price, must be >= MIN_NOTIONAL
   */
  private validateNotional(params: OrderParams, symbolInfo: SymbolInfo): OrderParams {
    const notionalFilter = symbolInfo.filters.find((f) => f.filterType === 'MIN_NOTIONAL');

    if (!notionalFilter || !notionalFilter.minNotional) {
      return params;
    }

    const minNotional = parseFloat(notionalFilter.minNotional);
    const quantity = parseFloat(params.quantity);
    const price = parseFloat(params.price || '0');
    const notional = quantity * price;

    if (notional < minNotional) {
      this.logger.warn(
        `Notional ${notional} below minimum ${minNotional} for ${symbolInfo.symbol}`,
      );
      throw new Error(
        `Order value (${notional}) below minimum ${minNotional} for ${symbolInfo.symbol}`,
      );
    }

    return params;
  }

  /**
   * Validate PRICE_FILTER (price step size and min/max)
   */
  private validatePrice(params: OrderParams, symbolInfo: SymbolInfo): OrderParams {
    const priceFilter = symbolInfo.filters.find((f) => f.filterType === 'PRICE_FILTER');

    if (!priceFilter) {
      return params;
    }

    const minPrice = parseFloat(priceFilter.minQty || '0');
    const maxPrice = parseFloat(priceFilter.maxQty || '999999999');
    const tickSize = parseFloat(priceFilter.stepSize || '1');
    const price = parseFloat(params.price || '0');

    // Check price bounds
    if (price < minPrice || price > maxPrice) {
      this.logger.warn(
        `Price ${price} outside bounds [${minPrice}, ${maxPrice}] for ${symbolInfo.symbol}`,
      );
      throw new Error(
        `Price ${price} outside bounds [${minPrice}, ${maxPrice}] for ${symbolInfo.symbol}`,
      );
    }

    // Round price to tick size
    if (tickSize > 0) {
      const rounded = Math.round(price / tickSize) * tickSize;

      if (Math.abs(rounded - price) > 0.00000001) {
        this.logger.log(
          `Rounding price ${price} to ${rounded} (tickSize: ${tickSize})`,
        );
        params = { ...params, price: rounded.toString() };
      }
    }

    return params;
  }

  /**
   * Get symbol info from exchange (with caching)
   */
  private async getSymbolInfo(
    exchange: IExchange,
    symbol: string,
  ): Promise<SymbolInfo | null> {
    // Check cache first
    if (this.symbolCache.has(symbol)) {
      return this.symbolCache.get(symbol)!;
    }

    // For now, return null since exchange adapter doesn't expose symbol info
    // TODO: Implement exchangeInfo endpoint in adapter
    this.logger.debug(`No cached symbol info for ${symbol}`);
    return null;
  }

  /**
   * Clear symbol cache
   */
  clearCache(): void {
    this.symbolCache.clear();
  }
}

export default SymbolValidator;
