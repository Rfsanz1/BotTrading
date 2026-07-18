# 🤖 AI Trading Bot

Automated crypto trading bot with AI-powered signals (Groq Llama 3.1 + Claude Sonnet 5), real-time Telegram integration, and a full-featured React dashboard.

## Features

### Core Trading
- **Live Trading** — Binance Spot (testnet or live)
- **Dual AI Consensus** — Groq Llama 3.1 + Claude Sonnet 5 validation
- **Multi-timeframe Analysis** — 1m / 5m / 15m candles
- **ATR-based Dynamic TP/SL** — R:R 1:4 by default

### Position Management
- Breakeven Stop Loss (moves SL to entry at +0.5% profit)
- Partial Take Profit (close 50% at 50% of TP distance)
- Trailing Stop Loss (activates at +1%, trails 0.6% below high)
- OCO (One-Cancels-Other) orders for TP + SL simultaneously
- Reversal detection with emergency market sell
- Kelly Criterion position sizing (scales 0.5x–1.5x by win rate)

### Risk Management
- Correlation filter (max 4 open positions, max 2 per asset group)
- Capital allocation (configurable % of total balance)
- Daily loss limit with hard stop (auto-pause at 3%)
- Max exposure per trade (2% by default)
- Symbol cooldown (avoid re-analyzing same pair too quickly)
- API weight guard (monitors Binance rate limits)

### Advanced Features (NEW)
- **DCA Automation** — auto-buy on schedule per symbol
- **Vacation Mode** — single toggle to pause all trading
- **Scheduled Trading Hours** — only trade during specified UTC hours
- **Database Backup** — automatic periodic backup of trades.db
- **Email Notifications** — HTML emails via SMTP (Gmail, etc.)
- **Audit Log** — every bot action recorded to SQLite

### Analytics & Reporting
- Sharpe ratio, Sortino ratio, Calmar ratio
- Max drawdown (USDT + %)
- Profit factor & expectancy
- Performance attribution by symbol
- Consecutive win/loss streaks
- 7-day equity curve + PnL bar charts

### Backtesting
- RSI-based strategy simulation on Binance historical candles
- Configurable TP%, SL%, RSI threshold
- Returns: total return, win rate, max drawdown, profit factor, equity curve

### System Monitoring
- Real-time CPU, memory, disk usage via psutil
- Network I/O counters
- Bot uptime tracking
- Detailed health check endpoint

### Telegram Commands
| Command | Description |
|---------|-------------|
| `/saldo` | Current balance |
| `/posisi` | Open positions |
| `/laporan` | Daily P&L report |
| `/pause` | Pause the bot |
| `/resume` | Resume the bot |
| `/tutup SYMBOL` | Close one position |
| `/tutupall` | Close all positions |

## Configuration

All settings can be changed via the `/config` page in the dashboard or by editing `config.json` directly.

### Required Keys

| Key | Description |
|-----|-------------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_CHAT_ID` | Your group chat ID |
| `BINANCE_API_KEY` | Binance API key |
| `BINANCE_API_SECRET` | Binance API secret |
| `GROQ_API_KEY` | From console.groq.com |

### Optional Keys

| Key | Default | Description |
|-----|---------|-------------|
| `BINANCE_TESTNET` | `false` | Use testnet (virtual money) |
| `CAPITAL_ALLOCATION_PCT` | `0.5` | % of balance to trade with |
| `MAX_EXPOSURE_PCT` | `0.02` | Max risk per trade |
| `CONFIDENCE_THRESHOLD` | `80` | Minimum AI confidence to trade |
| `TP_PCT` | `3` | Take profit % |
| `SL_PCT` | `1` | Stop loss % |
| `EMAIL_ENABLED` | `false` | Enable email notifications |
| `EMAIL_FROM` | `` | Sender email |
| `EMAIL_TO` | `` | Recipient email |
| `EMAIL_PASSWORD` | `` | SMTP password |
| `DCA_ENABLED` | `false` | Enable DCA automation |
| `VACATION_MODE` | `false` | Start in vacation mode |
| `DB_BACKUP_ENABLED` | `false` | Enable auto DB backup |

## API Endpoints

### Status & Monitoring
```
GET  /api/status          Bot status + uptime
GET  /api/positions       Open positions
GET  /api/daily           Today's P&L
GET  /api/history         7-day equity + PnL
GET  /api/healthz         Simple health check
GET  /api/healthz/detail  Full health + system resources
GET  /api/system          CPU / memory / disk
```

### Analytics
```
GET  /api/analytics?days=30    Advanced analytics (Sharpe, drawdown, etc.)
GET  /api/trades?days=30       Trade history with filters
GET  /api/audit                Audit log
```

### Backtesting
```
GET  /api/backtest?symbol=BTCUSDT&days=14&tp_pct=3&sl_pct=1&rsi_threshold=35
POST /api/backtest/run         Same but with JSON body
```

### Bot Control
```
POST /api/bot/pause            Pause trading
POST /api/bot/resume           Resume trading
POST /api/bot/close-all        Emergency close all positions
```

### DCA Management
```
GET  /api/dca                  List DCA positions
POST /api/dca/add              Add DCA symbol { symbol, amount_usdt, interval_hours }
POST /api/dca/remove           Remove DCA symbol { symbol }
POST /api/dca/trigger          Manual DCA buy now { symbol, amount_usdt }
```

### Schedule / Vacation
```
GET  /api/schedule             Trading hours config
POST /api/schedule/save        Save schedule config
GET  /api/vacation             Vacation mode status
POST /api/vacation/toggle      Toggle vacation mode { enabled: true/false }
```

### Backup
```
POST /api/backup               Create DB backup now
GET  /api/backup/list          List all backups
```

### Config & Notifications
```
GET  /api/config/get           Current config (keys masked)
POST /api/config/save          Update config
POST /api/email/test           Test email notification
```

## Dashboard

Open `http://localhost:3000/dashboard` for the legacy HTML dashboard, or visit the React dashboard at `/trading-dashboard` for the full-featured UI with:

- Real-time position tracking
- Advanced analytics charts
- Backtest runner
- DCA manager
- System monitoring
- Settings panel

## Running Tests

```bash
cd trading-bot
python3 -m pytest tests/ -v
```

## Architecture

```
trading-bot/
├── main.py              # All bot logic (Flask + trading loops)
├── config.json          # API keys and settings
├── trades.db            # SQLite: trades + equity snapshots + audit log
├── trades.log           # JSONL trade log (backward compat)
├── bot_state.json       # Open positions (persisted across restarts)
├── backups/             # Database backups (if DB_BACKUP_ENABLED)
└── tests/
    └── test_bot.py      # Unit tests

artifacts/trading-dashboard/
└── src/                 # React dashboard UI
```

## Deployment

1. Fill in all required API keys via `/config`
2. Set `BINANCE_TESTNET=false` when ready for live trading
3. Set `VACATION_MODE=false` to allow trading
4. Click "Publish" in Replit to deploy

> ⚠️ **Warning**: Live trading uses real money. Always test with testnet first.
