# Trading Intelligence Architecture

Certification date: 2026-09-22. All registered strategy templates have deterministic cost-aware backtest, conservative intrabar, future-data parity, and sequential walk-forward assertions, while paper persistence/calibration and scanner scheduling have isolated integration evidence. Statistical profitability is intentionally not asserted.

```text
MARKET DATA
  -> canonical state
  -> bounded features
  -> confirmed market structure
  -> multi-timeframe regime
  -> explainable opportunity score
  -> deterministic NO_TRADE gate
  -> strict AI validation
  -> calibrated probability (unavailable until sufficient outcomes)
  -> net EV after fee/spread/slippage/funding
  -> structure-based entry, stop, and targets
  -> deterministic risk gate
  -> PAPER execution only
  -> outcome/performance attribution
  -> calibration and feedback dataset
```

The current repository implements a single final decision path in `TradingDecisionPipelineService`: canonical market state, data quality, Futures context, multi-timeframe alignment, structure, regime, opportunity, hard NO_TRADE gates, strict AI validation, calibrated probability availability, EV, structure-based entry/SL/TP, risk authorization, and paper order/fill lifecycle. Persistence, cached scanning, recovery scheduling, shard management, Prometheus observability, repeated accelerated stream soak, sequence reconciliation, and cost-aware backtest audit are implemented as bounded components. Legacy TESTNET execution proof remains environment-blocked separately. Live trading is disabled.
