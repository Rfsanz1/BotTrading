---
name: Trading bot architecture
description: Overview of the standalone Python trading bot structure and key design decisions
---

## Structure
- Single file: `trading-bot/main.py` (~3800+ lines, grows with features)
- Workflow: `cd trading-bot && python3 main.py`
- Working directory when running: `trading-bot/` — all file paths must be relative to THIS dir

## Background Threads (started in entry point)
1. `run_flask` — Flask server (dashboard + REST API), binds to PORT env var
2. `pairs_refresher_loop` — refresh Binance pair list every hour
3. `update_poller` — Telegram long-poll for commands + callbacks
4. `position_monitor_loop` — 30s cycle: breakeven SL → partial TP → trailing SL → reversal check → daily report
5. `news_refresher_loop` — fetch RSS news every 15 min
6. `health_monitor_loop` — 5 min cycle: no-signal alert + equity drop alert + equity snapshot

## Implemented Features (complete as of this session)
- Dual-AI consensus: Groq Llama 3.1 + Claude Sonnet 5 (OpenRouter)
- Multi-timeframe 1m+5m+15m + Funding Rate + Open Interest
- ATR-based dynamic TP/SL (R:R 1:4) via OCO orders
- **Breakeven SL**: moves SL to entry at +0.5% profit (before trailing activates)
- **Partial TP**: closes 50% at 50% of TP distance, lets rest run
- **Trailing Stop Loss**: activates at +1%, trails 0.6% below highest
- **State persistence**: bot_state.json (save/load, atomic write)
- **SQLite dual-write**: trades.db (trades + equity_snapshots)
- **Correlation filter**: max 4 positions, max 2 per asset group
- **API weight guard**: x-mbx-used-weight-1m header monitoring
- **Kelly Criterion sizing**: scales qty 0.5x–1.5x based on recent win rate
- **Hard Stop Daily Loss**: auto-pause at 3% drop (vs 5% LIVE_MODE kill)
- **Telegram commands**: /saldo /posisi /pause /resume /tutup /tutupall
- **Web dashboard**: /dashboard (Chart.js equity curve + PnL bar chart, Kelly card, position pills)
- **REST API**: /api/status /api/positions /api/daily /api/history
- **Health monitor**: no-signal alert, equity drop alert, equity snapshot
- **Daily report**: auto at 23:55 WIB (16:55 UTC), equity reset at midnight WIB

## Flask Routes
- GET /dashboard — full HTML dashboard with Chart.js
- GET /api/status — bot status JSON
- GET /api/positions — open positions JSON (with breakeven_done, partial_tp_done)
- GET /api/daily — today's P&L JSON
- GET /api/history — 7-day equity + PnL history for charts

## Order of Protection Layers (position lifecycle)
1. Open position → OCO placed (TP + SL)
2. At +0.5% profit → Breakeven SL (SL moved to entry, can't lose)
3. At 50% of TP distance → Partial TP (50% sold, rest continues)
4. At +1% profit → Trailing SL activates (SL trails 0.6% below highest)
5. Reversal detected → Early exit (emergency market sell)
6. TP/SL hit → Position closed, PnL logged

## Timezone
Signal messages use UTC+7 (WIB), not plain UTC.
