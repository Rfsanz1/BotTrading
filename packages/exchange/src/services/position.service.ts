import { createExchange } from '../factory';
import { ExchangeName } from '../factory';

export class PositionService {
  async listOpen(accountId: string, exchange: ExchangeName) {
    const ex = createExchange(exchange);
    await ex.connect({ id: accountId, userId: 'system', exchange, isActive: true });
    const pos = await ex.fetchOpenPositions();
    await ex.disconnect();
    return pos;
  }
}

export default new PositionService();
