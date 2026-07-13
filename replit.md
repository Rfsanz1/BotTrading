# AI Crypto Trading Bot

An automated trading bot that watches every USDT trading pair on Binance, uses Groq AI (Llama 3.1) to analyze the ones showing interesting technical signals, and asks for approval via Telegram (inline ✅/❌ buttons) before placing real Binance orders.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server (port 5000, currently unused by the bot)
- `pnpm run typecheck` — full typecheck across all pnpm packages (not applicable to the Python bot)
- The `Trading Bot` workflow runs `cd trading-bot && python3 main.py` automatically
- Required secrets: `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `ALLOWED_CHAT_IDS` (optional), topic ID env vars (optional, see below)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9 (shared API server + mockup sandbox, not used by the bot yet)
- **Trading bot**: standalone Python 3.12 service in `trading-bot/` — Flask keep-alive server, Groq SDK, python-binance, pandas for indicators
- DB: PostgreSQL + Drizzle ORM (provisioned, not used by the bot)

## Where things live

- `trading-bot/main.py` — the entire bot: pair discovery, indicator pre-filter, Groq analysis, Telegram confirmation flow, Binance execution, trade logging (`trading-bot/trades.log`)
- `trading-bot/test_telegram.py` — standalone script to sanity-check the Telegram bot token/chat ID
- `artifacts/api-server`, `artifacts/mockup-sandbox` — scaffolded but unused by the bot; kept for future web/dashboard work

## Architecture decisions

- The bot scans **all** Binance USDT spot pairs (~440+) every cycle instead of a single hardcoded symbol, per user request. Sending every pair to Groq every minute would blow through API rate limits, so a cheap technical pre-filter (RSI extremes or MACD zero-crossings) shortlists candidates first, and only those go to the AI (capped via `MAX_AI_CALLS_PER_CYCLE`, default 8).
- Live trades still require a human tap on the Telegram ✅ button — the AI/pre-filter only decides what to *propose*, never executes unattended.
- Each flagged pair's confirmation runs in its own background thread so one pair waiting on a Telegram reply doesn't block scanning the rest; concurrent confirmations are capped (`MAX_CONCURRENT_CONFIRMATIONS`, default 5) and a per-symbol cooldown (`SYMBOL_COOLDOWN_SEC`, default 600s) avoids re-flagging the same pair every cycle.
- `TRADING_PAIRS` env var can override the "scan everything" default with an explicit comma-separated list (e.g. `BTCUSDT,ETHUSDT`).

## Product

- Runs unattended, continuously scanning the crypto market.
- Sends a Telegram message with an AI-written rationale and a confidence score whenever a pair looks worth trading.
- User approves or rejects each trade from Telegram before any real money moves.
- Separate Telegram topics can be wired up for buy signals, sell signals, bullish/bearish trend commentary, and free-form AI chat (`/topicid` command reveals the ID to configure).

## User preferences

- User wants the bot live-trading from day one (not simulation-first) and wants it analyzing every available pair, not just BTC/USDT.

## Gotchas

- `LIVE_MODE = True` in `trading-bot/main.py` means real Binance orders can be placed once a signal is confirmed in Telegram — treat any code change there as high-stakes.
- Groq's free tier rate limits are tight relative to scanning 400+ pairs; expect periodic 429s that the Groq SDK retries automatically. Lower `MAX_AI_CALLS_PER_CYCLE` if this becomes disruptive.
- Restart the `Trading Bot` workflow after any edit to `trading-bot/main.py`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details (applies to the untouched Node side of the project only)
