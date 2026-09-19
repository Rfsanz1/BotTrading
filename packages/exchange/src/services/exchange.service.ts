import { Logger } from '@nestjs/common';
import { IExchange } from '../IExchange';
import { ExchangeAccount } from '../types';
import { createExchange } from '../factory';

/**
 * ExchangeService manages exchange adapter instances and connections
 * Handles lifecycle management of exchange connections
 */
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);
  private adapters: Map<string, IExchange> = new Map();

  /**
   * Get or create an exchange adapter for the given account
   * Adapters are cached by accountId to reuse connections
   */
  async getExchange(account: ExchangeAccount): Promise<IExchange> {
    const cacheKey = `${account.exchange}:${account.id}`;

    if (this.adapters.has(cacheKey)) {
      return this.adapters.get(cacheKey)!;
    }

    try {
      const adapter = createExchange(account.exchange as any, account);
      await adapter.connect(account);
      
      this.adapters.set(cacheKey, adapter);
      this.logger.log(`Created exchange adapter for ${account.exchange} account ${account.id}`);

      return adapter;
    } catch (error) {
      this.logger.error(
        `Failed to create exchange adapter for ${account.exchange}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Release an exchange adapter connection
   */
  async releaseExchange(accountId: string, exchange: string): Promise<void> {
    const cacheKey = `${exchange}:${accountId}`;
    
    const adapter = this.adapters.get(cacheKey);
    if (adapter) {
      try {
        await adapter.disconnect();
        this.adapters.delete(cacheKey);
        this.logger.log(`Released exchange adapter for ${exchange} account ${accountId}`);
      } catch (error) {
        this.logger.error(
          `Error disconnecting from ${exchange}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /**
   * Release all connections (cleanup)
   */
  async releaseAll(): Promise<void> {
    const disconnectPromises = Array.from(this.adapters.values()).map((adapter) =>
      adapter.disconnect().catch((error) => {
        this.logger.error(
          `Error disconnecting adapter:`,
          error instanceof Error ? error.message : String(error),
        );
      }),
    );

    await Promise.all(disconnectPromises);
    this.adapters.clear();
    this.logger.log('Released all exchange adapters');
  }
}

export default ExchangeService;
