# AI Trading Bot

Automated crypto trading bot with multi-AI consensus, real-time Telegram integration, and a full-featured React dashboard.

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
| `GROQ_API_KEY` | Primary AI model (Llama 3.1) |
| `ANTHROPIC_API_KEY` | AI consensus (Claude Sonnet) |
| `OPENAI_API_KEY` | AI consensus (GPT-4) |
| `GEMINI_API_KEY` | AI consensus (Gemini) |

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
