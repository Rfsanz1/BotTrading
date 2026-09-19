import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import prisma from '@rfsanz/database';
import { BalanceSyncService, PnLCalculationService, PositionService, SymbolValidator } from '@rfsanz/exchange';
import { TradingService } from '../modules/trading/trading.service';
import { UsersController } from '../modules/users/users.controller';
import { UsersService } from '../modules/users/users.service';
import { AdminGuard } from '../guards/admin.guard';
import { JwtAuthGuard, verifyAccessToken } from '../guards/jwt-auth.guard';

const jwtSecret = 'integration-proof-secret-012345678901234567890123';
process.env.JWT_ACCESS_SECRET = jwtSecret;
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
jest.setTimeout(30000);

type Fixture = {
  userId: string;
  otherUserId: string;
  accountId: string;
  orderIds: string[];
  positionIds: string[];
  alertIds: string[];
  consensusIds: string[];
  recommendationIds: string[];
};

function contextFor(request: Record<string, unknown>): any {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  };
}

function tokenFor(subject: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({ sub: subject, iat: now, exp: now + 900 });
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', jwtSecret).update(input).digest('base64url')}`;
}

async function expectRejected(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toBeDefined();
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `proof-${suffix}@invalid.local`, name: 'integration-proof' } });
  const other = await prisma.user.create({ data: { email: `proof-other-${suffix}@invalid.local`, name: 'integration-proof-other' } });
  const account = await prisma.exchangeAccount.create({
    data: { userId: user.id, exchange: 'binance', accountId: `proof-${suffix}`, isActive: true },
  });
  return {
    userId: user.id,
    otherUserId: other.id,
    accountId: account.id,
    orderIds: [],
    positionIds: [],
    alertIds: [],
    consensusIds: [],
    recommendationIds: [],
  };
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (!fixture) return;
  await prisma.orderAnalysisLink.deleteMany({ where: { orderId: { in: fixture.orderIds } } });
  await prisma.trade.deleteMany({ where: { orderId: { in: fixture.orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: fixture.orderIds } } });
  await prisma.position.deleteMany({ where: { id: { in: fixture.positionIds } } });
  await prisma.recommendation.deleteMany({ where: { id: { in: fixture.recommendationIds } } });
  await prisma.consensus.deleteMany({ where: { id: { in: fixture.consensusIds } } });
  await prisma.alert.deleteMany({ where: { id: { in: fixture.alertIds } } });
  await prisma.apiKey.deleteMany({ where: { userId: { in: [fixture.userId, fixture.otherUserId] } } });
  await prisma.exchangeAccount.deleteMany({ where: { id: fixture.accountId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [fixture.userId, fixture.otherUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [fixture.userId, fixture.otherUserId] } } });
}

function buildTradingService(): TradingService {
  return new TradingService(
    new EventEmitter2(),
    new SymbolValidator(),
    new PositionService(),
    new BalanceSyncService(),
    new PnLCalculationService(),
  );
}

describe('real PostgreSQL execution proof', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  });

  afterAll(async () => {
    await cleanup(fixture);
    await prisma.$disconnect();
  });

  it('enforces authentication, admin, ownership, and JWT subject authority', async () => {
    const users = new UsersService();
    const controller = new UsersController(users);
    const adminGuard = new AdminGuard();
    const jwtGuard = new JwtAuthGuard({ getAllAndOverride: () => false } as any);

    await expectRejected(() => adminGuard.canActivate(contextFor({ user: undefined })));
    await expectRejected(() => adminGuard.canActivate(contextFor({ user: { id: fixture.userId } })));
    await expectRejected(() => controller.get(fixture.otherUserId, { user: { id: fixture.userId, roles: [] } }));

    const request: any = {
      headers: { authorization: `Bearer ${tokenFor(fixture.userId)}`, 'x-user-id': fixture.otherUserId },
      body: { userId: fixture.otherUserId },
      params: { id: fixture.otherUserId },
    };
    expect(jwtGuard.canActivate(contextFor(request))).toBe(true);
    expect(request.user.id).toBe(fixture.userId);
    expect(request.user.id).not.toBe(request.headers['x-user-id']);
    expect(request.user.id).not.toBe(request.body.userId);
    expect(verifyAccessToken(request.headers.authorization.slice(7), jwtSecret).sub).toBe(fixture.userId);
  });

  it('persists one authoritative fill across REST/WebSocket/replay and preserves cumulative accounting', async () => {
    const service = buildTradingService();
    const order = await prisma.order.create({
      data: {
        userId: fixture.userId,
        exchange: 'binance',
        externalId: `proof-order-${randomUUID()}`,
        symbol: 'PROOFUSDT',
        side: 'BUY',
        price: 100,
        quantity: 1,
        filled: 0,
        status: 'NEW',
      },
    });
    fixture.orderIds.push(order.id);

    const event = {
      kind: 'FILL' as const,
      source: 'binance',
      orderId: order.externalId!,
      exchangeTradeId: 'proof-trade-1',
      symbol: order.symbol,
      side: 'BUY',
      status: 'FILLED',
      filledQuantity: 1,
      averagePrice: 100,
      fee: 0.1,
    };
    await service.persistExchangeEvent(event);
    await service.persistExchangeEvent(event);
    await service.persistExchangeEvent({ ...event });

    const persisted = await prisma.order.findUnique({ where: { id: order.id }, include: { trades: true } });
    expect(persisted?.status).toBe('FILLED');
    expect(Number(persisted?.filled)).toBe(1);
    expect(persisted?.trades).toHaveLength(1);
    expect(Number(persisted?.trades[0].quantity)).toBe(1);
    const position = await prisma.position.findFirst({ where: { userId: fixture.userId, symbol: order.symbol, status: 'OPEN' } });
    expect(position).toBeTruthy();
    expect(Number(position?.quantity)).toBe(1);
    fixture.positionIds.push(position!.id);
  });

  it('keeps UNKNOWN/unfilled state safe, closes only on authoritative execution, ignores fake close price, and rejects over-close', async () => {
    const service = buildTradingService();
    const position = await prisma.position.create({
      data: { userId: fixture.userId, symbol: 'CLOSEUSDT', side: 'BUY', entryPrice: 100, quantity: 1, status: 'OPEN' },
    });
    fixture.positionIds.push(position.id);
    const alert = await prisma.alert.create({
      data: { userId: fixture.userId, symbol: position.symbol, status: 'RECOMMENDED', webhookSource: 'integration-proof' },
    });
    fixture.alertIds.push(alert.id);
    const consensus = await prisma.consensus.create({
      data: {
        alertId: alert.id,
        symbol: position.symbol,
        recommendation: 'SELL',
        confidenceScore: 1,
        riskScore: 0,
        bulletPoints: ['integration proof'],
        analysis: 'integration proof',
        providerVotes: {},
      },
    });
    fixture.consensusIds.push(consensus.id);
    const recommendation = await prisma.recommendation.create({
      data: {
        consensusId: consensus.id,
        alertId: alert.id,
        userId: fixture.userId,
        symbol: position.symbol,
        recommendationType: 'SELL',
        entryPrice: 100,
        targetPrice: 90,
        stopLoss: 110,
        urgency: 'IMMEDIATE',
        reasoning: 'integration proof',
      },
    });
    fixture.recommendationIds.push(recommendation.id);
    const closeOrderId = await service.createOrder({
      userId: fixture.userId,
      recommendationId: recommendation.id,
      symbol: position.symbol,
      side: 'SELL',
      quantity: 1,
      price: 100,
      exchange: 'binance',
      intent: 'CLOSE',
      positionId: position.id,
    });
    const closeOrder = await prisma.order.update({
      where: { id: closeOrderId },
      data: { externalId: `proof-close-${randomUUID()}`, meta: { intent: 'CLOSE', positionId: position.id, closingPrice: 999999 } },
    });
    fixture.orderIds.push(closeOrder.id);

    const before = await prisma.position.findUnique({ where: { id: position.id } });
    expect(before?.status).toBe('OPEN');
    await service.persistExchangeEvent({
      kind: 'ORDER',
      source: 'binance',
      orderId: closeOrder.externalId!,
      symbol: position.symbol,
      side: 'SELL',
      status: 'NEW',
      filledQuantity: 0,
    });
    const unfilled = await prisma.position.findUnique({ where: { id: position.id } });
    expect(unfilled?.status).toBe('OPEN');
    expect(Number(unfilled?.quantity)).toBe(1);

    await service.persistExchangeEvent({
      kind: 'FILL',
      source: 'binance',
      orderId: closeOrder.externalId!,
      exchangeTradeId: 'proof-close-trade-1',
      symbol: position.symbol,
      side: 'SELL',
      status: 'FILLED',
      filledQuantity: 1,
      averagePrice: 110,
      fee: 0,
    });
    const closed = await prisma.position.findUnique({ where: { id: position.id } });
    expect(closed?.status).toBe('CLOSED');
    expect(Number(closed?.quantity)).toBe(0);
    expect(Number(closed?.realizedPnL)).toBe(10);

    const partialPosition = await prisma.position.create({
      data: { userId: fixture.userId, symbol: 'PARTIALUSDT', side: 'BUY', entryPrice: 100, quantity: 2, status: 'OPEN' },
    });
    fixture.positionIds.push(partialPosition.id);
    const partialOrder = await prisma.order.create({
      data: {
        userId: fixture.userId,
        exchange: 'binance',
        externalId: `proof-partial-${randomUUID()}`,
        symbol: partialPosition.symbol,
        side: 'SELL',
        price: 1,
        quantity: 3,
        filled: 0,
        status: 'NEW',
        meta: { intent: 'CLOSE', positionId: partialPosition.id },
      },
    });
    fixture.orderIds.push(partialOrder.id);
    await service.persistExchangeEvent({
      kind: 'FILL',
      source: 'binance',
      orderId: partialOrder.externalId!,
      exchangeTradeId: 'proof-partial-trade-1',
      symbol: partialPosition.symbol,
      side: 'SELL',
      status: 'PARTIALLY_FILLED',
      filledQuantity: 0.5,
      averagePrice: 120,
      fee: 0,
    });
    const partial = await prisma.position.findUnique({ where: { id: partialPosition.id } });
    expect(partial?.status).toBe('OPEN');
    expect(Number(partial?.quantity)).toBe(1.5);
    await expectRejected(() => service.persistExchangeEvent({
      kind: 'FILL',
      source: 'binance',
      orderId: partialOrder.externalId!,
      exchangeTradeId: 'proof-partial-overclose',
      symbol: partialPosition.symbol,
      side: 'SELL',
      status: 'FILLED',
      filledQuantity: 2.5,
      averagePrice: 120,
      fee: 0,
    }));
    const safe = await prisma.position.findUnique({ where: { id: partialPosition.id } });
    expect(safe?.status).toBe('OPEN');
    expect(Number(safe?.quantity)).toBe(1.5);
  });
});
