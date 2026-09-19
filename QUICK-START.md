# 🚀 Trading Bot - Quick Start Guide

> **Your bot is 100% ready for production.** This guide shows you exactly how to run it.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [One-Time Setup](#one-time-setup)
3. [Running the Bot](#running-the-bot)
4. [Testing the API](#testing-the-api)
5. [Switching to Real Money (Mainnet)](#switching-to-real-money-mainnet)
6. [Monitoring & Troubleshooting](#monitoring--troubleshooting)
7. [Safety Features](#safety-features)

---

## Prerequisites

Before starting, you need:

- **Node.js 18+** - [Install here](https://nodejs.org)
- **npm** - Comes with Node.js
- **PostgreSQL 15+** - [Install here](https://www.postgresql.org/download/)
- **Binance Account** - Free account at [binance.com](https://www.binance.com)
- **Binance API Key** - Generate in Binance account settings

**Time needed:** ~5 minutes for setup

---

## One-Time Setup

### Step 1: Run the Setup Script

This script installs dependencies and creates your production configuration:

```bash
bash setup-production.sh
```

**What it does:**
- ✅ Checks Node.js and npm
- ✅ Installs all dependencies
- ✅ Generates JWT secret
- ✅ Creates `.env.production` file with all config options
- ✅ Builds the application

### Step 2: Configure Your Environment

Edit `.env.production` and fill in your credentials:

```bash
nano .env.production
```

**Most important settings:**

```env
# Database (must match your PostgreSQL setup)
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/bottrading"

# Binance API Keys (get from https://www.binance.com/en/account/api-management)
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here

# Start with TESTNET (safe for testing)
BINANCE_USE_TESTNET=true
```

### Step 3: Setup PostgreSQL Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create the database
CREATE DATABASE bottrading;

# Exit
\q

# Run migrations (creates all tables automatically)
npx prisma migrate deploy
```

**Result:** Database is ready with all required tables

---

## Running the Bot

### Start the Bot

```bash
bash run-production.sh
```

**What happens:**
- ✅ Validates configuration
- ✅ Checks database connection
- ✅ Runs migrations
- ✅ Starts API server

**Output should show:**
```
🚀 Starting Trading Bot...
📍 API running on: http://localhost:3000
📖 API docs: http://localhost:3000/api/docs
```

### Keep It Running

The bot runs continuously. Press `Ctrl+C` to stop.

**For production deployment (keep running 24/7):**

Use a process manager like `pm2`:

```bash
npm install -g pm2
pm2 start npm --name "trading-bot" -- start
pm2 startup
pm2 save
```

---

## Testing the API

### Quick Test (in another terminal)

```bash
bash test-api.sh
```

Before running, edit `test-api.sh` and update:
- `TOKEN` - Your JWT bearer token
- `USER_ID` - Your user ID
- `USER_EMAIL` - Your email

### Manual Test: Get Open Positions

```bash
curl -X GET http://localhost:3000/api/trading/positions/open \
  -H "Authorization: Bearer your_token_here" \
  -H "x-user-id: user-123" \
  -H "x-user-email: user@example.com"
```

### Create a Test Order

```bash
curl -X POST http://localhost:3000/api/trading/orders/create \
  -H "Authorization: Bearer your_token_here" \
  -H "x-user-id: user-123" \
  -H "x-user-email: user@example.com" \
  -H "Content-Type: application/json" \
  -d '{
    "recommendationId": "test-rec-1",
    "symbol": "BTCUSDT",
    "side": "BUY",
    "quantity": 0.001,
    "price": 45000,
    "exchange": "binance",
    "stopLoss": 42000,
    "targetPrice": 48000
  }'
```

### View API Documentation

Open in browser: http://localhost:3000/api/docs

Full interactive Swagger documentation with all endpoints.

---

## Switching to Real Money (Mainnet)

### ⚠️ Before You Switch

1. **Test thoroughly on TESTNET first** - At least 10 trades
2. **Start with small amounts** - Test with $100 or less
3. **Monitor closely** - Watch the first 24 hours of trading
4. **Read safety limits** - Understand the limits below

### Steps to Switch

1. Edit `.env.production`:

```bash
nano .env.production
```

2. Change these lines:

```env
# BEFORE (Testnet)
BINANCE_USE_TESTNET=true
BINANCE_BASE_URL=https://testnet.binance.vision

# AFTER (Mainnet - Real Money)
BINANCE_USE_TESTNET=false
BINANCE_BASE_URL=https://api.binance.com
```

3. Restart the bot:

```bash
# Stop current bot: Ctrl+C
bash run-production.sh
```

**That's it!** Your bot now trades with real money.

---

## Monitoring & Troubleshooting

### Check Bot Status

```bash
# Test if API is running
curl http://localhost:3000/health

# Check recent logs
tail -f logs/trading-bot.log
```

### Common Issues

| Issue | Solution |
|-------|----------|
| `Database connection failed` | Check DATABASE_URL in .env.production, ensure PostgreSQL is running |
| `API key rejected` | Verify BINANCE_API_KEY and BINANCE_API_SECRET are correct |
| `Port 3000 already in use` | Change API_PORT in .env.production or kill process: `lsof -ti:3000 \| xargs kill` |
| `Migrations failed` | Run: `npx prisma migrate deploy --skip-generate` |
| `Orders not submitting` | Check available balance, ensure TESTNET mode is set correctly |

### View Database

```bash
# Interactive database explorer
npx prisma studio

# Or query directly
psql -d bottrading
\dt  -- List all tables
SELECT * FROM orders LIMIT 5;
```

---

## Safety Features

Your bot has **5 built-in safety checks** that prevent risky trades:

### 1. Minimum Account Balance Check
- **Default:** $50
- **Purpose:** Prevents trading with insufficient funds
- **Config:** `TRADING_MIN_ACCOUNT_BALANCE_USD`

### 2. Maximum Order Value Check
- **Default:** $500 per order
- **Purpose:** Prevents oversized positions
- **Config:** `TRADING_MAX_ORDER_VALUE_USD`

### 3. Daily Loss Limit Check
- **Default:** $1,000 per day
- **Purpose:** Stops trading after daily loss threshold
- **Config:** `TRADING_DAILY_LOSS_LIMIT_USD`

### 4. Maximum Position Size Check
- **Default:** 10% of account per position
- **Purpose:** Prevents concentration risk
- **Config:** `TRADING_MAX_POSITION_SIZE_PERCENT`

### 5. Maximum Concurrent Positions Check
- **Default:** 5 open positions
- **Purpose:** Limits portfolio complexity
- **Config:** `TRADING_MAX_CONCURRENT_POSITIONS`

### Adjusting Safety Limits

Edit `.env.production` to customize:

```env
TRADING_MAX_ORDER_VALUE_USD=1000        # Increase to $1,000 max per order
TRADING_DAILY_LOSS_LIMIT_USD=500        # Stop trading if down $500
TRADING_MAX_POSITION_SIZE_PERCENT=5     # Only 5% per position
TRADING_MIN_ACCOUNT_BALANCE_USD=100     # Require $100 minimum
TRADING_MAX_CONCURRENT_POSITIONS=3      # Max 3 open trades
```

Then restart the bot.

---

## File Structure

```
.
├── .env.production          ← Your configuration file
├── setup-production.sh      ← Run once to setup
├── run-production.sh        ← Run to start bot
├── test-api.sh             ← Run to test API
├── apps/api/                ← NestJS API server
│   └── src/modules/trading/ ← Core trading logic
├── packages/                ← Shared libraries
│   ├── exchange/            ← Binance adapter
│   ├── database/            ← PostgreSQL models
│   └── ai/                  ← AI trading logic
└── docker-compose.yml       ← Optional Docker setup
```

---

## What's Running?

### The Trading API Server
- **Port:** 3000
- **Authentication:** Bearer tokens (JWT)
- **Endpoints:** 17 total (7 order management + 10 position/balance management)
- **Auto-docs:** Swagger at http://localhost:3000/api/docs

### Background Services
- **Order Submission:** Validates and sends orders to Binance
- **Balance Sync:** Syncs account balances every 5 minutes
- **P&L Calculation:** Calculates profit/loss metrics
- **Position Tracking:** Monitors open and closed positions

### Event System
The bot uses event streaming for real-time updates:
- Order validation → Order submitted → Order filled → Trade recorded
- Balance synced → Balance changed detected
- Position opened → Position updated → Position closed

---

## Next Steps

### 1. **Understand the API** (5 min)
Read: [apps/api/src/modules/trading/README.md](../apps/api/src/modules/trading/README.md)

### 2. **Read Safety Guide** (5 min)
Read: [PRODUCTION-READINESS.md](../PRODUCTION-READINESS.md)

### 3. **Test on TESTNET** (30 min)
- Create 5-10 test orders
- Monitor positions and balances
- Check P&L calculations

### 4. **Small Real Money Test** (1-2 days)
- Switch to MAINNET
- Trade with $100-500
- Monitor carefully

### 5. **Scale Up** (Week 1)
- Increase position sizes
- Add more trading pairs
- Optimize risk limits

---

## Support & Documentation

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT-GUIDE.md](../DEPLOYMENT-GUIDE.md) | Detailed production deployment |
| [PRODUCTION-READINESS.md](../PRODUCTION-READINESS.md) | 100-point readiness checklist |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System architecture overview |
| [apps/api/README.md](../apps/api/README.md) | API documentation |

---

## Summary

Your bot is **production-ready** with:

✅ **5-tier safety system** - Prevents risky trades
✅ **Real Binance integration** - Uses official REST API
✅ **JWT authentication** - Secure API access
✅ **Event-driven** - Real-time order tracking
✅ **Full P&L tracking** - Know exactly how you're doing
✅ **Testnet mode** - Safe testing before real money
✅ **24/7 capable** - Runs continuously

**Ready to trade?**

```bash
bash run-production.sh
```

That's it! 🎉
