---
name: SQLite dual-write pattern
description: log_trade writes to both trades.log and trades.db; path conventions
---

## Pattern
Every call to `log_trade()` writes to two sinks:
1. `trades.log` (JSONL, backward compat) — via `trades_log_lock`
2. `trades.db` (SQLite) — via `db_insert_trade()` with `_db_lock`

## Tables
- `trades` — all trade events (side, qty, price, confidence, reason, result, pnl, pnl_pct)
- `equity_snapshots` — hourly equity readings (for equity curve chart)

## File path rule
**CRITICAL:** Both `DB_FILE` and `STATE_FILE` must NOT include the `trading-bot/` prefix.
The workflow command is `cd trading-bot && python3 main.py`, so working directory IS `trading-bot/`.
Using `"trading-bot/trades.db"` would resolve to `trading-bot/trading-bot/trades.db` — WRONG.
Correct defaults: `DB_FILE = "trades.db"`, `STATE_FILE = "bot_state.json"`, `TRADES_LOG = "trades.log"`.

**Why:** SQLite raises `OperationalError: unable to open database file` when parent dir doesn't exist.
File-based reads/writes silently fail or raise FileNotFoundError (handled gracefully), masking the bug.

## Helper functions
- `db_insert_trade(record)` — inserts one trade record, catches exceptions silently
- `db_save_equity_snapshot(equity)` — called hourly by health_monitor_loop
- `db_get_recent_trades(n)` — used by Kelly sizing (win rate calc) and /api/history
- `db_get_equity_history(days)` — for equity curve chart
- `db_get_daily_pnl_history(days)` — for daily PnL bar chart
