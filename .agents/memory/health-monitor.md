---
name: Health monitor startup race condition
description: daily_start_equity must default to 0.0 to prevent false health alerts at startup
---

## Rule
`daily_start_equity` must be initialized to `0.0` (not `10_000.0`).

**Why:** health_monitor_loop starts as a daemon thread BEFORE main_loop() sets the real equity.
If default is 10000 and real equity is 2615, health monitor computes `(10000-2615)/10000 = 73.8%` drop
and fires a false "equity turun 73%" alert on every restart.

With default = 0.0:
- `check_daily_loss()` has guard `if daily_start_equity <= 0: return True` → skips
- `health_monitor_loop` has guard `if daily_start_equity > 0:` → skips
- All other comparisons use `if daily_start_equity else 0` pattern → safe

main_loop() always sets the real value via `daily_start_equity = get_binance_equity()` before the
health monitor's first 5-minute tick, so the race window is closed in practice.

## Health monitor features
- Runs every 5 minutes (time.sleep(300))
- Alert if no AI signal > HEALTH_NO_SIGNAL_HOURS (default 2h), max 1 alert/hour
- Alert if equity drop > HEALTH_EQUITY_DROP_PCT (default 5%), max 1 alert/hour
- Saves equity snapshot to SQLite every hour for equity curve chart
