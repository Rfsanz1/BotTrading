#!/usr/bin/env bash
set -euo pipefail

echo "Controlled Redis chaos procedure (no exchange calls)"
echo "1. Start an isolated disposable Redis: docker run --rm --name bottrading-redis-chaos -d redis:7-alpine"
echo "2. Run the API readiness and order-admission tests with REDIS_URL pointed at that container."
echo "3. Stop only the disposable container: docker stop bottrading-redis-chaos."
echo "4. Assert readiness is degraded/HALTED and authenticated order admission is rejected."
echo "5. Restore the container, wait for readiness, and assert no order retry or duplicate execution occurred."
echo "This procedure intentionally does not touch compose Redis, trading data, or Binance."
