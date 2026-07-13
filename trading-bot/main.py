"""
AI Trading Bot – Binance (semua pair USDT) + Groq (Llama 3.1) + Telegram
=========================================================================
Mode saat ini: LIVE (LIVE_MODE = True)
Data pasar    : Binance public API — memindai SEMUA pair spot USDT
Pre-filter    : indikator teknikal (RSI/MACD) memilih pair yang "menarik"
                sebelum dikirim ke AI, supaya tidak membanjiri rate-limit Groq
AI Analyst    : Groq – Llama 3.1 (conversational, ingat history)
Notifikasi    : Telegram (konfirmasi inline ✅ / ❌, group topics support)
Eksekusi      : Binance Spot market order
"""

import os
import json
import time
import queue
import logging
import threading
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
import requests
from groq import Groq
from flask import Flask

# ---------------------------------------------------------------------------
# ─── KONFIGURASI ────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

LIVE_MODE: bool = True

# Kosongkan / set "ALL" di TRADING_PAIRS env var untuk memindai SEMUA pair
# spot USDT yang ada di Binance. Atau isi daftar spesifik, contoh:
# TRADING_PAIRS=BTCUSDT,ETHUSDT,SOLUSDT
TRADING_PAIRS_ENV: str = os.getenv("TRADING_PAIRS", "ALL").strip()

CANDLE_INTERVAL: str = "1m"
CANDLE_LIMIT: int = 100

CONFIDENCE_THRESHOLD: int = 70
MAX_EXPOSURE_PCT: float = 0.02
DAILY_LOSS_LIMIT_PCT: float = 0.05
LOOP_SLEEP: int = 60
CONFIRM_TIMEOUT: int = 120

# Simbol yang sering "noise" (leveraged tokens) — dikecualikan dari pemindaian
_EXCLUDED_SUFFIXES = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")
_EXCLUDED_BASES = {"USDC", "FDUSD", "TUSD", "DAI", "EUR", "GBP", "TRY", "BUSD"}

# Berapa pair maksimum yang boleh AI analisis (Groq) per siklus — pre-filter
# indikator memilih kandidat paling menarik dulu supaya rate-limit aman.
MAX_AI_CALLS_PER_CYCLE: int = int(os.getenv("MAX_AI_CALLS_PER_CYCLE", "8"))

# Berapa banyak konfirmasi Telegram (BUY/SELL live) yang boleh menunggu balasan
# secara bersamaan — supaya chat tidak dibanjiri puluhan sinyal sekaligus.
MAX_CONCURRENT_CONFIRMATIONS: int = int(os.getenv("MAX_CONCURRENT_CONFIRMATIONS", "5"))

# Setelah sebuah pair memicu sinyal, jangan analisis ulang selama N detik
SYMBOL_COOLDOWN_SEC: int = int(os.getenv("SYMBOL_COOLDOWN_SEC", "600"))

# Delay kecil antar request klines supaya tidak kena rate-limit Binance saat
# memindai ratusan pair dalam satu siklus.
INTER_SYMBOL_DELAY_SEC: float = float(os.getenv("INTER_SYMBOL_DELAY_SEC", "0.12"))

# Take Profit / Stop Loss otomatis (persen dari harga entry) — dipasang lewat
# OCO sell order begitu order BUY tereksekusi, supaya posisi tidak dibiarkan
# tanpa target keluar.
TP_PCT: float = float(os.getenv("TP_PCT", "2"))
SL_PCT: float = float(os.getenv("SL_PCT", "1"))

# Jam (UTC) kapan laporan profit/loss harian otomatis dikirim ke Telegram.
# Default 17 UTC = 00:00 WIB (baru ganti hari di Indonesia).
DAILY_REPORT_HOUR_UTC: int = int(os.getenv("DAILY_REPORT_HOUR_UTC", "17"))

# Groq – berapa exchange terakhir yang diingat (1 exchange = 1 user + 1 assistant)
MAX_HISTORY_EXCHANGES: int = 4   # dikurangi supaya tidak 413 Too Large

# ---------------------------------------------------------------------------
# ─── ENVIRONMENT VARIABLES ──────────────────────────────────────────────────
# ---------------------------------------------------------------------------

GROQ_API_KEY       = os.getenv("GROQ_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

_raw_chat_id = os.getenv("TELEGRAM_CHAT_ID", "0").strip()
try:
    TELEGRAM_CHAT_ID = int(_raw_chat_id)
except ValueError:
    print(
        f"\n❌ ERROR: TELEGRAM_CHAT_ID harus berupa angka, bukan '{_raw_chat_id}'.\n"
        f"   Cara dapat Chat ID: cari @userinfobot di Telegram → klik Start.\n"
    )
    raise SystemExit(1)

ALLOWED_CHAT_IDS = [
    int(x.strip())
    for x in os.getenv("ALLOWED_CHAT_IDS", "").split(",")
    if x.strip()
]

# Topic IDs untuk Telegram group forum
def _parse_topic(env_key: str) -> Optional[int]:
    v = os.getenv(env_key, "").strip()
    return int(v) if v.isdigit() else None

TELEGRAM_BUY_TOPIC_ID:  Optional[int] = _parse_topic("TELEGRAM_BUY_TOPIC_ID")
TELEGRAM_SELL_TOPIC_ID: Optional[int] = _parse_topic("TELEGRAM_SELL_TOPIC_ID")
TELEGRAM_BULL_TOPIC_ID: Optional[int] = _parse_topic("TELEGRAM_BULL_TOPIC_ID")
TELEGRAM_BEAR_TOPIC_ID: Optional[int] = _parse_topic("TELEGRAM_BEAR_TOPIC_ID")
TELEGRAM_CHAT_TOPIC_ID: Optional[int] = _parse_topic("TELEGRAM_CHAT_TOPIC_ID")

BINANCE_API_KEY    = os.getenv("BINANCE_API_KEY", "")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "")

# ---------------------------------------------------------------------------
# ─── LOGGING ────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)
TRADES_LOG = "trades.log"

# ---------------------------------------------------------------------------
# ─── GLOBAL STATE ───────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

daily_start_equity: float = 10_000.0

# Groq conversation history (shared antara analisis trading & chat)
conversation_history: list[dict] = []
history_lock = threading.Lock()

# Queue untuk callback query Telegram (dari background poller)
callback_queue: queue.Queue = queue.Queue()

# Daftar pair aktif yang dipindai (di-refresh berkala dari Binance)
active_pairs: list[str] = []
pairs_lock = threading.Lock()

# Filter LOT_SIZE / MIN_NOTIONAL per simbol (stepSize, minQty, minNotional) —
# wajib dipatuhi Binance, kalau tidak order akan ditolak walau sudah dikonfirmasi.
symbol_filters: dict[str, dict] = {}
filters_lock = threading.Lock()

# Kapan terakhir kali sebuah simbol memicu sinyal (untuk cooldown)
last_signal_at: dict[str, float] = {}
last_signal_lock = threading.Lock()

# Membatasi berapa banyak konfirmasi live yang boleh berjalan bersamaan
confirmation_slots = threading.Semaphore(MAX_CONCURRENT_CONFIRMATIONS)

# Posisi BUY yang sedang menunggu OCO TP/SL close — dipantau berkala oleh
# position_monitor_loop() supaya kita tahu kapan posisi ditutup TP atau SL,
# dan bisa hitung profit/loss harian.
open_positions: dict[str, dict] = {}
positions_lock = threading.Lock()

# Tanggal (UTC, format YYYY-MM-DD) terakhir laporan harian dikirim — supaya
# tidak double-kirim di hari yang sama.
daily_report_sent_date: Optional[str] = None

# ---------------------------------------------------------------------------
# ─── FLASK KEEP-ALIVE ───────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

flask_app = Flask(__name__)

@flask_app.route("/")
def keep_alive():
    return "alive", 200

@flask_app.route("/status")
def status():
    with pairs_lock:
        n_pairs = len(active_pairs)
    return json.dumps({
        "live_mode":       LIVE_MODE,
        "pairs_scanned":   n_pairs,
        "interval":        CANDLE_INTERVAL,
        "history_len":     len(conversation_history),
        "buy_topic":       TELEGRAM_BUY_TOPIC_ID,
        "sell_topic":      TELEGRAM_SELL_TOPIC_ID,
        "bull_topic":      TELEGRAM_BULL_TOPIC_ID,
        "bear_topic":      TELEGRAM_BEAR_TOPIC_ID,
        "chat_topic":      TELEGRAM_CHAT_TOPIC_ID,
    }), 200

def run_flask():
    port = int(os.getenv("PORT", 3000))
    flask_app.run(host="0.0.0.0", port=port, use_reloader=False)

# ---------------------------------------------------------------------------
# ─── 0. DAFTAR PAIR (SEMUA USDT DI BINANCE) ─────────────────────────────────
# ---------------------------------------------------------------------------

def _extract_filters(s: dict) -> dict:
    """Ambil stepSize/minQty (LOT_SIZE), minNotional (MIN_NOTIONAL/NOTIONAL) dan
    tickSize (PRICE_FILTER) dari exchangeInfo — tickSize dipakai buat pasang OCO TP/SL."""
    step_size = 1.0
    min_qty = 0.0
    min_notional = 0.0
    tick_size = 0.00000001
    for f in s.get("filters", []):
        ftype = f.get("filterType")
        if ftype == "LOT_SIZE":
            step_size = float(f.get("stepSize", 1))
            min_qty = float(f.get("minQty", 0))
        elif ftype in ("MIN_NOTIONAL", "NOTIONAL"):
            min_notional = float(f.get("minNotional") or f.get("notional") or 0)
        elif ftype == "PRICE_FILTER":
            tick_size = float(f.get("tickSize", tick_size))
    return {
        "stepSize": step_size,
        "minQty": min_qty,
        "minNotional": min_notional,
        "tickSize": tick_size,
    }


def fetch_usdt_pairs() -> list[str]:
    """Ambil semua pair spot USDT yang sedang TRADING di Binance, plus filter LOT_SIZE/MIN_NOTIONAL."""
    url = "https://api.binance.com/api/v3/exchangeInfo"
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        data = r.json()
        pairs = []
        fresh_filters = {}
        for s in data.get("symbols", []):
            if s.get("status") != "TRADING":
                continue
            if s.get("quoteAsset") != "USDT":
                continue
            if s.get("isSpotTradingAllowed") is False:
                continue
            symbol = s["symbol"]
            base = s.get("baseAsset", "")
            if symbol.endswith(_EXCLUDED_SUFFIXES):
                continue
            if base in _EXCLUDED_BASES:
                continue
            pairs.append(symbol)
            fresh_filters[symbol] = _extract_filters(s)
        with filters_lock:
            symbol_filters.update(fresh_filters)
        return sorted(pairs)
    except Exception as e:
        logger.error(f"Gagal ambil daftar pair Binance: {e}")
        return []


def _round_step(qty: float, step: float) -> float:
    """Bulatkan ke bawah sesuai stepSize Binance (LOT_SIZE), hindari error 'invalid quantity precision'."""
    if step <= 0:
        return qty
    precision = max(0, -int(round(__import__("math").log10(step))))
    steps = int(qty / step)
    return round(steps * step, precision)


def get_symbol_filters(symbol: str) -> dict:
    with filters_lock:
        return symbol_filters.get(symbol, {
            "stepSize": 0.00001, "minQty": 0.00001, "minNotional": 5.0,
            "tickSize": 0.00000001,
        })


def _round_price(price: float, tick: float) -> float:
    """Bulatkan harga ke bawah sesuai tickSize Binance (PRICE_FILTER)."""
    if tick <= 0:
        return price
    precision = max(0, -int(round(__import__("math").log10(tick))))
    steps = int(round(price / tick))
    return round(steps * tick, precision)


def refresh_pairs() -> None:
    """Refresh daftar pair yang dipindai — dipanggil di startup & tiap 1 jam."""
    global active_pairs
    if TRADING_PAIRS_ENV.upper() == "ALL":
        fetched = fetch_usdt_pairs()
        if fetched:
            with pairs_lock:
                active_pairs = fetched
            logger.info(f"📈 Memindai SEMUA pair USDT Binance: {len(fetched)} pair")
        else:
            logger.warning("⚠️ Gagal refresh daftar pair — pakai daftar lama/fallback")
            with pairs_lock:
                if not active_pairs:
                    active_pairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]
    else:
        explicit = [p.strip().upper() for p in TRADING_PAIRS_ENV.split(",") if p.strip()]
        with pairs_lock:
            active_pairs = explicit
        logger.info(f"📈 Memindai pair dari TRADING_PAIRS: {', '.join(explicit)}")


def pairs_refresher_loop() -> None:
    while True:
        time.sleep(3600)
        refresh_pairs()

# ---------------------------------------------------------------------------
# ─── 1. FETCH MARKET DATA ───────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def fetch_market(symbol: str, interval: str = CANDLE_INTERVAL,
                  limit: int = CANDLE_LIMIT) -> Optional[pd.DataFrame]:
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}

    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=10)
            if r.status_code == 429:
                wait = 2 ** attempt
                logger.warning(f"Rate-limited oleh Binance ({symbol}), coba ulang {wait}s …")
                time.sleep(wait)
                continue
            r.raise_for_status()
            raw = r.json()
            if not raw:
                return None
            df = pd.DataFrame(raw, columns=[
                "open_time", "open", "high", "low", "close", "volume",
                "close_time", "quote_vol", "trades", "taker_buy_base",
                "taker_buy_quote", "ignore",
            ])
            numeric_cols = ["open", "high", "low", "close", "volume"]
            df[numeric_cols] = df[numeric_cols].astype(float)
            df["open_time"] = pd.to_datetime(df["open_time"], unit="ms")
            df.set_index("open_time", inplace=True)
            return df[numeric_cols]
        except Exception as e:
            logger.warning(f"Fetch error {symbol} (attempt {attempt+1}): {e}")
            time.sleep(1)

    return None

# ---------------------------------------------------------------------------
# ─── 2. HITUNG INDIKATOR TEKNIKAL ───────────────────────────────────────────
# ---------------------------------------------------------------------------

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    high  = df["high"]
    low   = df["low"]

    df["sma20"] = close.rolling(20).mean()
    df["sma50"] = close.rolling(50).mean()

    delta    = close.diff()
    gain     = delta.clip(lower=0)
    loss     = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, float("nan"))
    df["rsi14"] = 100 - (100 / (1 + rs))

    ema12          = close.ewm(span=12, adjust=False).mean()
    ema26          = close.ewm(span=26, adjust=False).mean()
    df["macd"]        = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]

    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr14"] = tr.rolling(14).mean()

    return df


def is_interesting(df: pd.DataFrame) -> bool:
    """
    Pre-filter murah (tanpa AI) untuk mempersempit ratusan pair jadi
    beberapa kandidat yang layak dikirim ke Groq. Menghindari boros
    rate-limit/API saat memindai semua pair sekaligus.
    """
    last = df.iloc[-1]
    prev = df.iloc[-2]
    rsi = last.get("rsi14")
    hist = last.get("macd_hist")
    prev_hist = prev.get("macd_hist")

    if pd.isna(rsi) or pd.isna(hist) or pd.isna(prev_hist):
        return False

    rsi_extreme = rsi <= 32 or rsi >= 68
    macd_cross = (prev_hist <= 0 < hist) or (prev_hist >= 0 > hist)

    return bool(rsi_extreme or macd_cross)

# ---------------------------------------------------------------------------
# ─── 3. ANALISIS AI (GROQ – conversational, ingat history) ──────────────────
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_TRADING = (
    "Kamu adalah asisten trading yang ramah dan pintar. Kamu memantau banyak pair "
    "kripto sekaligus di Binance dan ingat analisis-analisis sebelumnya dalam "
    "percakapan ini untuk melihat pola pasar dari waktu ke waktu.\n\n"
    "Kalau diminta analisis data market, balas HANYA dengan JSON valid, tanpa teks lain:\n"
    '{ "decision": "BUY"|"SELL"|"HOLD", "reason": "<1-2 kalimat bahasa santai>", "confidence": <0-100> }\n\n'
    "Kalau ditanya pertanyaan umum (bukan analisis data), jawab dengan santai dan natural "
    "pakai bahasa sehari-hari Indonesia. Jangan kaku, ngobrol aja seperti teman."
)

def _trim_history():
    """Pertahankan hanya MAX_HISTORY_EXCHANGES exchange terakhir."""
    global conversation_history
    max_msgs = MAX_HISTORY_EXCHANGES * 2
    if len(conversation_history) > max_msgs:
        conversation_history = conversation_history[-max_msgs:]


def ask_ai(symbol: str, df: pd.DataFrame) -> dict:
    """
    Kirim data + indikator satu pair ke Groq dengan conversation history.
    Return: { "decision": "BUY"|"SELL"|"HOLD", "reason": str, "confidence": int }
    """
    global conversation_history
    client = Groq(api_key=GROQ_API_KEY)

    last = df.tail(5).copy()
    for col in last.select_dtypes(include="float64").columns:
        last[col] = last[col].round(2)

    rows = []
    for ts, row in last.iterrows():
        rows.append(
            f"{ts.strftime('%H:%M')} O={row['open']} H={row['high']} L={row['low']} "
            f"C={row['close']} V={row['volume']:.0f} "
            f"SMA20={row.get('sma20',0):.0f} RSI={row.get('rsi14',0):.1f} "
            f"MACD={row.get('macd',0):.2f} ATR={row.get('atr14',0):.2f}"
        )
    user_msg = (
        f"{symbol} {CANDLE_INTERVAL} "
        f"[{datetime.now(timezone.utc).strftime('%H:%M UTC')}]\n"
        + "\n".join(rows)
    )

    raw = ""
    for attempt in range(3):
        try:
            with history_lock:
                messages = (
                    [{"role": "system", "content": SYSTEM_PROMPT_TRADING}]
                    + conversation_history
                    + [{"role": "user", "content": user_msg}]
                )

            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                max_tokens=250,
                temperature=0.2,
                messages=messages,
            )
            raw = response.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json").strip()

            result = json.loads(raw)
            result["confidence"] = int(result.get("confidence", 0))
            result["decision"]   = result.get("decision", "HOLD").upper()

            with history_lock:
                conversation_history.append({"role": "user",      "content": user_msg})
                conversation_history.append({"role": "assistant", "content": raw})
                _trim_history()

            return result

        except json.JSONDecodeError:
            logger.warning(f"AI response bukan JSON valid ({symbol}, attempt {attempt+1}): {raw}")
        except Exception as e:
            logger.error(f"Groq API error ({symbol}, attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)

    return {"decision": "HOLD", "reason": "Analisis AI gagal", "confidence": 0}


def ask_ai_chat(user_text: str, user_name: str = "User") -> str:
    """Percakapan bebas dengan Groq (bukan analisis trading)."""
    global conversation_history
    client = Groq(api_key=GROQ_API_KEY)

    user_msg = f"[{user_name}]: {user_text}"

    try:
        with history_lock:
            messages = (
                [{"role": "system", "content": SYSTEM_PROMPT_TRADING}]
                + conversation_history
                + [{"role": "user", "content": user_msg}]
            )

        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=600,
            temperature=0.6,
            messages=messages,
        )
        reply = response.choices[0].message.content.strip()

        with history_lock:
            conversation_history.append({"role": "user",     "content": user_msg})
            conversation_history.append({"role": "assistant", "content": reply})
            _trim_history()

        return reply

    except Exception as e:
        logger.error(f"ask_ai_chat error: {e}")
        return f"Maaf, terjadi error saat memproses pertanyaan: {e}"

# ---------------------------------------------------------------------------
# ─── 4. TELEGRAM ────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _tg_post(endpoint: str, payload: dict) -> Optional[dict]:
    """Helper: POST ke Telegram API dengan retry."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/{endpoint}"
    for attempt in range(3):
        try:
            r = requests.post(url, json=payload, timeout=10)
            if not r.ok:
                body = r.json() if r.content else {}
                desc = body.get("description", "")
                logger.error(f"Telegram {endpoint} error (attempt {attempt+1}): {r.status_code} {desc}")
                if "message thread not found" in desc and "message_thread_id" in payload:
                    logger.warning("⚠️ Topic ID salah/belum diset — kirim ke General sebagai fallback")
                    payload_fallback = {k: v for k, v in payload.items() if k != "message_thread_id"}
                    r2 = requests.post(url, json=payload_fallback, timeout=10)
                    if r2.ok:
                        return r2.json()
                time.sleep(2 ** attempt)
                continue
            return r.json()
        except Exception as e:
            logger.error(f"Telegram {endpoint} error (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)
    return None


def _signal_topic(decision: str) -> Optional[int]:
    if decision == "BUY":
        return TELEGRAM_BUY_TOPIC_ID
    if decision == "SELL":
        return TELEGRAM_SELL_TOPIC_ID
    return None


def send_telegram_message(text: str,
                           topic_id: Optional[int] = None,
                           chat_id: Optional[int] = None) -> Optional[dict]:
    payload: dict = {
        "chat_id":    chat_id or TELEGRAM_CHAT_ID,
        "text":       text,
        "parse_mode": "Markdown",
    }
    if topic_id is not None:
        payload["message_thread_id"] = topic_id
    return _tg_post("sendMessage", payload)


_BULL_KEYWORDS = {"bullish", "uptrend", "naik", "rising", "increase", "momentum",
                  "support", "bounce", "recovery", "positive"}
_BEAR_KEYWORDS = {"bearish", "downtrend", "turun", "falling", "decrease", "drop",
                  "sell", "resistance", "decline", "negative", "overbought"}

def _detect_sentiment(text: str) -> str:
    lower = text.lower()
    bull_score = sum(1 for w in _BULL_KEYWORDS if w in lower)
    bear_score = sum(1 for w in _BEAR_KEYWORDS if w in lower)
    return "bear" if bear_score > bull_score else "bull"

def send_trend_message(text: str, decision: str = "HOLD") -> None:
    if decision == "BUY":
        topic = TELEGRAM_BULL_TOPIC_ID
    elif decision == "SELL":
        topic = TELEGRAM_BEAR_TOPIC_ID
    else:
        sentiment = _detect_sentiment(text)
        topic = TELEGRAM_BULL_TOPIC_ID if sentiment == "bull" else TELEGRAM_BEAR_TOPIC_ID
    send_telegram_message(text, topic_id=topic)


def send_telegram_confirm(symbol: str, signal: dict, volume: float) -> Optional[int]:
    """Kirim konfirmasi ke topic BUY/SELL sesuai arah sinyal untuk sebuah pair."""
    is_buy = signal["decision"] == "BUY"
    emoji  = "🟢" if is_buy else "🔴"
    arah = "BELI" if is_buy else "JUAL"
    text = (
        f"{emoji} *Sinyal {arah}\\!*\n\n"
        f"Koin      : `{symbol}`\n"
        f"Interval  : `{CANDLE_INTERVAL}`\n"
        f"Volume    : `{volume}`\n"
        f"Keyakinan : `{signal['confidence']}%`\n\n"
        f"💬 *Kata AI:*\n_{signal['reason']}_\n\n"
        f"⚠️ Jadi dieksekusi ga?"
    )
    keyboard = {"inline_keyboard": [[
        {"text": "✅ Yuk eksekusi!", "callback_data": f"exec|{signal['decision']}|{volume}"},
        {"text": "❌ Gausah deh",    "callback_data": "cancel"},
    ]]}
    payload: dict = {
        "chat_id":      TELEGRAM_CHAT_ID,
        "text":         text,
        "parse_mode":   "Markdown",
        "reply_markup": json.dumps(keyboard),
    }
    topic = _signal_topic(signal["decision"])
    if topic:
        payload["message_thread_id"] = topic

    resp = _tg_post("sendMessage", payload)
    return resp["result"]["message_id"] if resp else None


def _answer_callback(callback_id: str) -> None:
    requests.post(
        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery",
        json={"callback_query_id": callback_id},
        timeout=5,
    )


def wait_for_reply(message_id: int, timeout: int = CONFIRM_TIMEOUT) -> Optional[str]:
    """Tunggu callback query untuk message_id tertentu dari callback_queue."""
    end = time.time() + timeout
    deferred: list[dict] = []
    while time.time() < end:
        try:
            cq = callback_queue.get(timeout=1)
        except queue.Empty:
            continue

        user_chat = cq["message"]["chat"]["id"]
        if ALLOWED_CHAT_IDS and user_chat not in ALLOWED_CHAT_IDS:
            logger.warning(f"Callback ditolak dari chat_id {user_chat}")
            continue
        if cq["message"]["message_id"] == message_id:
            _answer_callback(cq["id"])
            for d in deferred:
                callback_queue.put(d)
            return cq["data"]
        else:
            deferred.append(cq)

    for d in deferred:
        callback_queue.put(d)
    return None  # timeout


# ---------------------------------------------------------------------------
# ─── 4b. BACKGROUND UPDATE POLLER ───────────────────────────────────────────
# ---------------------------------------------------------------------------

def _is_allowed(chat_id: int) -> bool:
    if not ALLOWED_CHAT_IDS:
        return chat_id == TELEGRAM_CHAT_ID
    return chat_id in ALLOWED_CHAT_IDS or chat_id == TELEGRAM_CHAT_ID


def handle_incoming_message(msg: dict) -> None:
    """Proses pesan teks masuk dari Telegram (chat percakapan)."""
    chat_id   = msg["chat"]["id"]
    thread_id = msg.get("message_thread_id")
    text      = msg.get("text", "").strip()
    user_name = msg.get("from", {}).get("first_name", "User")

    if not text:
        return

    cmd = text.lower().split()[0] if text.startswith("/") else ""

    if cmd == "/chatid":
        send_telegram_message(
            f"📌 *Chat ID grup ini: `{chat_id}`*\n\n"
            f"Isi ke Replit Secret `TELEGRAM_CHAT_ID`\\.",
            topic_id=thread_id, chat_id=chat_id,
        )
        return

    if cmd == "/topicid":
        if thread_id:
            reply_text = (
                f"📌 *Thread ID topic ini: `{thread_id}`*\n\n"
                f"Isi ke Replit Env Vars sesuai topic ini:\n"
                f"• Buy → `TELEGRAM_BUY_TOPIC_ID`\n"
                f"• Sell → `TELEGRAM_SELL_TOPIC_ID`\n"
                f"• Tren naik → `TELEGRAM_BULL_TOPIC_ID`\n"
                f"• Tren turun → `TELEGRAM_BEAR_TOPIC_ID`\n"
                f"• Chat AI → `TELEGRAM_CHAT_TOPIC_ID`"
            )
        else:
            reply_text = (
                "ℹ️ Ini General atau DM — bukan topic\\.\n"
                "Masuk ke salah satu topic lalu ketik `/topicid` di sana\\."
            )
        send_telegram_message(reply_text, topic_id=thread_id, chat_id=chat_id)
        return

    if TELEGRAM_CHAT_TOPIC_ID and thread_id != TELEGRAM_CHAT_TOPIC_ID:
        return

    if cmd in ("/start", "/help"):
        with pairs_lock:
            n_pairs = len(active_pairs)
        topics_info = (
            f"\n\n📌 *Topic Config:*\n"
            f"Buy        : `{TELEGRAM_BUY_TOPIC_ID  or 'belum diset'}`\n"
            f"Sell       : `{TELEGRAM_SELL_TOPIC_ID or 'belum diset'}`\n"
            f"Tren naik  : `{TELEGRAM_BULL_TOPIC_ID or 'belum diset'}`\n"
            f"Tren turun : `{TELEGRAM_BEAR_TOPIC_ID or 'belum diset'}`\n"
            f"Chat AI    : `{TELEGRAM_CHAT_TOPIC_ID or 'belum diset'}`"
        )
        send_telegram_message(
            "🤖 *Trading Bot AI*\n\n"
            "Ngobrol bebas dengan AI di topic ini\\.\n"
            "Tanya kondisi market, strategi, atau analisis kapan saja\\.\n\n"
            f"*Mode:* {'🔴 LIVE' if LIVE_MODE else '🔵 Simulasi'} | "
            f"memindai `{n_pairs}` pair setiap `{CANDLE_INTERVAL}`\n"
            f"*AI Memory:* {len(conversation_history)//2}/{MAX_HISTORY_EXCHANGES} exchange\n\n"
            "*Perintah:*\n"
            "`/pairs`   — jumlah pair yang dipindai\n"
            "`/history` — cek memory AI\n"
            "`/reset`   — hapus memory AI\n"
            "`/laporan` — laporan profit/loss hari ini"
            + topics_info,
            topic_id=thread_id,
            chat_id=chat_id,
        )
        return

    if cmd == "/pairs":
        with pairs_lock:
            n_pairs = len(active_pairs)
        send_telegram_message(
            f"📈 Sedang memindai *{n_pairs}* pair USDT di Binance tiap `{CANDLE_INTERVAL}`\\.",
            topic_id=thread_id,
            chat_id=chat_id,
        )
        return

    if cmd == "/history":
        n = len(conversation_history) // 2
        send_telegram_message(
            f"🧠 AI mengingat *{n}/{MAX_HISTORY_EXCHANGES}* exchange terakhir.",
            topic_id=thread_id,
            chat_id=chat_id,
        )
        return

    if cmd == "/reset":
        with history_lock:
            conversation_history.clear()
        send_telegram_message(
            "🗑️ Memory AI direset\\. Percakapan dimulai dari awal\\.",
            topic_id=thread_id,
            chat_id=chat_id,
        )
        return

    if cmd in ("/laporan", "/report", "/pnl"):
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        send_daily_report(today_str, chat_id=chat_id, topic_id=thread_id)
        return

    logger.info(f"💬 Chat dari {user_name}: {text[:60]}")
    threading.Thread(
        target=_reply_chat,
        args=(text, user_name, chat_id, thread_id),
        daemon=True,
    ).start()


def _reply_chat(text: str, user_name: str, chat_id: int, thread_id: Optional[int]):
    reply = ask_ai_chat(text, user_name)
    payload: dict = {
        "chat_id":    chat_id,
        "text":       reply,
        "parse_mode": "Markdown",
    }
    if thread_id:
        payload["message_thread_id"] = thread_id
    _tg_post("sendMessage", payload)


def update_poller():
    """
    Background thread: poll getUpdates terus-menerus.
    - callback_query → masuk ke callback_queue
    - message → handle_incoming_message
    """
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/deleteWebhook",
            json={"drop_pending_updates": True},
            timeout=10,
        )
        logger.info("🧹 Webhook dihapus, pending updates dibersihkan")
    except Exception as e:
        logger.warning(f"deleteWebhook error: {e}")

    offset = None
    logger.info("📡 Background Telegram poller dimulai")
    while True:
        try:
            params: dict = {
                "timeout":         15,
                "allowed_updates": ["message", "callback_query"],
            }
            if offset:
                params["offset"] = offset
            r = requests.get(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates",
                params=params,
                timeout=25,
            )
            if r.status_code == 409:
                logger.warning("⚠️ 409 Conflict: ada instance bot lain. Tunggu 15s...")
                time.sleep(15)
                continue
            r.raise_for_status()
            for upd in r.json().get("result", []):
                offset = upd["update_id"] + 1
                if "callback_query" in upd:
                    callback_queue.put(upd["callback_query"])
                elif "message" in upd:
                    handle_incoming_message(upd["message"])
        except Exception as e:
            logger.warning(f"Poller error: {e}")
            time.sleep(3)

# ---------------------------------------------------------------------------
# ─── 5. EKSEKUSI ORDER BINANCE ───────────────────────────────────────────────
# ---------------------------------------------------------------------------

def get_binance_equity() -> float:
    try:
        from binance.client import Client
        client = Client(BINANCE_API_KEY, BINANCE_API_SECRET)
        account = client.get_account()
        for b in account.get("balances", []):
            if b["asset"] == "USDT":
                return float(b["free"]) + float(b["locked"])
    except Exception as e:
        logger.warning(f"Tidak bisa ambil equity Binance: {e}")
    return 0.0


def execute_binance(symbol: str, side: str, qty: float) -> dict:
    from binance.client import Client
    client = Client(BINANCE_API_KEY, BINANCE_API_SECRET)
    for attempt in range(3):
        try:
            order = client.order_market(symbol=symbol, side=side, quantity=qty)
            logger.info(f"Binance order: {order}")
            return order
        except Exception as e:
            logger.error(f"Binance order error (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)
    raise RuntimeError("Binance order gagal setelah 3 kali coba")


def place_oco_sell(symbol: str, qty: float, entry_price: float,
                    tp_pct: float = TP_PCT, sl_pct: float = SL_PCT) -> Optional[dict]:
    """Pasang OCO sell (Take Profit + Stop Loss) langsung di Binance begitu posisi
    BUY tereksekusi, supaya posisi tidak dibiarkan terbuka tanpa target keluar.
    TP = limit sell di atas entry_price. SL = stop-limit sell di bawah entry_price."""
    from binance.client import Client
    f = get_symbol_filters(symbol)
    tick = f.get("tickSize", 0.00000001)
    step = f.get("stepSize", 0.00001)

    qty = _round_step(qty, step)
    if qty <= 0:
        logger.warning(f"⏭️ Lewati OCO {symbol}: qty setelah rounding jadi 0")
        return None

    tp_price   = _round_price(entry_price * (1 + tp_pct / 100), tick)
    sl_stop    = _round_price(entry_price * (1 - sl_pct / 100), tick)
    sl_limit   = _round_price(sl_stop * 0.999, tick)

    client = Client(BINANCE_API_KEY, BINANCE_API_SECRET)
    for attempt in range(3):
        try:
            oco = client.create_oco_order(
                symbol=symbol,
                side="SELL",
                quantity=qty,
                price=str(tp_price),
                stopPrice=str(sl_stop),
                stopLimitPrice=str(sl_limit),
                stopLimitTimeInForce="GTC",
            )
            logger.info(
                f"🎯 OCO TP/SL terpasang {symbol}: qty={qty} TP={tp_price} "
                f"SL_trigger={sl_stop} SL_limit={sl_limit}"
            )
            reports = oco.get("orderReports", [])
            tp_id = next((r["orderId"] for r in reports if r.get("type") == "LIMIT_MAKER"), None)
            sl_id = next((r["orderId"] for r in reports if r.get("type") == "STOP_LOSS_LIMIT"), None)
            oco["_tp_order_id"] = tp_id
            oco["_sl_order_id"] = sl_id
            oco["_tp_price"] = tp_price
            oco["_sl_price"] = sl_stop
            return oco
        except Exception as e:
            logger.error(f"OCO order error {symbol} (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)
    logger.error(f"⚠️ Gagal pasang OCO TP/SL untuk {symbol} setelah 3 kali coba — posisi tetap terbuka tanpa target otomatis")
    return None


def register_open_position(symbol: str, qty: float, entry_price: float, oco: dict) -> None:
    with positions_lock:
        open_positions[symbol] = {
            "qty": qty,
            "entry_price": entry_price,
            "tp_order_id": oco.get("_tp_order_id"),
            "sl_order_id": oco.get("_sl_order_id"),
            "tp_price": oco.get("_tp_price"),
            "sl_price": oco.get("_sl_price"),
            "opened_at": datetime.now(timezone.utc).isoformat(),
        }


def _check_position_close(symbol: str, pos: dict) -> None:
    """Cek apakah OCO leg (TP/SL) sudah FILLED. Kalau ya, catat pnl & kirim notifikasi."""
    from binance.client import Client
    client = Client(BINANCE_API_KEY, BINANCE_API_SECRET)
    entry_price = pos["entry_price"]
    qty = pos["qty"]

    for leg, order_id, label in (
        ("tp", pos.get("tp_order_id"), "TP"),
        ("sl", pos.get("sl_order_id"), "SL"),
    ):
        if not order_id:
            continue
        try:
            order = client.get_order(symbol=symbol, orderId=order_id)
        except Exception as e:
            logger.warning(f"Gagal cek status order {label} {symbol}: {e}")
            continue

        if order.get("status") != "FILLED":
            continue

        exec_qty = float(order.get("executedQty", qty)) or qty
        quote_qty = float(order.get("cummulativeQuoteQty", 0))
        exit_price = (quote_qty / exec_qty) if exec_qty else float(order.get("price", entry_price))
        pnl = (exit_price - entry_price) * exec_qty
        pnl_pct = ((exit_price / entry_price) - 1) * 100 if entry_price else 0.0
        result = "CLOSED_TP" if label == "TP" else "CLOSED_SL"

        log_trade(symbol, "SELL", exec_qty, exit_price, 0, f"OCO {label} tereksekusi",
                  result, str(order_id), extra={"pnl": round(pnl, 4), "pnl_pct": round(pnl_pct, 3)})

        icon = "✅" if pnl >= 0 else "🔴"
        send_telegram_message(
            f"{icon} *Posisi `{symbol}` ditutup \\({label}\\)*\n\n"
            f"Entry  : `{entry_price}`\n"
            f"Exit   : `{exit_price}`\n"
            f"PnL    : `{pnl:+.4f} USDT` \\(`{pnl_pct:+.2f}%`\\)",
        )

        with positions_lock:
            open_positions.pop(symbol, None)
        return


def position_monitor_loop() -> None:
    """Cek berkala apakah ada posisi yang ditutup lewat TP/SL, dan kirim laporan
    profit/loss harian otomatis di jam yang ditentukan (DAILY_REPORT_HOUR_UTC)."""
    global daily_report_sent_date
    while True:
        try:
            with positions_lock:
                snapshot = dict(open_positions)
            for symbol, pos in snapshot.items():
                _check_position_close(symbol, pos)

            now = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")
            if now.hour == DAILY_REPORT_HOUR_UTC and daily_report_sent_date != today_str:
                send_daily_report(today_str)
                daily_report_sent_date = today_str
        except Exception as e:
            logger.error(f"position_monitor_loop error: {e}")
        time.sleep(30)


def compute_daily_report(date_str: str) -> dict:
    """Baca trades.log dan hitung ringkasan profit/loss untuk tanggal (UTC) tertentu."""
    total_pnl = 0.0
    wins = 0
    losses = 0
    trades_opened = 0
    skipped_too_small = 0

    if os.path.exists(TRADES_LOG):
        with open(TRADES_LOG, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = rec.get("timestamp", "")
                if not ts.startswith(date_str):
                    continue
                result = rec.get("result", "")
                if result == "CLOSED_TP":
                    wins += 1
                    total_pnl += float(rec.get("pnl", 0))
                elif result == "CLOSED_SL":
                    losses += 1
                    total_pnl += float(rec.get("pnl", 0))
                elif result == "EXECUTED":
                    trades_opened += 1
                elif result == "SKIPPED_TOO_SMALL":
                    skipped_too_small += 1

    closed = wins + losses
    win_rate = (wins / closed * 100) if closed else 0.0
    return {
        "date": date_str,
        "total_pnl": round(total_pnl, 4),
        "wins": wins,
        "losses": losses,
        "win_rate": round(win_rate, 1),
        "trades_opened": trades_opened,
        "skipped_too_small": skipped_too_small,
    }


def send_daily_report(date_str: str, chat_id: Optional[int] = None, topic_id: Optional[int] = None) -> None:
    r = compute_daily_report(date_str)
    with positions_lock:
        n_open = len(open_positions)
    icon = "📈" if r["total_pnl"] >= 0 else "📉"
    text = (
        f"{icon} *Laporan Profit/Loss — {r['date']}*\n\n"
        f"Total PnL     : `{r['total_pnl']:+.4f} USDT`\n"
        f"Posisi profit \\(TP\\) : `{r['wins']}`\n"
        f"Posisi rugi \\(SL\\)   : `{r['losses']}`\n"
        f"Win rate      : `{r['win_rate']}%`\n"
        f"Order dieksekusi hari ini : `{r['trades_opened']}`\n"
        f"Sinyal dilewati \\(saldo kecil\\) : `{r['skipped_too_small']}`\n"
        f"Posisi masih terbuka sekarang : `{n_open}`"
    )
    send_telegram_message(text, chat_id=chat_id, topic_id=topic_id)

# ---------------------------------------------------------------------------
# ─── 6. LOGGING TRADE ───────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

trades_log_lock = threading.Lock()

def log_trade(symbol, side, qty, price, confidence, reason, result,
              order_id="", extra=None):
    record = {
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "symbol":     symbol,
        "side":       side,
        "qty":        qty,
        "price":      price,
        "confidence": confidence,
        "reason":     reason,
        "result":     result,
        "order_id":   order_id,
        "live_mode":  LIVE_MODE,
        **(extra or {}),
    }
    with trades_log_lock:
        with open(TRADES_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    logger.info(f"Log: {result} | {side} {symbol} @ {price} | conf={confidence}%")

# ---------------------------------------------------------------------------
# ─── 7. MANAJEMEN RISIKO ────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def calc_quantity(current_price: float, atr: float,
                  equity: float = 10_000.0, symbol: str = "") -> float:
    max_loss  = equity * MAX_EXPOSURE_PCT
    stop_dist = atr if atr > 0 else current_price * 0.01
    raw_qty   = max(max_loss / stop_dist, 0.0)

    if symbol:
        f = get_symbol_filters(symbol)
        raw_qty = _round_step(raw_qty, f["stepSize"])
        raw_qty = max(raw_qty, f["minQty"])

    return raw_qty


def qty_is_tradable(symbol: str, qty: float, price: float) -> bool:
    """Cek qty final memenuhi LOT_SIZE minQty & MIN_NOTIONAL Binance untuk simbol ini."""
    f = get_symbol_filters(symbol)
    if qty < f["minQty"]:
        return False
    if f["minNotional"] and (qty * price) < f["minNotional"]:
        return False
    return True


def check_daily_loss(equity_now: float) -> bool:
    global LIVE_MODE
    if daily_start_equity <= 0 or equity_now <= 0:
        return True
    if equity_now < daily_start_equity * (1 - DAILY_LOSS_LIMIT_PCT):
        logger.warning("⛔ Daily loss limit 5% tercapai – LIVE_MODE dimatikan")
        LIVE_MODE = False
        send_trend_message(
            "⛔ *Bot ditangguhkan* – daily loss limit 5% tercapai\\. LIVE\\_MODE dimatikan\\."
        )
        return False
    return True


def _in_cooldown(symbol: str) -> bool:
    with last_signal_lock:
        t = last_signal_at.get(symbol)
    return bool(t and (time.time() - t) < SYMBOL_COOLDOWN_SEC)


def _mark_signal(symbol: str) -> None:
    with last_signal_lock:
        last_signal_at[symbol] = time.time()

# ---------------------------------------------------------------------------
# ─── 8. PROSES SATU SINYAL (dipanggil per-pair, bisa berjalan di thread) ────
# ---------------------------------------------------------------------------

def process_signal(symbol: str, signal: dict, current_price: float, atr: float) -> None:
    """Tangani satu sinyal BUY/SELL yang lolos confidence threshold untuk sebuah pair."""
    decision   = signal["decision"]
    confidence = signal["confidence"]
    reason     = signal["reason"]

    equity = get_binance_equity() if LIVE_MODE and BINANCE_API_KEY else 10_000.0
    qty    = calc_quantity(current_price, atr, equity, symbol=symbol)

    if LIVE_MODE and not qty_is_tradable(symbol, qty, current_price):
        f = get_symbol_filters(symbol)
        reason_skip = (
            f"Saldo USDT ({equity:.4f}) kekecilan buat order {symbol} "
            f"(butuh min notional ~{f['minNotional']}, min qty {f['minQty']})."
        )
        logger.warning(f"⏭️ Lewati sinyal {symbol}: {reason_skip}")
        log_trade(symbol, decision, qty, current_price, confidence, reason, "SKIPPED_TOO_SMALL")
        send_telegram_message(
            f"⏭️ *Sinyal {symbol} dilewati*\n\n"
            f"AI bilang {'BUY' if decision=='BUY' else 'SELL'} \\({confidence}%\\), "
            f"tapi saldo USDT kamu kekecilan buat order ini \\(butuh notional min "
            f"~{f['minNotional']}\\)\\. Gak jadi kirim tombol konfirmasi\\.",
            topic_id=_signal_topic(decision),
        )
        return

    if not LIVE_MODE:
        logger.info(f"[SIM] {decision} {qty} {symbol} @ ~{current_price}")
        log_trade(symbol, decision, qty, current_price, confidence, reason, "SIMULATED")
        send_telegram_message(
            f"🔵 *\\[SIMULASI\\]* {'Beli' if decision=='BUY' else 'Jual'} `{symbol}`\n\n"
            f"Volume  : `{qty}`\n"
            f"Harga   : `{current_price}`\n"
            f"Yakin   : `{confidence}%`\n\n"
            f"💬 _{reason}_",
            topic_id=_signal_topic(decision),
        )
        return

    if not check_daily_loss(equity):
        return

    acquired = confirmation_slots.acquire(blocking=False)
    if not acquired:
        logger.info(f"Slot konfirmasi penuh — lewati sinyal {symbol} kali ini")
        return

    try:
        msg_id = send_telegram_confirm(symbol, signal, qty)
        if msg_id is None:
            logger.error(f"Gagal kirim konfirmasi Telegram untuk {symbol}")
            return

        reply = wait_for_reply(msg_id)
        if not reply or reply == "cancel":
            log_trade(symbol, decision, qty, current_price, confidence, reason, "CANCELLED")
            send_telegram_message(
                f"❌ *Gajadi deh\\!*\n\n"
                f"Order `{symbol}` {'beli' if decision=='BUY' else 'jual'} dibatalkan "
                f"— gada yang konfirmasi atau timeout",
                topic_id=_signal_topic(decision),
            )
            return

        binance_result, errors = {}, []
        try:
            binance_result = execute_binance(symbol, decision, qty)
        except Exception as e:
            errors.append(f"Binance: {e}")

        fill_price = float(
            binance_result.get("fills", [{}])[0].get("price", current_price)
        ) if binance_result.get("fills") else current_price
        filled_qty = float(binance_result.get("executedQty", qty)) if binance_result else qty
        order_id   = str(binance_result.get("orderId", "ERR"))
        status_str = "EXECUTED" if not errors else f"ERROR: {'; '.join(errors)}"

        log_trade(symbol, decision, qty, fill_price, confidence, reason, status_str, order_id)

        icon = "✅" if not errors else "⚠️"
        send_telegram_message(
            f"{icon} *Order masuk ke Binance\\!*\n\n"
            f"Koin    : `{symbol}`\n"
            f"Aksi    : *{'Beli' if decision=='BUY' else 'Jual'}*\n"
            f"Volume  : `{qty}`\n"
            f"Harga   : `{fill_price}`\n"
            f"ID Order: `{order_id}`\n"
            f"Status  : {'Berhasil ✅' if not errors else '⚠️ Ada masalah: ' + '; '.join(errors)}",
            topic_id=_signal_topic(decision),
        )

        # Setelah BUY tereksekusi, pasang OCO TP/SL otomatis biar posisi nggak
        # dibiarkan terbuka tanpa target keluar.
        if not errors and decision == "BUY" and filled_qty > 0:
            oco = place_oco_sell(symbol, filled_qty, fill_price)
            if oco:
                tp_price = oco.get("_tp_price", fill_price * (1 + TP_PCT / 100))
                sl_price = oco.get("_sl_price", fill_price * (1 - SL_PCT / 100))
                register_open_position(symbol, filled_qty, fill_price, oco)
                log_trade(symbol, "OCO_TP_SL", filled_qty, fill_price, confidence,
                          f"TP={tp_price} SL={sl_price}", "PLACED",
                          str(oco.get("orderListId", "")))
                send_telegram_message(
                    f"🎯 *TP/SL otomatis terpasang* `{symbol}`\n\n"
                    f"Take Profit : `{tp_price}` \\(\\+{TP_PCT}%\\)\n"
                    f"Stop Loss   : `{sl_price}` \\(\\-{SL_PCT}%\\)",
                    topic_id=_signal_topic(decision),
                )
            else:
                send_telegram_message(
                    f"⚠️ *TP/SL gagal dipasang* untuk `{symbol}`\\. Posisi tetap terbuka "
                    f"— pantau manual atau jual sendiri kalau perlu\\.",
                    topic_id=_signal_topic(decision),
                )
    finally:
        confirmation_slots.release()

# ---------------------------------------------------------------------------
# ─── 9. MAIN LOOP ───────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def main_loop():
    global daily_start_equity
    if LIVE_MODE and BINANCE_API_KEY:
        daily_start_equity = get_binance_equity()
        logger.info(f"💰 Equity awal Binance: {daily_start_equity} USDT")

    with pairs_lock:
        n_pairs = len(active_pairs)
    logger.info(f"🤖 Bot mulai | LIVE_MODE={LIVE_MODE} | memindai {n_pairs} pair | {CANDLE_INTERVAL}")

    topic_info = (
        f"\n\n📌 *Topics:*\n"
        f"Buy        : `{TELEGRAM_BUY_TOPIC_ID  or 'general'}`\n"
        f"Sell       : `{TELEGRAM_SELL_TOPIC_ID or 'general'}`\n"
        f"Tren naik  : `{TELEGRAM_BULL_TOPIC_ID or 'general'}`\n"
        f"Tren turun : `{TELEGRAM_BEAR_TOPIC_ID or 'general'}`\n"
        f"Chat AI    : `{TELEGRAM_CHAT_TOPIC_ID or 'general'}`"
    )
    send_telegram_message(
        f"👋 *Bot trading udah nyala nih\\!*\n\n"
        f"Broker  : Binance\n"
        f"Mode    : {'🔴 LIVE \\(uang beneran\\)' if LIVE_MODE else '🔵 Simulasi'}\n"
        f"Pair    : memindai `{n_pairs}` pair USDT setiap `{CANDLE_INTERVAL}`\n"
        f"AI      : Groq Llama 3\\.1\n"
        f"Minimal keyakinan: `{CONFIDENCE_THRESHOLD}%`"
        + topic_info,
        topic_id=None,
    )

    while True:
        try:
            with pairs_lock:
                pairs_snapshot = list(active_pairs)

            ai_calls_this_cycle = 0
            cycle_start = time.time()

            for symbol in pairs_snapshot:
                try:
                    if _in_cooldown(symbol):
                        continue

                    df = fetch_market(symbol)
                    if df is None or len(df) < 30:
                        continue

                    df = compute_indicators(df)
                    if not is_interesting(df):
                        continue

                    if ai_calls_this_cycle >= MAX_AI_CALLS_PER_CYCLE:
                        # Sudah cukup kandidat dianalisis AI siklus ini
                        continue

                    last = df.iloc[-1]
                    current_price = float(last["close"])
                    atr = float(last["atr14"]) if not pd.isna(last["atr14"]) else 0.0

                    signal = ask_ai(symbol, df)
                    ai_calls_this_cycle += 1
                    decision   = signal["decision"]
                    confidence = signal["confidence"]
                    reason     = signal["reason"]
                    logger.info(f"AI → {symbol} {decision} ({confidence}%) | {reason}")

                    if confidence < CONFIDENCE_THRESHOLD:
                        log_trade(symbol, decision, 0, current_price, confidence, reason, "HOLD")
                        send_trend_message(
                            f"📊 *Update {symbol}*\n\n"
                            f"Sinyal  : *{decision}*\n"
                            f"Yakin   : `{confidence}%` — belum cukup buat order\n\n"
                            f"💬 _{reason}_\n\n"
                            f"⏸ _Nunggu dulu, belum ada yang dieksekusi_",
                            decision=decision,
                        )
                        continue

                    _mark_signal(symbol)
                    threading.Thread(
                        target=process_signal,
                        args=(symbol, signal, current_price, atr),
                        daemon=True,
                    ).start()

                except Exception as e:
                    logger.warning(f"Error memproses {symbol}: {e}")

                time.sleep(INTER_SYMBOL_DELAY_SEC)

            elapsed = time.time() - cycle_start
            remaining = max(LOOP_SLEEP - elapsed, 5)
            time.sleep(remaining)

        except KeyboardInterrupt:
            logger.info("Bot dihentikan oleh user.")
            send_telegram_message("🛑 Bot dihentiin nih, sampai jumpa lagi ya!")
            break
        except Exception as e:
            logger.exception(f"Error tak terduga: {e}")
            time.sleep(30)


# ---------------------------------------------------------------------------
# ─── ENTRY POINT ────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    missing = [k for k, v in {
        "GROQ_API_KEY":       GROQ_API_KEY,
        "TELEGRAM_BOT_TOKEN": TELEGRAM_BOT_TOKEN,
        "TELEGRAM_CHAT_ID":   str(TELEGRAM_CHAT_ID),
    }.items() if not v or v == "0"]

    if missing:
        logger.error(f"❌ Secret belum diisi: {', '.join(missing)}")
        raise SystemExit(1)

    if LIVE_MODE and not (BINANCE_API_KEY and BINANCE_API_SECRET):
        logger.error("❌ BINANCE_API_KEY dan BINANCE_API_SECRET wajib diisi saat LIVE_MODE = True")
        raise SystemExit(1)

    # Ambil daftar pair pertama kali sebelum mulai
    refresh_pairs()

    # Flask keep-alive
    threading.Thread(target=run_flask, daemon=True).start()
    logger.info("✅ Flask keep-alive aktif")

    # Refresh daftar pair tiap 1 jam (exchange bisa nambah/hapus pair)
    threading.Thread(target=pairs_refresher_loop, daemon=True).start()

    # Background Telegram poller (handle chat + callback)
    threading.Thread(target=update_poller, daemon=True).start()

    # Pantau posisi terbuka (deteksi TP/SL close) + laporan profit/loss harian
    threading.Thread(target=position_monitor_loop, daemon=True).start()

    # Main trading loop
    main_loop()
