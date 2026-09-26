# PAPER MODE Runbook

## Safety boundary

PAPER is the default execution mode. The required configuration is
`TRADING_MODE=PAPER` and `LIVE_TRADING_ENABLED=false`. Startup aborts if either
condition is not true. The paper executor uses public Binance market data and
simulated fills; it never calls an authenticated Binance order endpoint.

## Prerequisites

- Node.js and pnpm installed.
- PostgreSQL and Redis reachable using `apps/api/.env.paper`.
- `apps/api/.env.paper` copied from `.env.paper.example` with local, non-secret test values.
- Public network access to Binance Spot and WebSocket endpoints.

## Commands

From the repository root:

```bash
pnpm --dir apps/api run start:paper
pnpm --dir scripts run paper:status
pnpm --dir scripts run paper:dry-run
```

Stop the foreground service with `Ctrl-C`. For the existing Docker deployment:

```bash
docker compose down
```

## Health and metrics

- Liveness: `GET /health/live`
- Readiness: `GET /health/readiness`
- Operational component health: `GET /health/operational`
- Paper counters/performance: `GET /health/paper-metrics`
- Prometheus metrics: authenticated `GET /metrics`

Operational states are `HEALTHY`, `DEGRADED`, and `FAILED`. Safety-critical
configuration and database failures abort startup; transient market/WebSocket
failures keep the process degraded and prevent unsafe entries.

## Paper lifecycle

Public market data -> canonical state -> analysis/opportunity -> `NO_TRADE` or
validated decision -> risk approval -> simulated paper order -> simulated fill
-> stop/target exit -> outcome persistence -> calibration record.

Signals and outcomes are persisted through the existing paper decision/outcome
models. No secrets are included in structured logs.

## Data locations

- Environment: `apps/api/.env.paper` (never commit it).
- Database: `DATABASE_URL` from the paper environment.
- Redis: `REDIS_URL` from the paper environment.
- API logs: stdout/stderr of the foreground process or the existing container logs.

## Troubleshooting

1. Check `pnpm --dir scripts run paper:preflight`.
2. Check `pnpm --dir scripts run paper:status`.
3. Confirm PostgreSQL/Redis reachability and migration state.
4. Confirm outbound access to Binance REST/WebSocket endpoints.
5. If readiness is degraded, inspect the component state and reason returned by
   `/health/operational`; do not bypass the gate.

## Emergency shutdown

Stop the foreground process with `Ctrl-C`, or stop the existing deployment with
`docker compose down`. Do not enable live mode to recover PAPER problems.

**LIVE TRADING IS DISABLED. No real Binance orders are permitted by this
runbook.**
