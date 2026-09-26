# Binance Market Analysis Pipeline

Certification date: 2026-09-22. The controlled periodic scanner is scheduled independently from WebSocket callbacks, uses the symbol registry and canonical cache, prevents overlapping runs, and exports aggregate metrics through the authenticated Prometheus endpoint. Recovery, bounded 10,000-event soak, repeated short handover rotation, and cross-connection sequence reconciliation are tested. No live order path is enabled.

## Runtime flow

```text
Binance public REST bootstrap/recovery
        |
Binance Spot/Futures WebSocket streams
        |
BinanceMarketDataService
        |
MarketStreamEventRouterService
        |
CanonicalMarketCacheService
   |       |          |
 kline  trade      depth
   |       |          |
 candles TradeFlow LocalOrderBookEngine
        |          |
        +---- canonical market state ----+
                         |
                 DataQualityService
                         |
          MultiTimeframe / Regime / Opportunity
                         |
             deterministic NO_TRADE gate
                         |
                   AI validation
                         |
                 calibrated probability
                         |
                   cost-aware EV
                         |
              structure entry / SL / TP
                         |
                   risk / paper only
```

## Data sources and semantics

- Spot streams use `wss://stream.binance.com:9443/stream`; Futures streams use `wss://fstream.binance.com/stream`.
- Kline events update a forming candle first. Only `k.x === true` candles enter the closed-candle history used by features.
- `aggTrade`/`trade` events update taker flow and CVD. Binance `m === false` is treated as aggressive buy volume.
- `bookTicker` updates bid/ask/mid. `depthUpdate` updates the local order book only after sequence validation.
- Futures `markPriceUpdate` updates mark/index/basis state. `forceOrder` updates liquidation state without creating a directional signal.
- REST remains the source for historical klines, initial depth snapshots, funding/OI bootstrap, and recovery/reconciliation. Missing data is not converted to zero or an empty valid structure.

## Failure and stale policy

- Invalid payloads are rejected and reported as degraded stream state.
- WebSocket close/error triggers bounded reconnect with exponential backoff and subscription restoration.
- Streams are monitored for stale messages and scheduled connection rotation before the Binance lifetime limit.
- A depth sequence gap invalidates the local book. The router does not treat the invalid book as healthy; a REST snapshot must reinitialize it.
- Candle gaps mark the canonical state degraded until historical backfill/reconciliation restores continuity.
- `INVALID` data quality or unsafe order-book state results in `NO_TRADE`; degraded state is restricted and lowers analysis eligibility.
- Stream callbacks only perform bounded state updates. Heavy model/indicator work belongs downstream of `market.canonical.updated`.
- `MarketAnalysisService` consumes `market.canonical.updated` and emits `market.analysis.updated`; AI is not invoked in this callback.

The production analysis entry point is `TradingDecisionPipelineService`. `MarketAnalysisService` emits its deterministic decision on each canonical update; callers that have an AI response and calibration record invoke the same service with those inputs. Only `AUTHORIZED_FOR_PAPER` can be passed to `PaperTradingService`.

## Current limitations

- The canonical state is wired to stream events and Futures hydration. Bounded REST order-book resnapshot, candle backfill, automatic scheduling, and sequence recovery are tested; pending-update replay remains a production optimization.
- `UniverseScannerService` consumes only canonical cached states, rejects non-healthy/stale symbols, and ranks candidates deterministically before any deep analysis or AI call.
- `RecoverySchedulerService` deduplicates recovery jobs per symbol/state and applies bounded exponential backoff.
- Sharding is dormant for configured universes below the shard capacity; `BinanceShardManagerService` partitions symbols without duplicate subscriptions.
- Futures funding/OI historical series have feature primitives but are not yet scheduled into the canonical cache from historical REST responses.
- Calibrated probabilities, audited backtest, and paper execution integration are certified as separate bounded workstreams; strict AI schema validation and deterministic EV/entry/exit primitives are wired.
- Deterministic primitives for strict AI output validation, unavailable-aware EV, and structure-based entry/exit are wired through the paper decision lifecycle.
- The AI brain now rejects empty, malformed, or legacy text responses rather than creating zero-valued recommendations. Such failures must be handled by the caller as `NO_TRADE`.
- Live trading is disabled; no private user-data stream or live order path is enabled by this pipeline.

## Dynamic symbol universe — 2026-09-23

Binance public `GET /api/v3/exchangeInfo` now hydrates the existing symbol registry. Spot registration requires `TRADING`, `USDT`, Spot permission, valid normalized symbol, and parseable filters. Startup hydration precedes scheduled scanning; periodic refresh uses `BINANCE_SYMBOL_REFRESH_MS` with a five-minute default. Refreshes are atomic and preserve the last-known-good registry on failure. The scanner consumes this universe and reports symbols seen/eligible/rejected separately from candidates; it does not receive a hardcoded production list.
