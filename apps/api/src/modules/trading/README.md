# Trading Module - Complete API Documentation

## Overview

The Trading Module provides comprehensive order management, position tracking, balance synchronization, and P&L reporting functionality. It's built with NestJS and integrates with multiple cryptocurrency exchanges (Binance, Coinbase, Kraken, Bitfinex) with testnet-safe defaults.

## Architecture

### Core Components

1. **TradingService** - Main orchestration service
   - Order lifecycle management
   - Position tracking
   - Balance synchronization
   - Event emission

2. **TradingController** - HTTP API endpoints
   - Order endpoints (Phase 1)
   - Position endpoints (Phase 2)
   - Balance sync endpoints (Phase 2)
   - P&L reporting endpoints (Phase 2)

3. **Services (Injected)**
   - `SymbolValidator` - Exchange symbol validation
   - `PositionService` - Position lifecycle management
   - `BalanceSyncService` - Balance tracking
   - `PnLCalculationService` - P&L analytics

4. **DTOs** - Request/Response validation
   - Order DTOs
   - Position DTOs
   - Balance DTOs
   - Response DTOs with Swagger documentation

5. **Event Handlers** - Async event processing
   - Order events
   - Position events
   - Balance events
   - Trade events

6. **Validators** - Custom validation rules
   - Price validation
   - Quantity validation
   - Risk percentage validation
   - Symbol format validation
   - Exchange validation

7. **Interceptors** - Global response/error handling
   - Standardized responses
   - Error formatting
   - Validation error handling

## API Endpoints

### Phase 1: Order Management

#### Create Order
```
POST /api/trading/orders/create
Body: CreateOrderDTO
Response: { success: true, data: { id: string } }
```

#### Submit Order to Exchange
```
POST /api/trading/orders/:orderId/submit
Response: { success: true, data: { ...orderDetails } }
```

#### Cancel Order
```
POST /api/trading/orders/:orderId/cancel
Response: { success: true, data: { ...cancelDetails } }
```

#### Get Order Details
```
GET /api/trading/orders/:orderId
Response: { success: true, data: OrderResponseDTO }
```

#### Record Trade Execution
```
POST /api/trading/trades/record
Body: RecordTradeDTO
Response: { success: true, data: { id: string } }
```

#### Calculate Position Size
```
POST /api/trading/position-size/calculate
Body: CalculatePositionSizeDTO
Response: { success: true, data: { positionSize: number } }
```

#### Sync Orders with Exchange
```
POST /api/trading/orders/sync
Body: SyncOrdersDTO
Response: { success: true, data: { exchange: string } }
```

### Phase 2: Position Management

#### Get Open Positions
```
GET /api/trading/positions/open
Response: { success: true, data: PositionResponseDTO[] }
```

#### Get Closed Positions
```
GET /api/trading/positions/closed
Response: { success: true, data: PositionResponseDTO[] }
```

#### Get Position Metrics
```
GET /api/trading/positions/:positionId
Response: { success: true, data: PositionMetricsResponseDTO }
```

#### Update Stop-Loss/Take-Profit
```
PATCH /api/trading/positions/:positionId/exit-levels
Body: UpdateStopLossTakeProfitDTO
Response: { success: true, data: { positionId: string } }
```

#### Close Position
```
POST /api/trading/positions/:positionId/close
Body: ClosePositionDTO
Response: { success: true, data: { positionId: string } }
```

### Phase 2: Balance Synchronization

#### Sync Balances from Exchange
```
POST /api/trading/balance/sync
Body: SyncBalancesDTO
Response: { success: true, data: { ...syncDetails } }
```

#### Get Current Balances
```
GET /api/trading/balance/current/:exchange
Response: { success: true, data: BalanceResponseDTO[] }
```

#### Get Balance History
```
GET /api/trading/balance/history/:exchange/:asset
Response: { success: true, data: BalanceResponseDTO[] }
```

#### Detect Balance Changes
```
GET /api/trading/balance/changes/:exchange
Response: { success: true, data: [{ asset, changePercent, ... }] }
```

### Phase 2: P&L Reporting

#### Get P&L Metrics
```
GET /api/trading/pnl/metrics
Response: { success: true, data: PnLMetricsResponseDTO }
```

#### Update Trading Statistics
```
POST /api/trading/stats/update
Response: { success: true, data: { userId: string } }
```

## DTOs

### Request DTOs

**CreateOrderDTO**
```typescript
{
  recommendationId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  exchange: string;
  stopLoss?: number;
  targetPrice?: number;
}
```

**CalculatePositionSizeDTO**
```typescript
{
  accountBalance: number;
  riskPercent: number; // 0.1 - 10%
  entryPrice: number;
  stopLossPrice: number;
}
```

**UpdateStopLossTakeProfitDTO**
```typescript
{
  stopLoss?: number;
  takeProfit?: number;
}
```

**SyncBalancesDTO**
```typescript
{
  exchange: string;
}
```

### Response DTOs

**OrderResponseDTO**
```typescript
{
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  filled: number;
  status: string;
  externalId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**PositionResponseDTO**
```typescript
{
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  quantity: number;
  unrealizedPnL: number;
  realizedPnL: number;
  status: string;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: Date;
  closedAt?: Date;
}
```

**PnLMetricsResponseDTO**
```typescript
{
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalReturn: number;
  totalReturnPercent: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  averageWin: number;
  averageLoss: number;
  winLossRatio: number;
}
```

## Database Schema

### BalanceHistory Model (Phase 2)
```prisma
model BalanceHistory {
  id          String   @id @default(cuid())
  userId      String
  exchange    String
  asset       String
  free        Decimal  @db.Decimal(30, 12)
  locked      Decimal  @db.Decimal(30, 12)
  total       Decimal  @db.Decimal(30, 12)
  timestamp   DateTime @default(now())
  meta        Json?

  user        User     @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([exchange])
  @@index([asset])
  @@index([timestamp])
  @@index([userId, exchange, asset, timestamp])
}
```

### Position Model Updates (Phase 2)
```prisma
model Position {
  // ... existing fields ...
  stopLoss     Decimal?  @db.Decimal(30, 12)
  takeProfit   Decimal?  @db.Decimal(30, 12)
}
```

## Events

The module emits the following events:

- `order.validation.started` - Order validation begins
- `order.submitted.to.exchange` - Order sent to exchange
- `order.filled` - Order execution confirmed
- `trade.recorded` - Trade record created
- `position.updated` - Position metrics updated
- `position.closed` - Position closed with P&L
- `order.failed` - Order execution failed
- `balance.synced` - Balances fetched from exchange
- `balance.changed` - Significant balance change detected

## Error Handling

### Standard Error Response
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "quantity",
      "messages": ["Quantity must be a positive number"]
    }
  ],
  "timestamp": "2025-02-10T12:34:56.789Z",
  "path": "/api/trading/orders/create"
}
```

### Error Codes

- `400` - Validation error or invalid input
- `404` - Resource not found
- `422` - Business logic error (e.g., insufficient balance)
- `429` - Too many requests (rate limiting)
- `500` - Internal server error

## Environment Configuration

```env
BINANCE_USE_TESTNET=true          # Use testnet by default
BINANCE_API_KEY=<your-key>        # From env or database
BINANCE_API_SECRET=<your-secret>  # From database (encrypted)
RATE_LIMIT_THRESHOLD=0.8          # 80% weight threshold
RATE_LIMIT_RETRY_ATTEMPTS=3       # Max retries with backoff
```

## Testing

### Unit Tests
```bash
npm run test -- trading.service.spec.ts
npm run test -- position.service.spec.ts
npm run test -- balance-sync.service.spec.ts
npm run test -- pnl-calculation.service.spec.ts
```

### Integration Tests
```bash
npm run test:e2e -- trading
```

### Load Testing
```bash
# Test concurrent orders
npm run load-test -- --orders 100 --concurrent 10
```

## Security Considerations

1. **API Keys** - Encrypted in database, never logged
2. **Testnet Default** - Uses testnet by default (BINANCE_USE_TESTNET=true)
3. **Rate Limiting** - Built-in exponential backoff and weight management
4. **Input Validation** - All inputs validated with class-validator
5. **Authorization** - All endpoints require Bearer token
6. **Idempotency** - Orders use clientOrderId to prevent duplicates

## Performance Metrics

- Order submission: <100ms (excluding network)
- Balance sync: <500ms (single exchange)
- Position P&L calculation: <50ms (100 positions)
- Database queries: Indexed for <10ms latency

## Migration

### Phase 2 Database Migration
```bash
# Generate migration
npx prisma migrate dev --name add_phase2_features

# Apply migration to production
npx prisma migrate deploy

# Verify schema
npx prisma db push --force-reset
```

## Future Enhancements

1. **Order Streaming** - WebSocket for real-time order updates
2. **Advanced Analytics** - Backtesting and strategy optimization
3. **Multi-Exchange Arbitrage** - Cross-exchange price monitoring
4. **Automated Trading Signals** - AI-powered trade recommendations
5. **Portfolio Rebalancing** - Automated position adjustments

## Support

For issues or questions:
1. Check error messages and status codes
2. Review event logs in database
3. Check balance history for anomalies
4. Contact development team with trade IDs
