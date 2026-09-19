---
name: Equity basis rule
description: daily_start_equity must be USDT-only, not total portfolio value
---

## Rule
`daily_start_equity` is set exclusively from `get_binance_equity()` which returns USDT free+locked only.

**Why:** Portfolio display (all assets) is informational only. Mixing non-USDT assets into the equity basis for risk calculations (daily loss limit, position sizing) creates inconsistency — asset prices fluctuate, so the basis would be unstable. USDT-only keeps risk math clean and predictable.

**How to apply:** Never update `daily_start_equity` from `get_binance_portfolio()` total. The portfolio display in startup message and /saldo command is purely informational.
