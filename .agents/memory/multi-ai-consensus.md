---
name: Multi-AI Consensus
description: Arsitektur 4-model majority voting untuk trading signals; pattern global bot_paused wajib di handle_incoming_message
---

# Multi-AI Consensus

## The rule
`run_multi_ai_consensus()` menjalankan 4 validator (Claude/OpenRouter, Claude/Direct, OpenAI/GPT-4o, Google/Gemini) secara paralel via threading. Groq adalah model primary (sudah jalan sebelumnya). Majority vote: keputusan BUY/SELL hanya dieksekusi jika >50% dari seluruh model yang respond setuju.

**Why:** Satu model bisa salah; majority vote dari 4 model independen meningkatkan akurasi sinyal secara signifikan.

**How to apply:**
- Hasil consensus: `{"decision", "confidence", "votes", "models", "total_responding", "passed"}`
- Variabel penting setelah consensus: `final_decision`, `avg_confidence`, `votes`, `models_result`, `n_total`, `model_lines`
- Di process_signal, selalu gunakan `final_decision` (bukan `decision`) setelah consensus block
- Jika validator error/key kosong, return None — consensus tetap jalan dengan model yang tersedia

## Global bot_paused pattern
`handle_incoming_message` WAJIB punya `global bot_paused` di baris pertama fungsi. Tanpa ini, assignment `bot_paused = True/False` di dalam /pause, /resume, /start akan membuat Python treat variable sebagai local di seluruh fungsi → UnboundLocalError saat `/start` baca `was_paused = bot_paused`.

## Keys disimpan di
- `trading-bot/config.json`: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
- Juga bisa via Replit Secrets (env var priority lebih tinggi dari config.json)

## Chat AI upgrade
`ask_ai_chat()` sekarang: OpenAI GPT-4o (primary) → Claude Direct (fallback) → Groq Llama (last resort)
`_reply_chat()` deteksi keyword chart ("chart","grafik","candle") dan kirim PNG via `send_telegram_photo()`
