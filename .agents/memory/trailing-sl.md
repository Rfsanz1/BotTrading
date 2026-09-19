---
name: Trailing Stop Loss implementation
description: How trailing SL is implemented — cancel OCO + replace pattern
---

## Pattern
1. Monitor `highest_price_seen` per position in position_monitor_loop
2. When `profit_pct >= TRAILING_SL_ACTIVATE_PCT` → activate trailing
3. `new_sl = highest_price * (1 - TRAILING_SL_TRAIL_PCT/100)`
4. Only move SL UP, never down
5. Cancel old OCO (`cancel_oco_orders`), wait 300ms, place new OCO with same TP but higher SL
6. Update `open_positions[symbol]` with new order IDs and sl_price
7. Call `save_state()` after update

**Why cancel+replace:** Binance OCO doesn't support modifying orders in place. Must cancel the entire OCO list then place a new one.

**Config (env vars):**
- `TRAILING_SL_ENABLED` (default true)
- `TRAILING_SL_ACTIVATE_PCT` (default 1.0 — activate at +1% profit)
- `TRAILING_SL_TRAIL_PCT` (default 0.6 — trail 0.6% below highest)
