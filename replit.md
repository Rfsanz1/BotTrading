# AI Trading Bot

Automated crypto trading bot — Binance Spot + Multi-AI consensus signals (via 9Router) + Telegram.

## How to run

Workflow: **Trading Bot** → `cd trading-bot && python3 main.py`

Bot starts automatically. Safe defaults: `LIVE_MODE=false`, `BINANCE_TESTNET=true`.

## Configuration

### Secrets (Replit Secrets — already set)
| Key | Description |
|-----|-------------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `BINANCE_API_KEY` | Binance API key |
| `BINANCE_API_SECRET` | Binance API secret |
| `TELEGRAM_CHAT_ID` | Your Telegram group chat ID |

### config.json (trading-bot/config.json)
Copy from `config.example.json`. Non-secret settings go here:
- `TELEGRAM_CHAT_ID` — leave blank to use the Replit Secret
- `AI_BASE_URL` — 9Router gateway URL (default: `http://localhost:20128/v1`)
- `AI_API_KEY` — 9Router bearer token (leave empty if unauthenticated)
- Telegram topic IDs, trading pairs, etc.

**Config priority:** config.json → env vars → defaults. Leave a key blank/absent in config.json to use the Secret.

## 9Router (AI Gateway)

The bot sends all AI calls to 9Router at `AI_BASE_URL`.
- **Same Replit container:** run 9Router as a separate workflow on port 20128 — default config works.
- **External/local PC:** expose with a public URL (e.g. ngrok), then update `AI_BASE_URL` in config.json.

## Go live

1. Set `BINANCE_TESTNET=false` in config.json when ready for real trading
2. Set `LIVE_MODE=true` in config.json to enable real order execution
3. Click "Publish" in Replit to deploy

⚠️ Live trading uses real money — always test on testnet first.

## API & Dashboard

- Flask API: port 3000
- Dashboard: `/dashboard` (HTML) or `/trading-dashboard` (React, if artifact deployed)
- Full API docs: see README.md

## User preferences
