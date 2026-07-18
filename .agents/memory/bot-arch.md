---
name: Trading bot architecture
description: Overview of the standalone Python trading bot structure and key design decisions
---

## Structure
- Single file: `trading-bot/main.py` (~3100+ lines, grows with features)
- Workflow: `cd trading-bot && python3 main.py`
- Packages in `.pythonlibs` (Replit managed, on sys.path automatically)

## Key Components
- Flask keep-alive on PORT env var (also serves /dashboard, /api/status, /api/positions, /api/daily)
- Background threads: pairs_refresher_loop, update_poller, position_monitor_loop, news_refresher_loop
- Telegram polling (long poll, not webhook) via update_poller
- Binance testnet (BINANCE_TESTNET=true in secrets) with real API pattern

## Implemented Features (as of session)
- Dual-AI consensus: Groq Llama 3.1 + Claude Sonnet 5 (OpenRouter)
- Multi-timeframe 1m+5m+15m + Funding Rate + Open Interest
- ATR-based dynamic TP/SL (R:R 1:4) via OCO orders
- Trailing Stop Loss (cancel old OCO, place new OCO with higher SL)
- State persistence: bot_state.json (save_state/load_state)
- Correlation filter + MAX_CONCURRENT_POSITIONS limit
- API weight guard (x-mbx-used-weight-1m header)
- Telegram commands: /saldo /posisi /pause /resume /tutup /tutupall
- Web dashboard: /dashboard (HTML), /api/status /api/positions /api/daily
- Early exit reversal detection
- EARLY_EXIT counted in daily P&L (same as CLOSED_TP/SL)

## Timezone
Signal messages use UTC+7 (WIB), not plain UTC.
