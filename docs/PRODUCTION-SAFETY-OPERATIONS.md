# Production safety operations

## Backup and restore

Run `scripts/postgres-backup-restore-drill.sh /absolute/path/to/empty/drill-dir`.
It creates a custom-format `pg_dump`, writes a SHA-256 checksum, restores it
into a disposable PostgreSQL container, and checks the schema plus critical
order, position, and audit-log tables. It never restores into the Compose
database or mounts a production volume. Keep the output directory protected.

## Redis failure drill

Run `scripts/redis-chaos-test.sh` and follow its isolated-container procedure.
The expected result is degraded/HALTED readiness and rejected new order
admission, with no retry loop. Do not stop the Compose Redis container during
normal trading.

## Monitoring and alerting

The API exposes structured logs and a protected `/metrics` endpoint. Configure
alerts in the external Prometheus/Alertmanager deployment for:

`readiness_not_ready`, `readiness_halted`, `exchange_disconnected`,
`reconciliation_mismatch`, `order_unknown`, repeated execution or risk-gate
failures, `redis_unavailable`, `postgres_unavailable`, `websocket_unavailable`,
credential/authentication failures, and any `LIVE_APPROVAL_ARMED` or unexpected
LIVE enablement attempt. Repository logs/metrics are evidence sources; alert
routing is an infrastructure responsibility and must be tested separately.

## Clock synchronization

On every Docker host verify `timedatectl status` (or `chronyc tracking`) and
that the system clock is synchronized. Binance signed requests require a
small clock skew; use the adapter's `recvWindow` and reject operation when
time synchronization is unavailable or signed requests report timestamp
errors. Record the host command output as deployment evidence; this repository
cannot prove host NTP state.

## Binance permissions and isolation

The canonical account resolver requires exactly one active mode-specific
credential with `TRADE` permission and rejects withdrawal/transfer permissions.
It binds the credential owner and account prefix to `TRADING_MODE`; endpoint
selection is explicit and cannot be overridden by `BINANCE_USE_TESTNET`.
Never log key material. Verify permissions in the Binance console without
copying credentials into logs, and use separate API keys for TESTNET and LIVE.

## LIVE approval

LIVE execution additionally requires a fresh authenticated administrator
approval bound to operator, account, runtime, mode, expiry, and risk-config
version. Approval is process-local, expires, and is revoked on restart; arm
and revoke events are audited. TESTNET and PAPER do not consult this state.
