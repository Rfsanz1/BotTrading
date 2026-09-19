import prisma from '@rfsanz/database';

export async function applyPaperMarketFixture(
  orderId: string,
  bid: number,
  ask: number,
): Promise<void> {
  if (process.env.TRADING_MODE !== 'PAPER') {
    throw new Error('PAPER market fixture is only available in PAPER mode');
  }
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= bid) {
    throw new Error('PAPER market fixture requires a positive bid/ask spread');
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { meta: true } });
  if (!order) throw new Error(`PAPER market fixture order not found: ${orderId}`);

  const now = new Date();
  const midpoint = (bid + ask) / 2;
  const spread = Math.max((ask - bid) / Math.max(midpoint, Number.EPSILON), 1e-6);
  const currentMeta = (order.meta && typeof order.meta === 'object' && !Array.isArray(order.meta))
    ? order.meta as Record<string, unknown>
    : {};

  await prisma.order.update({
    where: { id: orderId },
    data: {
      meta: {
        ...currentMeta,
        bid,
        ask,
        last: midpoint,
        spread,
        liquidity: 100000,
        slippage: 0,
        volatility: 0.0005,
        stale: false,
        marketTimestamp: now.toISOString(),
        marketSource: 'PAPER_DETERMINISTIC_FIXTURE',
        marketAuthority: 'PAPER_FIXTURE',
      },
    },
  });
}
