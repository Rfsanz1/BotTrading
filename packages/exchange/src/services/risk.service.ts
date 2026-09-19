import { createExchange } from '../factory';
import { ExchangeName } from '../factory';

export class RiskService {
  async assess(accountId: string, exchange: ExchangeName) {
    const tradingMode = process.env.TRADING_MODE as 'PAPER' | 'TESTNET' | 'LIVE' | undefined;
    const account = { id: accountId, userId: 'system', exchange, isActive: true, isPaper: tradingMode === 'PAPER', tradingMode };
    const ex = createExchange(exchange, account);
    await ex.connect(account);
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
