import { createExchange } from '../factory';
import { ExchangeName } from '../factory';

export class RiskService {
  async assess(accountId: string, exchange: ExchangeName) {
    const ex = createExchange(exchange);
    await ex.connect({ id: accountId, userId: 'system', exchange, isActive: true });
    const positions = await ex.fetchOpenPositions();
    const balances = await ex.fetchBalances();
    await ex.disconnect();
    // simple risk metrics
    const totalPositions = positions.length;
    const exposure = positions.reduce((s: number, p: any) => s + Number(p.quantity || 0) * Number(p.entryPrice || 0), 0);
    return { totalPositions, exposure, balances } as any;
  }
}

export default new RiskService();
