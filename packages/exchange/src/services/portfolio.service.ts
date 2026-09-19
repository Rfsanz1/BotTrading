import { createExchange } from '../factory';
import { ExchangeName } from '../factory';

export class PortfolioService {
  async syncBalances(accountId: string, exchange: ExchangeName) {
    const tradingMode = process.env.TRADING_MODE as 'PAPER' | 'TESTNET' | 'LIVE' | undefined;
    const account = { id: accountId, userId: 'system', exchange, isActive: true, isPaper: tradingMode === 'PAPER', tradingMode };
    const ex = createExchange(exchange, account);
    await ex.connect(account);
    const balances = await ex.fetchBalances();
    await ex.disconnect();
    // map and persist balances to DB as needed
    return balances;
  }
}

export default new PortfolioService();
