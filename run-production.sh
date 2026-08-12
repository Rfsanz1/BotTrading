#!/bin/bash

# ═════════════════════════════════════════════════════════════════
# Trading Bot - Quick Start Guide
# ═════════════════════════════════════════════════════════════════

set -e

echo "╔═════════════════════════════════════════════════════════════╗"
echo "║   TRADING BOT - QUICK START                                 ║"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""

# Check if setup has been run
if [ ! -f ".env.production" ]; then
    echo "❌ Setup not complete. Run this first:"
    echo "   bash setup-production.sh"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────
# Step 1: Validate Environment
# ─────────────────────────────────────────────────────────────────
echo "🔍 Validating configuration..."

if grep -q "BINANCE_API_KEY=your_" .env.production; then
    echo "❌ BINANCE_API_KEY not configured"
    echo "   Edit .env.production and add your API credentials"
    exit 1
fi

if grep -q "DATABASE_URL=.*changeme" .env.production; then
    echo "❌ DATABASE_URL not configured"
    echo "   Edit .env.production with your database details"
    exit 1
fi

echo "✅ Configuration valid"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 2: Check Database Connection
# ─────────────────────────────────────────────────────────────────
echo "🗄️  Testing database connection..."

if npm run db:check &>/dev/null; then
    echo "✅ Database connected"
else
    echo "⚠️  Could not connect to database"
    echo "   Make sure PostgreSQL is running and DATABASE_URL is correct"
    echo "   Proceeding anyway..."
fi
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 3: Run Database Migrations
# ─────────────────────────────────────────────────────────────────
echo "🔄 Running database migrations..."
npx prisma migrate deploy --skip-generate
echo "✅ Migrations complete"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 4: Start Application
# ─────────────────────────────────────────────────────────────────
echo "🚀 Starting Trading Bot..."
echo ""
echo "╔═════════════════════════════════════════════════════════════╗"
echo "║   BOT RUNNING                                               ║"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""
echo "📍 API running on: http://localhost:3000"
echo "📖 API docs: http://localhost:3000/api/docs"
echo ""
echo "🔐 Authentication headers required:"
echo "   Authorization: Bearer <your_token>"
echo "   x-user-id: your-user-id"
echo "   x-user-email: your@email.com"
echo ""
echo "⚠️  TESTNET MODE: $(grep BINANCE_USE_TESTNET .env.production)"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start the application
npm start
