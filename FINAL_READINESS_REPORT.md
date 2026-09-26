# Final Readiness Report

Date: 2026-09-22

## Status

**OVERALL STATUS: PAPER READY; TESTNET ENVIRONMENT BLOCKED**  
**PAPER READINESS: READY**  
**LIVE TRADING: DISABLED**

## Operational PAPER MODE

**PAPER MODE: BLOCKED IN CURRENT ENVIRONMENT** — the service starts in PAPER mode,
aborts unsafe live configuration, exposes operational health and paper metrics,
and the deterministic dry-run passed. The current container cannot reach Binance
public REST/WebSocket endpoints, so operational market-data health is FAILED;
this is an infrastructure/network blocker, not a paper execution or credential
requirement.

- **START:** `pnpm --dir apps/api run start:paper`
- **STOP:** `Ctrl-C` or `docker compose down`
- **STATUS:** `pnpm --dir scripts run paper:status`
- **DRY-RUN:** `pnpm --dir scripts run paper:dry-run`

| Subsystem | Status | Evidence / blocker |
|---|---|---|
| Persistence | COMPLETE | Isolated PostgreSQL migration/schema validation passed; paper prediction/outcome join, idempotent upsert, and calibration persistence passed. Legacy TESTNET execution proof is classified separately. |
| Calibration | COMPLETE | Persistent buckets, empirical win rate, Brier score, calibration error, minimum sample policy, and historical-only sample query passed against isolated PostgreSQL. Insufficient samples return `null`. |
| Scanner | COMPLETE | Periodic Nest scheduler wiring, symbol-registry feed, non-overlap guard, canonical-cache scan, deterministic ranking, and empty-registry failure behavior are tested. |
| Backtest | COMPLETE | Every registered strategy template passed cost-aware deterministic execution with its existing stop/target thresholds applied to next-bar OHLC, conservative ambiguous ordering, future-data parity, and sequential walk-forward infrastructure checks. This certifies code/timing integrity, not profitability. |
| Orderbook recovery | COMPLETE | Bounded REST resnapshot, retry/backoff, deduplication, invalidation, duplicate suppression, handover reconciliation, and recovery tests pass. Pending-update replay is not required for the current paper gate. |
| Candle backfill | COMPLETE | Idempotent REST backfill/merge, duplicate elimination, feature recomputation, and recovery scheduling are implemented and tested. |
| WebSocket | COMPLETE | Accelerated 10,000-event soak, malformed payload handling, three short rotation/reconnect cycles, delayed old-connection suppression, handover, and bounded subscriptions pass. |
| Sharding | COMPLETE | Configurable partitioning, unique ownership, and shard-local status/failure isolation behavior are covered. |
| Handover | COMPLETE | Replacement socket opens before old socket close; duplicate overlap and delayed old events are ignored; accelerated repeated rotation passes. |
| Observability | COMPLETE | Aggregate counters are exported through the existing authenticated Prometheus `/metrics` endpoint; no secrets are exported. |
| Python | COMPLETE | `compileall` passes and isolated pytest passes: 87 passed, 1 credential-dependent test skipped. Full repository requirements remain unavailable because `pandas-ta` is not installable on active Python 3.11. |

## End-to-end

**Positive:** PASSED — canonical state → structure/regime/opportunity → AI validation → calibrated probability policy → EV → entry/SL/TP → risk → paper authorization → fill → exit; isolated persistence/calibration lifecycle also passed.

**Negative:** PASSED for stale data, invalid orderbook, malformed/unavailable AI, unavailable probability/EV, risk rejection, high-slippage gating, scanner scheduling, shard isolation, sequence gap/recovery, and idempotent persistence. The unrelated legacy TESTNET execution proof is separately environment-blocked.

## Tests

- **PASSED:** API build/typecheck.
- **PASSED:** 33 market-intelligence tests plus 3 skipped tests (one existing suite skipped).
- **PASSED:** 37 AI Jest tests.
- **PASSED:** 16 exchange paper/execution safety tests.
- **PASSED:** audited backtest, intrabar policy, walk-forward, and all-template future-data parity assertions.
- **PASSED:** Python compileall.
- **PASSED:** 87 Python tests.
- **FAILED:** None in the paper/certification suites.
- **PASSED:** isolated Prisma generation, seven migrations, paper persistence lifecycle, idempotent outcome replay, and calibration threshold tests.
- **PASSED:** 52 mocked authenticated execution/paper safety tests covering Binance user-data, execution engine/confirmation/recovery, reconciliation, mode guards, and paper mode.
- **TESTNET BLOCKED:** legacy `db-backed-proof.spec.ts` requires a configured TESTNET exchange account and compatible JWT fixture; no credentials were requested or used.
- **ENVIRONMENT BLOCKED:** API lint cannot run because repository-local `eslint` is absent and no global dependency was installed.

## Known limitations

- No live Binance credentials or orders were used.
- Calibration is unavailable until the configured minimum sample is reached; raw confidence is never substituted.
- Recovery scheduler does not replay buffered depth updates.
- Scanner does not invoke AI for the universe; deep analysis/AI orchestration remains caller-owned by design.
- Strategy certification is code/timing-focused; profitability and statistical maturity are intentionally not claimed for small fixtures.
- Python requirements contain `pandas-ta`, which is unavailable for the active Python 3.11 index; the isolated validation environment installed the dependencies required by the test suite instead.

## Environment / non-PAPER blockers

- **TESTNET EXECUTION CERTIFICATION: ENVIRONMENT BLOCKED** — requires a safe authenticated test account fixture; mocked code-path coverage is verified.
- API lint is blocked by the missing `eslint` executable.
- Static audit still finds intentional legacy Python compatibility returns/placeholders outside the canonical TypeScript paper execution path; they were not treated as market-data fallbacks.

## Paper blockers

None identified for the paper-only gate. Long wall-clock 24-hour operation was represented by accelerated repeated rotation; no live credentials or orders were used.

## Security

Paper tests require no API credentials. Live execution remains guarded by `TRADING_MODE=LIVE` plus explicit `LIVE_TRADING_ENABLED=true`; paper mode only permits the paper adapter. No AI output directly submits an exchange order.

## Runtime readiness correction — 2026-09-23

**ROOT CAUSE:** Internal `1H`/`4H`/`1D` values were sent directly as Binance REST intervals, producing 400 responses from `/api/v3/klines`.

**FIX:** A single explicit mapping boundary now translates internal values to Binance intervals (`1H -> 1h`, `4H -> 4h`, `1D -> 1d`, `15M -> 15m`, `5M -> 5m`, `1M -> 1m`) for Spot, Futures, backfill, and kline streams. Invalid values fail before network I/O; Binance errors retain safe response diagnostics. `BTC/USDT` and `ETH/USDT` are normalized to slash-free symbols.

**HEALTH PORT:** Nest bootstrap reads `PORT`; active Docker configuration sets internal/listen port 3001 and publishes `3001:3001`. The container health check and `test-api.sh` now target that port.

**RUNTIME EVIDENCE:** Rebuild/restart completed successfully; `/health/live`, authenticated market-intelligence symbols/timeframes, and the authenticated BTC snapshot route responded successfully. Scheduler logs after restart contained no invalid-interval Binance 400s. The canonical scanner completed without interval failures; zero candidates reflected an empty enabled symbol registry.

**LIVE TRADING:** DISABLED.

## Dynamic universe readiness — 2026-09-23

The prior zero-candidate runtime was caused by an empty in-memory symbol registry, not by opportunity thresholds. Production now hydrates the registry from Binance Spot exchangeInfo at startup and periodically thereafter. The scheduler consumes registry symbols rather than a hardcoded list, while the scanner remains responsible for market-state and opportunity eligibility.

Refresh failure preserves the last-known-good registry and reports `DEGRADED`; no successful initial refresh reports `INVALID` and safely skips scanning. JWT protection remains unchanged, and no live order path was touched.
