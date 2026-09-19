# PAPER deployment runbook

This is the canonical local/development path. PAPER uses `FakePaperExchangeAdapter`; TESTNET and LIVE use separate Binance configuration and remain disabled until separately certified.

## Prerequisites

- Linux host or VM/container runtime with PostgreSQL 15 or 16 and shared-memory support
- Redis 7+
- Node.js 20+
- pnpm
- Enough CPU and RAM for PostgreSQL, Redis, and the API
- Network access for configured AI/exchange services when those integrations are enabled

The current restricted environment cannot start PostgreSQL because `shmget()` is unavailable. This is an environment limitation, not a database fallback condition. Use Docker Compose or another PostgreSQL-capable host.

## Setup

From the repository root:

```bash
pnpm install
cp apps/api/.env.paper.example apps/api/.env.paper
pnpm --dir packages/database prisma:generate
pnpm --dir packages/database migrate:deploy
```

The repository-native services are defined in `docker-compose.yml` and `docker-compose.monorepo.yml`. Docker is optional: on a host without Docker, install and operate PostgreSQL and Redis as native services using the same configured endpoints. When Docker is available, start them with the selected compose file; do not create a second database configuration.

## Preflight and startup

Run the read-only environment doctor:

```bash
pnpm doctor
```

Separate checks are available when diagnosing one dependency:

```bash
pnpm doctor:db
pnpm doctor:redis
```

Start PAPER only after preflight reports reachable PostgreSQL and Redis:

```bash
pnpm --dir apps/api start:paper
```

The command loads `.env.paper`, generates Prisma Client, applies migrations, and starts the API. Missing PostgreSQL keeps readiness false; it never falls back to SQLite, JSON, or an in-memory production store.

## Health

```text
GET http://127.0.0.1:3001/health/live
GET http://127.0.0.1:3001/health/ready
GET http://127.0.0.1:3001/health/readiness
```

`/health/ready` and `/health/readiness` are generated from live lifecycle state. A healthy PAPER process must report `PAPER_READY=true`, `SYSTEM_READY=true`, `TESTNET_READY=false`, and `LIVE_READY=false`.

The readiness smoke command is:

```bash
pnpm paper:smoke
```

It refuses to run when readiness is false. Restart, reconnect, and failure command entry points are also provided (`pnpm paper:restart-test`, `pnpm paper:reconnect-test`, and `pnpm paper:failure-test`); they remain fail-closed until a PostgreSQL-backed PAPER test fixture and running API are available.

## Stop, restart, and troubleshooting

Stop with `Ctrl-C` or `SIGTERM`; the lifecycle closes timers, listeners, event streams, Redis clients, and Prisma connections. Restart with the same `pnpm --dir apps/api start:paper` command; startup synchronization and reconciliation must complete before new entries are allowed.

- **PostgreSQL unreachable:** run `pnpm doctor`; confirm the host/container is running, `DATABASE_URL` points to the correct host/port, credentials are valid, and PostgreSQL has shared-memory support.
- **Redis unavailable:** confirm Redis is listening at `REDIS_URL` and run `pnpm doctor`.
- **Prisma migration failure:** run `pnpm --dir packages/database prisma:generate`, inspect `pnpm --dir packages/database migrate:deploy`, and fix the database or migration state; do not use `db push` as a substitute.
- **WebSocket/event-bus failure:** inspect API logs; readiness must remain false until the paper event stream reconnects and reconciliation succeeds.

No testnet credentials or live credentials belong in this runbook or in committed environment files.
