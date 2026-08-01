# AI Trading Bot

Automated crypto trading bot with multi-AI consensus (via 9Router gateway), real-time Telegram integration, and support for multiple exchanges (Binance, MEXC, Bybit).

## How to run

The main bot runs via the **Trading Bot** workflow (`cd trading-bot && python3 main.py`).

On first start, if API keys are missing, the bot serves a config page at `http://localhost:3000/config`.
Fill in the required keys there, then restart the workflow.

### Required config keys (set in `trading-bot/config.json` or via `/config` dashboard)

| Key | Description |
|-----|-------------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram group/chat ID |
| `BINANCE_API_KEY` + `BINANCE_API_SECRET` | Only if `ACTIVE_EXCHANGE=binance` |
| `MEXC_API_KEY` + `MEXC_API_SECRET` | Only if `ACTIVE_EXCHANGE=mexc` |
| `BYBIT_API_KEY` + `BYBIT_API_SECRET` | Only if `ACTIVE_EXCHANGE=bybit` |
| `AI_BASE_URL` | 9Router URL, e.g. `http://localhost:20128/v1` |

### Webhook endpoints (TradingView / MetaTrader 5)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tradingview/webhook` | POST | TradingView Pine Script alert → bot trade |
| `/api/mt5/webhook` | POST | MT5 Expert Advisor signal → bot trade |

TradingView alert JSON: `{ "symbol": "BTCUSDT", "action": "BUY", "price": {{close}}, "confidence": 80, "reason": "..." }`

MT5 EA JSON: `{ "symbol": "BTCUSD", "action": "BUY", "price": 65000, "confidence": 75 }` — simbol otomatis dikonversi ke USDT pair.

## Architecture

```
trading-bot/
├── main.py              # Python/Flask backend — all bot logic + REST API (port 3000)
├── config.json          # API keys and settings (config.json takes priority over env vars)
├── trades.db            # SQLite: trades, equity snapshots, audit log
├── trades.log           # JSONL trade log (backward compat)
└── bot_state.json       # Open positions (persisted across restarts)

artifacts/trading-dashboard/   # React/Vite frontend (proxies /bot/* → localhost:3000)
artifacts/api-server/          # Node.js/Express backend (auth, notifications, AI routes)
lib/db/                        # Drizzle ORM + Replit PostgreSQL schema

packages/
├── database/   @rfsanz/database  — Prisma client singleton + all model/enum re-exports
├── shared/     @rfsanz/shared    — Enums, DTOs, interfaces, pagination & response utils
├── config/     @rfsanz/config    — Typed env config (getConfig()), validated at startup
├── logger/     @rfsanz/logger    — Pino logger + createLogger(context) child factory
└── auth/       @rfsanz/auth      — JWT sign/verify, bcrypt helpers, role/permission guards
```

### Package usage

```ts
// Typed config
import { getConfig } from '@rfsanz/config';
const { jwtSecret, databaseUrl } = getConfig();

// Logger
import { createLogger } from '@rfsanz/logger';
const log = createLogger('AuthService');

// Auth
import { signTokens, hashPassword, hasPermission } from '@rfsanz/auth';

// Shared DTOs / enums / utils
import { RoleName, Side, paginate, ok } from '@rfsanz/shared';

// Database (Prisma + all types)
import { prisma, type User, RoleName } from '@rfsanz/database';
```

## How to run

All services start automatically via workflows:
- **Trading Bot**: `cd trading-bot && python3 main.py`
- **Trading Dashboard**: `pnpm --filter @workspace/trading-dashboard run dev`
- **API Server**: `pnpm --filter @workspace/api-server run dev`

## Configuring API keys

API keys can be set two ways:
1. **Via the bot config page** at `/config` (saves to `trading-bot/config.json`) — easiest
2. **Via Replit Secrets** — env vars are read as fallback when config.json doesn't have a value

Required keys:
| Key | Purpose |
|-----|---------|
| `BINANCE_API_KEY` | Binance trading (testnet or live) |
| `BINANCE_API_SECRET` | Binance trading (testnet or live) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for commands & alerts |
| `AI_BASE_URL` | 9Router gateway URL (e.g. `http://localhost:20128/v1`) |
| `AI_API_KEY` | 9Router bearer token (leave empty for unauthenticated local) |

> **All AI traffic goes through 9Router.** No Groq/Claude/OpenAI/Gemini keys needed.
> Legacy keys (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, etc.) are kept in config for backward compat but unused.

## AI Model Config (9Router)

| Key | Default | Purpose |
|-----|---------|---------|
| `AI_MODEL` | `google/gemini-2.5-pro` | Primary trading analysis |
| `AI_VALIDATOR_MODEL` | `anthropic/claude-sonnet-5` | Validators 1 & 3 |
| `AI_VALIDATOR_MODEL2` | `openai/gpt-4o` | Validator 2 |
| `AI_VALIDATOR_MODEL3` | `google/gemini-1.5-flash` | Validator 4 |
| `AI_CODING_MODEL` | `anthropic/claude-opus-4-5` | `/api/ai/code` endpoint |

## Smart Trading Features Added

- **Fear & Greed Index** — fetched from alternative.me every hour, passed to all AI analyses
- **VADER Sentiment Scoring** — news headlines scored (-1.0 to +1.0) before AI sees them
- **pandas-ta indicators** — Bollinger Bands, Williams %R, Stochastic, EMA200, VWAP added on top of existing RSI/MACD/ATR
- **AI Coding endpoint** — `POST /api/ai/code` lets bot auto-suggest dependency/code changes via 9Router

## Telegram Group Topics

Current topics in `config.json`:
| Topic | ID | Purpose |
|-------|----|---------|
| BUY | 5 | BUY signals |
| SELL | 6 | SELL signals |
| BULL | 4 | Bull market alerts |
| BEAR | 3 | Bear market alerts |
| HOLD | 294 | HOLD signals |
| REPORT | 8 | Daily P&L report |
| NEWS | 9 | Crypto news |
| CHAT | 7 | Free chat with AI |
| **ALERTS** | _set ID_ | System health & errors |
| **ANALYSIS** | _set ID_ | Detailed AI analysis per pair |
| **CODING** | _set ID_ | AI coding update log |

Rekomendasi topik baru yang bisa ditambah ke grup: **ALERTS** (untuk health monitor & error bot), **ANALYSIS** (detail analisis multi-timeframe per pair), **CODING** (log auto-update dari endpoint /api/ai/code).

## Key settings (config.json)

- `BINANCE_TESTNET: "true"` — safe testnet mode (default)
- `LIVE_MODE: "false"` — no real trades until explicitly enabled
- `VACATION_MODE: "false"` — allow trading (set true to pause all trades)

## Dashboard

The React dashboard at `/trading-dashboard/` connects to the Python Flask bot and shows:
- Real-time overview (P&L, positions, win rate)
- AI signals, trade history, analytics
- Backtest runner, DCA manager, system monitor
- Settings panel (configure everything via UI)

## User preferences

- Keep existing project structure — do not restructure or migrate
