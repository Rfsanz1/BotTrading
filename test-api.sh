#!/bin/bash

# ═════════════════════════════════════════════════════════════════
# Trading Bot API - Quick Test Commands
# Use these to test your bot after starting it
# ═════════════════════════════════════════════════════════════════

# Configuration
HOST="http://localhost:3000"
TOKEN="your_bearer_token_here"  # Replace with actual token
USER_ID="user-123"              # Replace with actual user ID
USER_EMAIL="user@example.com"   # Replace with actual email

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'  # No Color

# ─────────────────────────────────────────────────────────────────
# Helper Function
# ─────────────────────────────────────────────────────────────────
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}TEST: ${description}${NC}"
    echo -e "Method: ${method} ${endpoint}"
    
    if [ -z "$data" ]; then
        curl -s -X "$method" \
            "$HOST$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "x-user-id: $USER_ID" \
            -H "x-user-email: $USER_EMAIL" \
            -H "Content-Type: application/json" | jq . || echo "Request failed"
    else
        echo "Data: $data"
        curl -s -X "$method" \
            "$HOST$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "x-user-id: $USER_ID" \
            -H "x-user-email: $USER_EMAIL" \
            -H "Content-Type: application/json" \
            -d "$data" | jq . || echo "Request failed"
    fi
    echo ""
}

# ─────────────────────────────────────────────────────────────────
# PHASE 1: Order Management Tests
# ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PHASE 1: ORDER MANAGEMENT${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Test 1: Create Order
test_endpoint "POST" "/api/trading/orders/create" \
    '{
        "recommendationId": "rec-123",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "quantity": 0.001,
        "price": 45000,
        "exchange": "binance",
        "stopLoss": 42000,
        "targetPrice": 48000
    }' \
    "Create Order"

# Test 2: Get Order Details (replace order-id with actual ID from previous response)
test_endpoint "GET" "/api/trading/orders/order-id-here" \
    "" \
    "Get Order Details"

# Test 3: Calculate Position Size
test_endpoint "POST" "/api/trading/position-size/calculate" \
    '{
        "accountBalance": 10000,
        "riskPercent": 2,
        "entryPrice": 45000,
        "stopLossPrice": 42000
    }' \
    "Calculate Position Size"

# Test 4: Sync Orders with Exchange
test_endpoint "POST" "/api/trading/orders/sync" \
    '{"exchange": "binance"}' \
    "Sync Orders with Exchange"

# ─────────────────────────────────────────────────────────────────
# PHASE 2: Position Management Tests
# ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PHASE 2: POSITION MANAGEMENT${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Test 5: Get Open Positions
test_endpoint "GET" "/api/trading/positions/open" \
    "" \
    "Get Open Positions"

# Test 6: Get Closed Positions
test_endpoint "GET" "/api/trading/positions/closed" \
    "" \
    "Get Closed Positions"

# Test 7: Get Position Metrics (replace position-id with actual ID)
test_endpoint "GET" "/api/trading/positions/position-id-here" \
    "" \
    "Get Position Metrics"

# ─────────────────────────────────────────────────────────────────
# PHASE 2: Balance Synchronization Tests
# ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PHASE 2: BALANCE SYNCHRONIZATION${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Test 8: Sync Balances
test_endpoint "POST" "/api/trading/balance/sync" \
    '{"exchange": "binance"}' \
    "Sync Balances from Exchange"

# Test 9: Get Current Balances
test_endpoint "GET" "/api/trading/balance/current/binance" \
    "" \
    "Get Current Balances"

# Test 10: Get Balance History
test_endpoint "GET" "/api/trading/balance/history/binance/USDT" \
    "" \
    "Get Balance History for USDT"

# Test 11: Detect Balance Changes
test_endpoint "GET" "/api/trading/balance/changes/binance" \
    "" \
    "Detect Balance Changes"

# ─────────────────────────────────────────────────────────────────
# PHASE 2: P&L Reporting Tests
# ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}PHASE 2: P&L REPORTING${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Test 12: Get P&L Metrics
test_endpoint "GET" "/api/trading/pnl/metrics" \
    "" \
    "Get Portfolio P&L Metrics"

# Test 13: Update Trading Statistics
test_endpoint "POST" "/api/trading/stats/update" \
    "" \
    "Update Trading Statistics"

# ─────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ API Tests Complete${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "📝 Notes:"
echo "  1. Replace TOKEN with actual JWT token"
echo "  2. Replace USER_ID with actual user ID"
echo "  3. Replace order-id-here and position-id-here with actual IDs"
echo "  4. Each endpoint requires proper authentication headers"
echo ""
echo "📖 Full API Documentation: apps/api/src/modules/trading/README.md"
echo ""
