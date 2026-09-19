#!/bin/bash

# ═════════════════════════════════════════════════════════════════
# Trading Bot Production Setup Script
# Run this ONCE before going live
# ═════════════════════════════════════════════════════════════════

set -e  # Exit on any error

echo "╔═════════════════════════════════════════════════════════════╗"
echo "║   TRADING BOT - PRODUCTION SETUP                            ║"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 1: Check Prerequisites
# ─────────────────────────────────────────────────────────────────
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm"
    exit 1
fi

if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL not found. You can install it later."
fi

echo "✅ Prerequisites OK"
echo "  Node: $(node --version)"
echo "  npm: $(npm --version)"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 2: Install Dependencies
# ─────────────────────────────────────────────────────────────────
echo "📦 Installing dependencies..."
npm install --legacy-peer-deps
echo "✅ Dependencies installed"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 3: Generate JWT Secret
# ─────────────────────────────────────────────────────────────────
echo "🔐 Generating JWT secret..."
JWT_SECRET=$(openssl rand -base64 32)
echo "✅ JWT Secret: $JWT_SECRET"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 4: Create Environment File
# ─────────────────────────────────────────────────────────────────
echo "⚙️  Creating .env.production file..."

if [ -f ".env.production" ]; then
    echo "⚠️  .env.production already exists. Backing up to .env.production.bak"
    cp .env.production .env.production.bak
fi

cat > .env.production << EOF
# ═════════════════════════════════════════════════════════════════
# TRADING BOT - PRODUCTION CONFIGURATION
# Generated: $(date)
# ═════════════════════════════════════════════════════════════════

# API Configuration
NODE_ENV=production
API_PORT=3000
API_HOST=0.0.0.0

# Database (UPDATE WITH YOUR CREDENTIALS)
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/bottrading"

# JWT Secret (Auto-generated)
JWT_SECRET=$JWT_SECRET
JWT_ACCESS_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=24h

# Binance Configuration
# IMPORTANT: Choose ONE of these:

# OPTION 1: TESTNET (Safer for testing)
BINANCE_USE_TESTNET=true
BINANCE_BASE_URL=https://testnet.binance.vision
BINANCE_API_KEY=your_testnet_api_key_here
BINANCE_API_SECRET=your_testnet_api_secret_here

# OPTION 2: MAINNET (Real money - uncomment when ready)
# BINANCE_USE_TESTNET=false
# BINANCE_BASE_URL=https://api.binance.com
# BINANCE_API_KEY=your_mainnet_api_key_here
# BINANCE_API_SECRET=your_mainnet_api_secret_here

# Trading Limits (Safety Guards)
TRADING_MAX_ORDER_VALUE_USD=500
TRADING_DAILY_LOSS_LIMIT_USD=1000
TRADING_MAX_POSITION_SIZE_PERCENT=10
TRADING_MIN_ACCOUNT_BALANCE_USD=50
TRADING_MAX_CONCURRENT_POSITIONS=5
TRADING_COOLDOWN_AFTER_LOSS_MINUTES=60
TRADING_MAX_RISK_PERCENT=5

# Rate Limiting
RATE_LIMIT_THRESHOLD=0.8
RATE_LIMIT_RETRY_ATTEMPTS=3
RATE_LIMIT_RETRY_DELAY_MS=1000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Monitoring
HEALTH_CHECK_INTERVAL=300
BALANCE_CHANGE_ALERT_PERCENT=5
LOSS_ALERT_PERCENT=10
EOF

echo "✅ .env.production created"
echo ""
echo "⚠️  IMPORTANT: Update these values in .env.production:"
echo "   1. DATABASE_URL - Your PostgreSQL connection"
echo "   2. BINANCE_API_KEY - Your Binance API key"
echo "   3. BINANCE_API_SECRET - Your Binance API secret"
echo "   4. BINANCE_USE_TESTNET - Set to false only when ready for real money"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 5: Build Application
# ─────────────────────────────────────────────────────────────────
echo "🔨 Building application..."
npm run build
echo "✅ Build complete"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 6: Database Setup Instructions
# ─────────────────────────────────────────────────────────────────
echo "🗄️  Database Setup Instructions:"
echo ""
echo "Run these commands to prepare your database:"
echo ""
echo "  1. Connect to PostgreSQL:"
echo "     psql -U postgres"
echo ""
echo "  2. Create database:"
echo "     CREATE DATABASE bottrading;"
echo ""
echo "  3. Exit psql:"
echo "     \\q"
echo ""
echo "  4. Run migrations:"
echo "     npx prisma migrate deploy"
echo ""
echo "  5. (Optional) View data:"
echo "     npx prisma studio"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 7: Summary
# ─────────────────────────────────────────────────────────────────
echo "╔═════════════════════════════════════════════════════════════╗"
echo "║   ✅ SETUP COMPLETE                                         ║"
echo "╚═════════════════════════════════════════════════════════════╝"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1️⃣  Update .env.production with your credentials:"
echo "   nano .env.production"
echo ""
echo "2️⃣  Setup database:"
echo "   psql -U postgres"
echo "   CREATE DATABASE bottrading;"
echo "   \\q"
echo ""
echo "3️⃣  Run database migration:"
echo "   npx prisma migrate deploy"
echo ""
echo "4️⃣  Start the bot:"
echo "   npm start"
echo ""
echo "5️⃣  Test the API (in another terminal):"
echo "   curl -X GET http://localhost:3000/api/trading/positions/open \\"
echo "     -H 'Authorization: Bearer your_token' \\"
echo "     -H 'x-user-id: user-123' \\"
echo "     -H 'x-user-email: user@example.com'"
echo ""
echo "📚 Documentation:"
echo "   - API: apps/api/src/modules/trading/README.md"
echo "   - Deployment: DEPLOYMENT-GUIDE.md"
echo "   - Production Ready: PRODUCTION-READINESS.md"
echo ""
echo "🔒 Security Reminders:"
echo "   ⚠️  Never commit .env.production to git"
echo "   ⚠️  Keep API credentials secure"
echo "   ⚠️  Start with TESTNET (BINANCE_USE_TESTNET=true)"
echo "   ⚠️  Monitor your first trades carefully"
echo ""
