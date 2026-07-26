import { createExchange } from '../factory';
import { ExchangeName } from '../factory';

export class PortfolioService {
  async syncBalances(accountId: string, exchange: ExchangeName) {
    const ex = createExchange(exchange);
    await ex.connect({ id: accountId, userId: 'system', exchange, isActive: true });
    const balances = await ex.fetchBalances();
    await ex.disconnect();
    // map and persist balances to DB as needed
    return balances;
  }
}

export default new PortfolioService();
