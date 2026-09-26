# Paper Trading Specification

Certification date: 2026-09-22. Isolated PostgreSQL migration, prediction/outcome idempotency, historical calibration threshold behavior, scanner scheduling, recovery deduplication, mocked handover, and Prometheus export have been verified. The certification does not authorize live trading and does not claim statistical profitability.

## Safety boundary

Paper trading is the only execution target for this analysis pipeline. `LIVE` remains disabled and no AI output can directly submit an exchange order.

## Lifecycle

```text
real Binance public data
 -> canonical market state
 -> data-quality gate
 -> deterministic structure/regime/opportunity
 -> NO_TRADE gate
 -> strict AI schema validation
 -> calibrated probability, or unavailable
 -> cost-aware EV, or unavailable
 -> deterministic risk and symbol-filter validation
 -> paper fill
 -> stop/target/exit simulation
 -> outcome and calibration record
```

## Required state

Every paper signal should retain `signalId`, `marketSnapshotId`, symbol, market type, direction, setup, timeframe, entry zone, preferred entry, invalidation, stop loss, TP1/TP2/TP3, opportunity score, raw AI confidence, calibrated probability status, expected EV, data-quality state, regime, and risk decision.

Every fill should retain observed bid/ask, fill timestamp, spread, estimated slippage, fees, latency, quantity, and fill source. A missing bid/ask/order book is an unavailable execution input, not zero slippage.

## Gate policy

- `INVALID` data quality, invalid order book, sequence failure, unsafe execution, malformed AI, AI timeout, missing calibrated probability, or non-positive net EV produces `NO_TRADE`.
- `DEGRADED` data may be analyzed only under an explicit restricted policy and must reduce confidence; it must not silently become healthy.
- AI is interpretation/validation only. It cannot provide price, funding, OI, spread, or quantity as authoritative market data.
- Position sizing occurs only after risk, execution quality, and exchange symbol-filter validation.

## Outcome and calibration

Closed paper trades record realized PnL, fees, slippage, funding, holding time, MFE, MAE, exit reason, realized EV, regime, setup, model/provider, and confidence bucket. Calibration remains unavailable until the minimum historical sample policy is met; raw model confidence must not be relabeled as calibrated probability.

The deterministic in-memory lifecycle is implemented by `PaperTradingService`; database persistence and calibration outcome joins remain open integration work.

`PaperOutcomePersistenceService` now persists prediction metadata and closed outcomes through the existing `TradeDecisionSnapshot` and `TradeOutcome` models. Calibration queries only completed predictions that have an outcome relation and returns unavailable until the minimum sample threshold is met.
