/**
 * Custom Validation Decorators for Trading Module
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validate that price is positive
 */
@ValidatorConstraint({ name: 'isPositivePrice', async: false })
export class IsPositivePriceConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'number') return false;
    return value > 0;
  }

  defaultMessage(): string {
    return 'Price must be a positive number';
  }
}

export function IsPositivePrice(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPositivePriceConstraint,
    });
  };
}

/**
 * Validate that quantity is positive
 */
@ValidatorConstraint({ name: 'isPositiveQuantity', async: false })
export class IsPositiveQuantityConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'number') return false;
    return value > 0;
  }

  defaultMessage(): string {
    return 'Quantity must be a positive number';
  }
}

export function IsPositiveQuantity(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPositiveQuantityConstraint,
    });
  };
}

/**
 * Validate that risk percentage is within range (0.1% - 10%)
 */
@ValidatorConstraint({ name: 'isValidRiskPercent', async: false })
export class IsValidRiskPercentConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'number') return false;
    return value >= 0.1 && value <= 10;
  }

  defaultMessage(): string {
    return 'Risk percentage must be between 0.1% and 10%';
  }
}

export function IsValidRiskPercent(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidRiskPercentConstraint,
    });
  };
}

/**
 * Validate that stop loss is below entry price for BUY orders
 */
@ValidatorConstraint({ name: 'isValidStopLoss', async: false })
export class IsValidStopLossConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: any): boolean {
    if (!value) return true; // Optional field
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];
    if (typeof value !== 'number' || typeof relatedValue !== 'number') return false;
    return value > 0 && value !== relatedValue;
  }

  defaultMessage(args: any): string {
    return `Stop loss must be a positive number different from entry price`;
  }
}

export function IsValidStopLoss(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsValidStopLossConstraint,
    });
  };
}

/**
 * Validate that take profit is above entry price for BUY orders
 */
@ValidatorConstraint({ name: 'isValidTakeProfit', async: false })
export class IsValidTakeProfitConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: any): boolean {
    if (!value) return true; // Optional field
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];
    if (typeof value !== 'number' || typeof relatedValue !== 'number') return false;
    return value > 0 && value !== relatedValue;
  }

  defaultMessage(): string {
    return `Take profit must be a positive number different from entry price`;
  }
}

export function IsValidTakeProfit(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsValidTakeProfitConstraint,
    });
  };
}

/**
 * Validate exchange name
 */
@ValidatorConstraint({ name: 'isValidExchange', async: false })
export class IsValidExchangeConstraint implements ValidatorConstraintInterface {
  private validExchanges = ['binance', 'coinbase', 'kraken', 'bitfinex'];

  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    return this.validExchanges.includes(value.toLowerCase());
  }

  defaultMessage(): string {
    return 'Exchange must be one of: binance, coinbase, kraken, bitfinex';
  }
}

export function IsValidExchange(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidExchangeConstraint,
    });
  };
}

/**
 * Validate order side
 */
@ValidatorConstraint({ name: 'isValidOrderSide', async: false })
export class IsValidOrderSideConstraint implements ValidatorConstraintInterface {
  private validSides = ['BUY', 'SELL'];

  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    return this.validSides.includes(value.toUpperCase());
  }

  defaultMessage(): string {
    return 'Order side must be BUY or SELL';
  }
}

export function IsValidOrderSide(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidOrderSideConstraint,
    });
  };
}

/**
 * Validate symbol format (e.g., BTCUSDT, ETHUSDT)
 */
@ValidatorConstraint({ name: 'isValidSymbol', async: false })
export class IsValidSymbolConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    // Should be 2-12 characters, alphanumeric
    return /^[A-Z0-9]{2,12}$/.test(value);
  }

  defaultMessage(): string {
    return 'Symbol must be alphanumeric and 2-12 characters long (e.g., BTCUSDT)';
  }
}

export function IsValidSymbol(validationOptions?: ValidationOptions) {
  return function (target: Object, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidSymbolConstraint,
    });
  };
}
