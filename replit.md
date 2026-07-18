# AI Trading Bot

Bot trading otomatis: Binance/MEXC (spot) + Groq AI (Llama 3.1) + Telegram.

## Cara Jalankan

```
cd trading-bot && python3 main.py
```

Workflow sudah dikonfigurasi sebagai **Trading Bot**.

## Isi API Keys

Buka halaman **`/config`** di preview bot (port 3000) untuk mengisi semua API key tanpa perlu edit file manual. Setelah simpan, restart bot agar aktif.

### Key yang dibutuhkan
| Key | Dapat dari |
|-----|-----------|
| `GROQ_API_KEY` | console.groq.com → API Keys (gratis) |
| `BINANCE_API_KEY` + `SECRET` | binance.com → API Management |
| `MEXC_API_KEY` + `SECRET` | mexc.com → API Management (jika pakai MEXC) |
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | api.telegram.org/bot\<TOKEN\>/getUpdates |

Config disimpan ke `trading-bot/config.json` (prioritas di atas env vars).

## Exchange

Set `ACTIVE_EXCHANGE` ke `binance` (default) atau `mexc` di halaman `/config`.

## Dashboard

- `/config` — isi API key
- `/dashboard` — status bot, posisi terbuka, equity curve, PnL
- `/api/status` — JSON status

## User Preferences
