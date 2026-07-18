---
name: State persistence pattern
description: How bot state is saved/loaded across restarts
---

## File
`trading-bot/bot_state.json` (configurable via STATE_FILE env var)

## What's saved
- `open_positions` dict — all active positions with entry, TP, SL, order IDs
- `seen_news_links` set — prevents re-posting same news on restart
- `saved_at` timestamp

## Atomic write
Uses tmp file + `os.replace()` for atomicity — prevents corruption on crash mid-write.

## When saved
`save_state()` is called after every position state change:
- `register_open_position` — new position opened
- `_check_position_close` — position closed via TP/SL
- `emergency_close_position` — position closed early
- `_update_trailing_sl` — SL moved by trailing

## On startup
`load_state()` called at top of `main_loop()` — restores positions and notifies Telegram of recovery.

**Why:** open_positions is in-memory only; crash/restart means all active positions are forgotten and TP/SL monitoring stops.
