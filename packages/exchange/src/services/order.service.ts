import { createExchange } from '../factory';
import { ExchangeName, createExchange as _createExchange } from '../factory';
import { OrderParams, Order } from '../types';

export class OrderService {
  async place(accountId: string, exchange: ExchangeName, params: OrderParams): Promise<Order> {
    const ex = createExchange(exchange);
    await ex.connect({ id: accountId, userId: 'system', exchange, isActive: true });
    const order = await ex.placeOrder(params);
    // persist to DB via @rfsanz/database if needed
    await ex.disconnect();
    return order;
  }

  async cancel(accountId: string, exchange: ExchangeName, orderId: string): Promise<void> {
    const ex = createExchange(exchange);
    await ex.connect({ id: accountId, userId: 'system', exchange, isActive: true });
    await ex.cancelOrder(orderId);
    await ex.disconnect();
  }
}

export default new OrderService();
