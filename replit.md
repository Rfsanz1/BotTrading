# AI Trading Bot

Automated crypto trading bot with dual-AI signals, Binance execution, and Telegram notifications.

## Stack
- **Backend**: Python 3 + Flask (single file: `trading-bot/main.py`)
- **Primary AI**: Groq – Llama 3.1-8b-instant
- **Validator AI**: Claude Sonnet 5 via OpenRouter (optional — bot falls back to Groq if key missing)
- **Exchange**: Binance Spot (testnet or live)
- **Notifications**: Telegram (group topics support)
- **Database**: SQLite (`trading-bot/trades.db`)
- **State**: `trading-bot/bot_state.json` (open positions persisted across restarts)

## Running on Replit

Workflow: **Trading Bot** — `cd trading-bot && python3 main.py`

Flask API runs on port `3000` (or `$PORT` env var). Endpoints:
- `GET /api/status` — bot status
- `GET /api/positions` — open positions
- `GET /api/daily` — daily P&L
- `GET /api/healthz` — health check
- `GET /dashboard` — legacy HTML dashboard

## Required Secrets (Replit Secrets)

| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_CHAT_ID` | Group chat ID |
| `BINANCE_API_KEY` | Binance API key |
| `BINANCE_API_SECRET` | Binance API secret |
| `GROQ_API_KEY` | From console.groq.com |
| `OPENROUTER_API_KEY` | Optional — enables Claude Sonnet 5 validator |

## Config File

`trading-bot/config.json` — bot reads this first, then falls back to env vars.
Currently set to `BINANCE_TESTNET: true` (virtual money). Change to `false` for live trading.

## Railway Deployment

1. Push to GitHub
2. Connect repo to Railway
3. Railway picks up `railway.json` (root) and `trading-bot/nixpacks.toml` automatically
4. Set the same env vars in Railway → Variables tab
5. Deploy

## AI Models Used

| Role | Model | Provider |
|------|-------|----------|
| Primary analyst | `llama-3.1-8b-instant` | Groq |
| Validator (optional) | `anthropic/claude-sonnet-5` | OpenRouter |

## User Preferences
- Keep all bot logic in the single `trading-bot/main.py` file (existing architecture)
- Use `config.json` as primary config source, env vars as fallback
