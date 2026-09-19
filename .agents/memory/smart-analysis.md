---
name: Smart Analysis Trio
description: Regime detection + confluence score + feedback loop — tiga fungsi analisis pintar yang ditambahkan ke main.py
---

## Tiga fungsi baru di main.py

### 1. `detect_market_regime(df_1m, df_5m, df_15m)`
- Pakai TF tertinggi yang tersedia (15m > 5m > 1m) sebagai acuan
- Output: BULL / BEAR / SIDEWAYS / HIGH_VOL + `conf_adjust` int
- Adjustments: BULL strong = -5, BEAR = +10, SIDEWAYS = +12, HIGH_VOL = +10

### 2. `calc_confluence_score(df_1m, df_5m, df_15m)`
- Weighted vote: 15m=3, 5m=2, 1m=1 (max 6 poin)
- Score 0–1, direction BULLISH/BEARISH/MIXED, `boost` int
- boost: ≥0.85→+8, ≥0.67→+3, ≥0.50→0, <0.50→-15

### 3. `get_pair_feedback(symbol)`
- Query SQLite per-symbol, PAIR_FEEDBACK_LOOKBACK=15 trades, TTL=1jam
- WR≥65%→adj=+5, WR≥45%→adj=0, WR≥30%→adj=-10, WR<30%→adj=-20
- Helper: `db_get_pair_trades(symbol, n)`
- State: `_pair_feedback_cache` + `_pair_feedback_lock`

## Integrasi di main_loop
Dipanggil SETELAH df_5m/df_15m dihitung (setelah futures data):
```python
regime     = detect_market_regime(df_1m, df_5m, df_15m)
confluence = calc_confluence_score(df_1m, df_5m, df_15m)
feedback   = get_pair_feedback(symbol)
```

## Effective threshold formula
```python
effective_threshold = clamp(50, 90,
    CONFIDENCE_THRESHOLD + regime["conf_adjust"] - confluence["boost"] - feedback["adj"]
)
```

## ask_ai() signature
Ditambah 3 optional kwargs: `regime`, `confluence`, `feedback`
Masing-masing jadi blok teks sendiri di prompt (REGIME PASAR, KONFLUENSI TIMEFRAME, FEEDBACK HISTORIS PAIR)

**Why:** Tanpa regime detection, bot bisa BUY di pasar bear dengan threshold sama persis seperti bull market. Tanpa confluence, AI tidak tahu kalau 1m dan 15m berlawanan arah. Tanpa feedback, bot tidak belajar dari pair yang konsisten rugi.
