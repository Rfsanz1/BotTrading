# Deployment Guide - Trading Bot Production Readiness

## Quick Start (Production Deployment)

### Prerequisites
- Node.js 18+ and npm/pnpm
- PostgreSQL 14+ database
- Binance API credentials (for live trading)
- Environment secrets configured

### Step 1: Database Migration

```bash
cd /workspaces/BotTrading

# Apply all pending migrations
npx prisma migrate deploy

# Verify the schema
npx prisma db push --force-reset (only in development!)

# Seed initial data if needed
npx prisma db seed
```

### Step 2: Install Dependencies

```bash
# Install all dependencies
pnpm install

# Or with npm
npm install
```

### Step 3: Configure Environment

Create `.env.production`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/bottrading"

# API Configuration
API_PORT=3000
NODE_ENV=production

# Binance Configuration (Testnet by default)
BINANCE_USE_TESTNET=true
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here

# Rate Limiting
RATE_LIMIT_THRESHOLD=0.8
RATE_LIMIT_RETRY_ATTEMPTS=3
RATE_LIMIT_RETRY_DELAY_MS=1000

# JWT/Auth
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRATION=24h

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### Step 4: Build Application

```bash
# Build all packages
npm run build

# Or build specific package
npm run build -- --project=apps/api
```

### Step 5: Start Application

```bash
# Production start
npm start

# Or with specific app
npm start -- --app=api

# Or with Docker
docker-compose -f docker-compose.prod.yml up -d
```

### Step 6: Verify Deployment

```bash
# Check API is running
curl http://localhost:3000/health

# Get API documentation
curl http://localhost:3000/api/docs

# Test a simple endpoint
curl -X GET http://localhost:3000/api/trading/positions/open \
  -H "Authorization: Bearer <your_token>"
```

---

## API Integration Examples

### 1. Create an Order

```bash
curl -X POST http://localhost:3000/api/trading/orders/create \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "recommendationId": "rec-123",
    "symbol": "BTCUSDT",
    "side": "BUY",
    "quantity": 0.5,
    "price": 45000,
    "exchange": "binance",
    "stopLoss": 42000,
    "targetPrice": 48000
  }'
```

Response:
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "id": "ord-abc123"
  },
  "message": "Order created successfully",
  "timestamp": "2025-02-10T12:34:56.789Z"
}
```

### 2. Submit Order to Exchange

```bash
curl -X POST http://localhost:3000/api/trading/orders/ord-abc123/submit \
  -H "Authorization: Bearer <token>"
```

### 3. Get P&L Metrics

```bash
curl -X GET http://localhost:3000/api/trading/pnl/metrics \
  -H "Authorization: Bearer <token>"
```

Response:
```json
{
  "success": true,
  "data": {
    "realizedPnL": 1250.50,
    "unrealizedPnL": -150.25,
    "totalPnL": 1100.25,
    "winRate": 65.5,
    "profitFactor": 2.45,
    "sharpeRatio": 1.89
  }
}
```

### 4. Sync Balances

```bash
curl -X POST http://localhost:3000/api/trading/balance/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance"
  }'
```

### 5. Get Open Positions

```bash
curl -X GET http://localhost:3000/api/trading/positions/open \
  -H "Authorization: Bearer <token>"
```

---

## Database Schema Overview

### BalanceHistory Table
Stores all balance snapshots for audit trail and analytics.

```sql
SELECT * FROM "BalanceHistory"
WHERE "userId" = 'user-123'
AND "exchange" = 'binance'
ORDER BY "timestamp" DESC
LIMIT 100;
```

### Position Table
Tracks all open and closed positions with P&L.

```sql
SELECT * FROM "Position"
WHERE "userId" = 'user-123'
AND "status" = 'OPEN'
ORDER BY "openedAt" DESC;
```

### Trade Table
Stores executed trades for detailed analytics.

```sql
SELECT * FROM "Trade"
WHERE "userId" = 'user-123'
ORDER BY "executedAt" DESC
LIMIT 50;
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Check if API is running
curl http://localhost:3000/health

# Check database connection
curl http://localhost:3000/health/db

# Check exchange connectivity
curl http://localhost:3000/health/exchange
```

### Logs Monitoring

```bash
# View application logs
docker logs -f trading-api

# View specific level logs
docker logs -f --since 1h trading-api | grep "ERROR"

# Stream logs to file
docker logs trading-api > logs/app.log 2>&1 &
```

### Database Maintenance

```bash
# Backup database
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Verify database integrity
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Order\""

# Clean old balance history (keeping last 1000 per asset)
npx prisma db execute --stdin < scripts/cleanup-balance-history.sql

# Analyze query performance
npx prisma studio  # GUI for data exploration
```

### Rate Limiting Monitoring

The system tracks API weight usage on Binance:

```sql
-- Check rate limit hits in last hour
SELECT COUNT(*) as rate_limit_hits
FROM "Order"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
AND "status" = 'FAILED'
AND "failureReason" LIKE '%rate%';
```

---

## Common Issues & Solutions

### Issue 1: "Insufficient Balance"
**Error:** `OrderValidationFailedException: Insufficient balance for order`

**Solution:**
```bash
# Check current balance
curl -X GET http://localhost:3000/api/trading/balance/current/binance \
  -H "Authorization: Bearer <token>"

# Deposit funds or reduce order size
```

### Issue 2: "Invalid Symbol"
**Error:** `SymbolValidationException: Symbol BTCUSD not found`

**Solution:**
```bash
# Check valid symbols on exchange
# Use correct format: BTCUSDT (not BTCUSD)
```

### Issue 3: "Rate Limit Exceeded"
**Error:** `RateLimitExceededException: Binance rate limit exceeded`

**Solution:**
- System automatically retries with exponential backoff
- Reduce request frequency
- Use batch endpoints where available
- Upgrade Binance API tier

### Issue 4: "Database Connection Failed"
**Error:** `Error: connect ECONNREFUSED`

**Solution:**
```bash
# Verify PostgreSQL is running
psql -l

# Check DATABASE_URL environment variable
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Restart database if needed
docker restart postgres
```

### Issue 5: "JWT Token Expired"
**Error:** `UnauthorizedException: JWT token expired`

**Solution:**
- Get a new token from auth endpoint
- Refresh token should be used before expiration
- Check token expiration time in response

---

## Performance Tuning

### Database Query Optimization

```sql
-- Create indexes for frequently accessed queries
CREATE INDEX idx_order_user_status ON "Order"("userId", "status");
CREATE INDEX idx_position_user_status ON "Position"("userId", "status");
CREATE INDEX idx_balance_user_timestamp ON "BalanceHistory"("userId", "timestamp" DESC);

-- Analyze query plans
EXPLAIN ANALYZE SELECT * FROM "Order" WHERE "userId" = 'user-123';
```

### Connection Pooling

```env
# In .env.production
DATABASE_URL="postgresql://user:pass@localhost/db?ssl=true&pool=10&connectionTimeoutMillis=5000"
```

### Caching Strategy

```typescript
// In trading.service.ts (future optimization)
@Cacheable({ ttl: 300 }) // 5 minute cache
async getOpenPositions(userId: string) {
  // Implementation
}
```

---

## Backup & Recovery

### Automated Backup

```bash
#!/bin/bash
# backup.sh - Daily backup script

BACKUP_DIR="/backups/bottrading"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
pg_dump $DATABASE_URL | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Keep last 30 days only
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/db_$DATE.sql.gz"
```

### Restore from Backup

```bash
# Restore database from backup
gunzip < backups/db_20250210.sql.gz | psql $DATABASE_URL

# Verify restoration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Order\""
```

---

## Rollback Procedures

### Database Rollback

```bash
# List all migrations
npx prisma migrate status

# Rollback last migration (development only)
# Note: Production rollbacks require manual SQL scripts

# Create rollback script
npx prisma migrate resolve --rolled-back migration_name

# Then reapply
npx prisma migrate deploy
```

### Application Rollback

```bash
# Revert to previous version
git checkout v1.2.3

# Rebuild and restart
npm run build
npm start
```

---

## Security Considerations

### 1. API Key Management
```env
# NEVER commit secrets to git
# Use environment variables only
# Rotate keys regularly (30-60 days)

# Secure key storage
- AWS Secrets Manager
- HashiCorp Vault
- 1Password Business
```

### 2. Database Security
```bash
# Enable SSL/TLS connections
DATABASE_URL="postgresql://...?ssl=require"

# Use strong passwords
# Run security audit: psql -d $DATABASE_URL -c "SELECT version();"
```

### 3. API Security
```bash
# Enable rate limiting
# Use HTTPS only in production
# Implement CORS properly
# Validate all inputs
# Sanitize all outputs
```

---

## Scaling Considerations

### Horizontal Scaling
1. Use load balancer (Nginx, HAProxy)
2. Multiple API instances
3. Shared PostgreSQL database
4. Redis for caching/sessions

### Vertical Scaling
1. Increase container resources
2. Optimize database indexes
3. Enable query caching
4. Use connection pooling

### Kubernetes Deployment
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: trading-api
spec:
  replicas: 3
  containers:
  - name: trading-api
    image: trading-api:latest
    env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: db-secrets
          key: url
```

---

## Support & Escalation

### Contact Information
- **Development Team:** dev@example.com
- **Operations Team:** ops@example.com
- **Emergency Hotline:** +1-xxx-xxx-xxxx

### Escalation Path
1. Check logs and monitoring
2. Contact development team
3. Review recent changes
4. Prepare for rollback if needed

---

## Final Verification Checklist

Before going to production:

- [ ] Database migration applied successfully
- [ ] All environment variables configured
- [ ] API endpoints responding correctly
- [ ] Authentication working properly
- [ ] Balance sync functional
- [ ] Position tracking operational
- [ ] P&L calculations accurate
- [ ] Error handling working
- [ ] Logging configured
- [ ] Monitoring active
- [ ] Backup process running
- [ ] Team trained on operation
- [ ] Escalation procedures documented
- [ ] Runbook created and tested

---

**Deployment Date:** [Date]
**Deployed By:** [Name]
**Verified By:** [Name]
**Status:** READY FOR PRODUCTION

For issues or questions, contact the development team immediately.
