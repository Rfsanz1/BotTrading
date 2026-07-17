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
import re
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

CONFIDENCE_THRESHOLD: int = 80
MAX_EXPOSURE_PCT: float = 0.02

# Berapa persen dari total saldo Binance yang boleh dipakai untuk trading.
# Sisanya "dikunci" dan tidak akan disentuh bot sama sekali.
# Contoh: 0.5 = pakai 50% saldo, sisanya aman.
# Override lewat env var: CAPITAL_ALLOCATION_PCT=0.5
CAPITAL_ALLOCATION_PCT: float = max(0.01, min(1.0, float(os.getenv("CAPITAL_ALLOCATION_PCT", "0.5"))))
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
TP_PCT: float = float(os.getenv("TP_PCT", "3"))
SL_PCT: float = float(os.getenv("SL_PCT", "1"))

# Jam (UTC) kapan laporan profit/loss harian otomatis dikirim ke Telegram.
# Default 17 UTC = 00:00 WIB (baru ganti hari di Indonesia).
DAILY_REPORT_HOUR_UTC: int = int(os.getenv("DAILY_REPORT_HOUR_UTC", "17"))

# Sumber berita crypto/market (RSS resmi, gratis, tanpa API key) yang dipantau
# buat kasih AI konteks kondisi pasar terkini, bukan cuma indikator teknikal.
NEWS_FEEDS: list[str] = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
]
NEWS_REFRESH_SEC: int = int(os.getenv("NEWS_REFRESH_SEC", "900"))  # 15 menit

# Groq – berapa exchange terakhir yang diingat (1 exchange = 1 user + 1 assistant)
MAX_HISTORY_EXCHANGES: int = 4   # dikurangi supaya tidak 413 Too Large

# ATR-based dynamic TP/SL — R:R 1:4
# Stop Loss  = SL_ATR_MULT × ATR di bawah entry (default 1.0×)
# Take Profit = TP_ATR_MULT × ATR di atas entry (default 4.0×)
# Override via env var kalau ingin rasio berbeda.
SL_ATR_MULT: float = float(os.getenv("SL_ATR_MULT", "1.0"))
TP_ATR_MULT: float = float(os.getenv("TP_ATR_MULT", "4.0"))

# Multi-timeframe — interval yang dianalisis bersama (1m sebagai primary)
MTF_INTERVALS: list[str] = ["1m", "5m", "15m"]
MTF_LIMIT: int = 100  # jumlah candle per interval

# ---------------------------------------------------------------------------
# ─── ENVIRONMENT VARIABLES ──────────────────────────────────────────────────
# ---------------------------------------------------------------------------

GROQ_API_KEY        = os.getenv("GROQ_API_KEY", "")
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY", "")
TELEGRAM_BOT_TOKEN  = os.getenv("TELEGRAM_BOT_TOKEN", "")

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
TELEGRAM_REPORT_TOPIC_ID: Optional[int] = _parse_topic("TELEGRAM_REPORT_TOPIC_ID")
TELEGRAM_NEWS_TOPIC_ID: Optional[int] = _parse_topic("TELEGRAM_NEWS_TOPIC_ID")

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

# Cache berita crypto/market terbaru (di-refresh berkala oleh news_refresher_loop)
# — dipakai sebagai konteks tambahan buat AI & command /berita.
latest_news: list[dict] = []
news_lock = threading.Lock()

# Link berita yang sudah pernah diposting ke topic berita — supaya tidak
# posting ulang headline yang sama tiap kali refresh.
seen_news_links: set[str] = set()
MAX_NEW_NEWS_PER_CYCLE = 6  # batasi spam kalau tiba-tiba banyak headline baru

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

_HTML_TAG_RE = re.compile(r"<[^<]+?>")

def _clean_html(text: str, max_len: int = 220) -> str:
    text = _HTML_TAG_RE.sub("", text or "").strip()
    text = " ".join(text.split())
    return text[:max_len].rstrip() + ("…" if len(text) > max_len else "")


def fetch_crypto_news() -> list[dict]:
    """Ambil headline + ringkasan terbaru dari RSS feed media crypto (CoinDesk,
    Cointelegraph, Decrypt) — gratis, tanpa API key. Dipakai buat kasih AI & user
    konteks kondisi pasar/berita terkini, bukan cuma indikator teknikal."""
    import feedparser
    items = []
    for url in NEWS_FEEDS:
        try:
            feed = feedparser.parse(url)
            source = feed.feed.get("title", url)
            for entry in feed.entries[:10]:
                items.append({
                    "title": entry.get("title", "").strip(),
                    "summary": _clean_html(entry.get("summary", "")),
                    "link": entry.get("link", ""),
                    "source": source,
                    "published": entry.get("published", ""),
                })
        except Exception as e:
            logger.warning(f"Gagal ambil RSS {url}: {e}")
    return items


def _post_news_item(n: dict) -> None:
    """Posting satu headline ke topic berita, gaya feed real-time — judul,
    sumber, ringkasan singkat, dan link ke artikel aslinya."""
    text = f"📰 *{n['source']}*\n\n*{n['title']}*"
    if n.get("summary"):
        text += f"\n\n{n['summary']}"
    if n.get("link"):
        text += f"\n\n🔗 {n['link']}"
    send_telegram_message(text, topic_id=TELEGRAM_NEWS_TOPIC_ID)


def news_refresher_loop() -> None:
    """Refresh cache berita tiap NEWS_REFRESH_SEC detik di background, dan posting
    headline baru (belum pernah tampil) ke topic berita secara real-time."""
    global latest_news
    first_run = True
    while True:
        try:
            items = fetch_crypto_news()
            if items:
                with news_lock:
                    latest_news = items

                new_items = [n for n in items if n["link"] and n["link"] not in seen_news_links]
                for n in items:
                    if n["link"]:
                        seen_news_links.add(n["link"])

                if TELEGRAM_NEWS_TOPIC_ID and new_items and not first_run:
                    # urutkan lama → baru biar kebaca seperti feed kronologis
                    for n in list(reversed(new_items))[-MAX_NEW_NEWS_PER_CYCLE:]:
                        _post_news_item(n)
                        time.sleep(1.5)  # hindari rate-limit Telegram

                logger.info(f"📰 Berita ter-update: {len(items)} headline dari {len(NEWS_FEEDS)} sumber, {len(new_items)} baru")
                first_run = False
        except Exception as e:
            logger.error(f"news_refresher_loop error: {e}")
        time.sleep(NEWS_REFRESH_SEC)


def get_relevant_news(symbol: str = "", max_items: int = 4) -> list[dict]:
    """Ambil headline yang menyebut base asset simbol ini (misal 'Bitcoin' buat
    BTCUSDT); kalau nggak ada yang relevan, kembalikan headline umum terbaru."""
    with news_lock:
        pool = list(latest_news)
    if not pool:
        return []

    base = symbol.replace("USDT", "") if symbol else ""
    aliases = {
        "BTC": ["bitcoin", "btc"], "ETH": ["ethereum", "eth"],
        "BNB": ["bnb", "binance coin"], "SOL": ["solana", "sol"],
        "XRP": ["xrp", "ripple"], "DOGE": ["dogecoin", "doge"],
    }
    keywords = aliases.get(base, [base.lower()]) if base else []

    relevant = [n for n in pool if keywords and any(k in n["title"].lower() for k in keywords)]
    if relevant:
        return relevant[:max_items]
    return pool[:max_items]


# ---------------------------------------------------------------------------
# ─── 0b. BINANCE FUTURES — FUNDING RATE & OPEN INTEREST (public, no key) ────
# ---------------------------------------------------------------------------

def fetch_funding_rate(symbol: str) -> Optional[dict]:
    """Ambil funding rate terkini + mark price dari Binance Futures (fapi).
    Funding rate positif → long membayar short (pasar terlalu bullish / crowded longs).
    Funding rate negatif → short membayar long (pasar oversold / crowded shorts).
    Return None kalau pair tidak ada di Futures."""
    try:
        r = requests.get(
            "https://fapi.binance.com/fapi/v1/premiumIndex",
            params={"symbol": symbol},
            timeout=5,
        )
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        d = r.json()
        rate = float(d.get("lastFundingRate", 0)) * 100  # konversi ke %
        return {
            "funding_rate_pct": round(rate, 4),
            "mark_price":       round(float(d.get("markPrice", 0)), 8),
            "index_price":      round(float(d.get("indexPrice", 0)), 8),
            "sentiment":        (
                "sangat bullish (crowded long, hati-hati reversal)" if rate > 0.05
                else "bullish ringan" if rate > 0.01
                else "netral" if abs(rate) <= 0.01
                else "bearish ringan" if rate > -0.05
                else "sangat bearish (crowded short, potensi short squeeze)"
            ),
        }
    except Exception as e:
        logger.debug(f"Funding rate {symbol} tidak tersedia: {e}")
        return None


def fetch_open_interest(symbol: str) -> Optional[dict]:
    """Ambil open interest saat ini dari Binance Futures.
    OI naik + harga naik → tren bullish kuat (uang baru masuk mengikuti trend).
    OI naik + harga turun → distribusi/shorting agresif.
    OI turun + harga naik → short squeeze atau profit-taking.
    OI turun + harga turun → capitulation / likuidasi massal."""
    try:
        r = requests.get(
            "https://fapi.binance.com/fapi/v1/openInterest",
            params={"symbol": symbol},
            timeout=5,
        )
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        d = r.json()
        return {
            "open_interest":       round(float(d.get("openInterest", 0)), 2),
            "open_interest_value": round(float(d.get("openInterest", 0)) * float(d.get("openInterest", 0)), 2),
        }
    except Exception as e:
        logger.debug(f"Open interest {symbol} tidak tersedia: {e}")
        return None


def fetch_oi_change(symbol: str) -> Optional[dict]:
    """Ambil histori open interest 5 periode (5m bucket) untuk lihat tren OI naik/turun."""
    try:
        r = requests.get(
            "https://fapi.binance.com/futures/data/openInterestHist",
            params={"symbol": symbol, "period": "5m", "limit": 5},
            timeout=5,
        )
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        data = r.json()
        if not data or len(data) < 2:
            return None
        oldest = float(data[0].get("sumOpenInterest", 0))
        newest = float(data[-1].get("sumOpenInterest", 0))
        change_pct = ((newest - oldest) / oldest * 100) if oldest else 0.0
        return {
            "oi_now":       round(newest, 2),
            "oi_change_pct": round(change_pct, 3),
            "trend":        "naik" if change_pct > 0.5 else "turun" if change_pct < -0.5 else "sideways",
        }
    except Exception as e:
        logger.debug(f"OI hist {symbol} tidak tersedia: {e}")
        return None


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


# Minimum ATR sebagai persen dari harga — pasar yang terlalu "diam" dilewati
# supaya tidak masuk di kondisi sideways yang rawan false signal.
MIN_ATR_PCT: float = float(os.getenv("MIN_ATR_PCT", "0.4"))

def is_trending(df: pd.DataFrame) -> bool:
    """
    Filter anti-sideways: kembalikan True hanya jika pasar sedang bergerak
    (trending), bukan ranging/stagnan.

    Tiga syarat — semua harus terpenuhi:
    1. ATR ≥ MIN_ATR_PCT dari harga close  → ada volatilitas minimal
    2. SMA20 dan SMA50 divergen (selisih ≥ 0.2% dari harga)  → ada tren
    3. RSI tidak terjebak di zona netral 42–58  → momentum jelas

    Kalau pasar sideways sinyal BUY/SELL sering false positif dan
    risikonya tidak sebanding. Lebih baik skip dan tunggu tren jelas.
    """
    last   = df.iloc[-1]
    close  = float(last["close"])
    if close <= 0:
        return False

    atr   = last.get("atr14")
    sma20 = last.get("sma20")
    sma50 = last.get("sma50")
    rsi   = last.get("rsi14")

    if pd.isna(atr) or pd.isna(sma20) or pd.isna(sma50) or pd.isna(rsi):
        return False

    # 1. Volatilitas cukup?
    atr_pct = (atr / close) * 100
    if atr_pct < MIN_ATR_PCT:
        return False

    # 2. Tren jelas? SMA harus divergen setidaknya 0.2% dari harga
    sma_gap_pct = abs(sma20 - sma50) / close * 100
    if sma_gap_pct < 0.2:
        return False

    # 3. Momentum tidak netral (RSI harus keluar dari zona 42–58)
    if 42 <= rsi <= 58:
        return False

    return True

# ---------------------------------------------------------------------------
# ─── 3. ANALISIS AI (GROQ – conversational, ingat history) ──────────────────
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_TRADING = """Kamu adalah analis trading kripto profesional yang cerdas dan teliti. \
Kamu menganalisis data multi-timeframe (1m, 5m, 15m) + data Futures Binance (funding rate, open interest) \
+ berita pasar untuk menghasilkan keputusan trading berkualitas tinggi.

=== CARA ANALISIS (WAJIB DIIKUTI) ===

1. MULTI-TIMEFRAME CONFLUENCE
   - 15m → arah tren utama (trend direction). Ini yang paling penting.
   - 5m  → konfirmasi momentum dan entry timing.
   - 1m  → presisi entry, lihat apakah ada momentum jangka sangat pendek.
   - Sinyal BUY/SELL kuat = minimal 2 dari 3 TF sepakat arahnya.
   - Kalau 15m berlawanan dengan 1m/5m → HOLD atau kurangi confidence signifikan.

2. INDIKATOR TEKNIKAL
   - RSI: oversold (<30) → potensi BUY, overbought (>70) → potensi SELL.
     RSI 30-70 = zona netral, tidak ada sinyal kuat dari RSI saja.
   - MACD histogram crossing zero: bullish cross (neg→pos) = BUY signal,
     bearish cross (pos→neg) = SELL signal.
   - SMA20 vs SMA50: SMA20 di atas SMA50 = uptrend, di bawah = downtrend.
   - ATR14: ukuran volatilitas. ATR tinggi = momentum kuat, ATR rendah = sideways.

3. FUNDING RATE (dari Binance Futures)
   - Funding positif tinggi (>0.05%) = pasar terlalu bullish, crowded longs.
     → Risiko reversal ke bawah, hati-hati BUY, bisa SELL/HOLD.
   - Funding negatif dalam (<-0.05%) = crowded shorts, potensi short squeeze.
     → Tambah confidence untuk BUY.
   - Funding netral (-0.01% s.d. +0.01%) = tidak ada tekanan arah dari futures.

4. OPEN INTEREST (OI)
   - OI naik + harga naik = tren bullish dikonfirmasi, uang baru masuk long.
   - OI naik + harga turun = tekanan short agresif, tren bearish kuat.
   - OI turun + harga naik = short squeeze / profit-taking, tren mungkin lemah.
   - OI turun + harga turun = likuidasi/capitulation, potensi reversal dekat.

5. SENTIMEN BERITA
   - Berita regulasi negatif, hack, atau crash bisa override sinyal teknikal bullish.
   - Berita adopsi, ETF, atau listing besar → tambah confidence BUY.
   - Kalau tidak ada berita relevan, murni andalkan teknikal + futures data.

6. RISK-REWARD
   - Bot menggunakan TP = 4×ATR dan SL = 1×ATR (R:R 1:4).
   - Jangan BUY/SELL kalau potensi profit tidak sepadan dengan risiko.
   - Lebih baik HOLD daripada masuk di kondisi ragu-ragu.

=== FORMAT JAWABAN ===
Kalau diminta analisis data market, balas HANYA dengan JSON valid berikut, tanpa teks lain:
{ "decision": "BUY"|"SELL"|"HOLD", "reason": "<2-3 kalimat ringkas dalam bahasa Indonesia santai, sebutkan faktor utama yang mendorong keputusan>", "confidence": <0-100> }

Confidence guide:
- 90-100: semua TF + indikator + futures data sepakat, berita mendukung
- 75-89: mayoritas sinyal sepakat, ada 1-2 yang netral
- 60-74: ada konflik minor tapi arah cukup jelas
- <60: sinyal campur, lebih aman HOLD

Kalau ditanya pertanyaan umum (bukan analisis data), jawab santai dan natural pakai bahasa sehari-hari Indonesia. Jangan kaku, ngobrol aja seperti teman yang paham trading."""

def _trim_history():
    """Pertahankan hanya MAX_HISTORY_EXCHANGES exchange terakhir."""
    global conversation_history
    max_msgs = MAX_HISTORY_EXCHANGES * 2
    if len(conversation_history) > max_msgs:
        conversation_history = conversation_history[-max_msgs:]


def _build_tf_block(label: str, df: Optional[pd.DataFrame], n_rows: int = 5) -> str:
    """Bangun blok teks ringkas satu timeframe untuk dikirim ke AI."""
    if df is None or len(df) < 2:
        return f"\n[{label}] Data tidak tersedia"
    last = df.tail(n_rows).copy()
    for col in last.select_dtypes(include="float64").columns:
        last[col] = last[col].round(4)
    rows = []
    for ts, row in last.iterrows():
        rows.append(
            f"  {ts.strftime('%H:%M')} O={row['open']} H={row['high']} L={row['low']} "
            f"C={row['close']} V={row['volume']:.0f} | "
            f"SMA20={row.get('sma20',0):.2f} SMA50={row.get('sma50',0):.2f} "
            f"RSI={row.get('rsi14',0):.1f} MACD_hist={row.get('macd_hist',0):.4f} "
            f"ATR={row.get('atr14',0):.4f}"
        )
    last_row = df.iloc[-1]
    sma20 = last_row.get("sma20", 0) or 0
    sma50 = last_row.get("sma50", 0) or 0
    rsi   = last_row.get("rsi14", 50) or 50
    hist  = last_row.get("macd_hist", 0) or 0
    prev_hist = df.iloc[-2].get("macd_hist", 0) or 0
    summary = (
        f"  → Tren SMA: {'uptrend (SMA20>SMA50)' if sma20 > sma50 else 'downtrend (SMA20<SMA50)'} | "
        f"RSI={rsi:.1f} ({'oversold' if rsi < 30 else 'overbought' if rsi > 70 else 'netral'}) | "
        f"MACD hist: {'bullish cross ✅' if prev_hist <= 0 < hist else 'bearish cross 🔴' if prev_hist >= 0 > hist else ('positif' if hist > 0 else 'negatif')}"
    )
    return f"\n[{label}]\n" + "\n".join(rows) + "\n" + summary


def ask_ai(symbol: str, df_1m: pd.DataFrame,
           df_5m: Optional[pd.DataFrame] = None,
           df_15m: Optional[pd.DataFrame] = None,
           funding: Optional[dict] = None,
           oi_change: Optional[dict] = None) -> dict:
    """
    Kirim data multi-TF + futures data + berita ke Groq dengan conversation history.
    Return: { "decision": "BUY"|"SELL"|"HOLD", "reason": str, "confidence": int }
    """
    global conversation_history
    client = Groq(api_key=GROQ_API_KEY)

    # ── Blok multi-timeframe ────────────────────────────────────────────────
    tf_blocks = (
        _build_tf_block("1m — Primary Entry", df_1m, 5)
        + _build_tf_block("5m — Momentum Confirmation", df_5m, 3)
        + _build_tf_block("15m — Trend Direction", df_15m, 3)
    )

    # ── ATR saat ini (dari 1m) untuk info R:R ──────────────────────────────
    atr_now = float(df_1m.iloc[-1].get("atr14", 0) or 0)
    price_now = float(df_1m.iloc[-1]["close"])
    atr_pct = (atr_now / price_now * 100) if price_now else 0
    rr_block = (
        f"\nR:R Setup (ATR-based):\n"
        f"  ATR14(1m)  = {atr_now:.6f} ({atr_pct:.3f}% dari harga)\n"
        f"  SL target  = {price_now - SL_ATR_MULT * atr_now:.6f} (entry − {SL_ATR_MULT}×ATR)\n"
        f"  TP target  = {price_now + TP_ATR_MULT * atr_now:.6f} (entry + {TP_ATR_MULT}×ATR)\n"
        f"  R:R ratio  = 1:{int(TP_ATR_MULT / SL_ATR_MULT)}"
    )

    # ── Funding Rate + OI ───────────────────────────────────────────────────
    futures_block = ""
    if funding:
        futures_block += (
            f"\nFutures Data (Binance):\n"
            f"  Funding Rate : {funding['funding_rate_pct']:+.4f}% → {funding['sentiment']}\n"
            f"  Mark Price   : {funding['mark_price']}\n"
            f"  Index Price  : {funding['index_price']}"
        )
    if oi_change:
        futures_block += (
            f"\n  OI (5m hist) : {oi_change['oi_now']:,.2f} kontrak | "
            f"perubahan {oi_change['oi_change_pct']:+.3f}% → OI {oi_change['trend']}"
        )
    if not futures_block:
        futures_block = "\nFutures Data: tidak tersedia untuk pair ini (spot-only)"

    # ── Berita ──────────────────────────────────────────────────────────────
    news_items = get_relevant_news(symbol)
    news_block = ""
    if news_items:
        headlines = "\n".join(f"  - {n['title']} ({n['source']})" for n in news_items)
        news_block = f"\nBerita/sentimen pasar terkini:\n{headlines}"

    user_msg = (
        f"=== ANALISIS {symbol} [{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}] ===\n"
        f"\n— MULTI-TIMEFRAME OHLCV + INDIKATOR —{tf_blocks}"
        f"\n\n— RISK-REWARD SETUP —{rr_block}"
        f"\n\n— FUTURES DATA —{futures_block}"
        + (f"\n\n— BERITA —{news_block}" if news_block else "")
        + "\n\nBerikan analisis lengkap dan keputusan trading (JSON)."
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
                max_tokens=350,
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


# ---------------------------------------------------------------------------
# ─── 3b. VALIDATOR AI (OpenRouter – Claude Sonnet 5) ────────────────────────
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_VALIDATOR = """Kamu adalah validator sinyal trading kripto yang independen, kritis, dan sangat teliti. \
Kamu menerima data market lengkap (multi-timeframe, funding rate, open interest, berita) \
beserta sinyal dari AI pertama, lalu memverifikasi secara independen.

TUGASMU:
- Analisis data multi-timeframe (1m/5m/15m) secara objektif. Jangan ikut-ikutan sinyal AI pertama.
- Pertimbangkan funding rate: crowded position = risiko reversal.
- Pertimbangkan open interest trend: konfirmasi atau contradict sinyal harga?
- Apakah risk-reward (TP 4×ATR vs SL 1×ATR) masuk akal di kondisi saat ini?
- Kalau sinyal AI pertama masuk akal secara teknikal → setujui. Kalau ada red flag yang dilewatkan → koreksi.

PENTING: Lebih baik HOLD daripada setuju dengan sinyal yang meragukan. \
Bot ini mengeksekusi order NYATA di Binance — akurasi lebih penting dari kuantitas sinyal.

Balas HANYA dengan JSON valid, tanpa teks lain:
{ "decision": "BUY"|"SELL"|"HOLD", "reason": "<2-3 kalimat ringkas bahasa Indonesia, sebutkan apakah kamu setuju/tidak dan alasannya>", "confidence": <0-100> }"""

def ask_ai_openrouter(symbol: str, df_1m: pd.DataFrame, groq_signal: dict,
                       df_5m: Optional[pd.DataFrame] = None,
                       df_15m: Optional[pd.DataFrame] = None,
                       funding: Optional[dict] = None,
                       oi_change: Optional[dict] = None) -> dict:
    """
    Validator kedua menggunakan Claude Sonnet 5 via OpenRouter.
    Menerima data market multi-TF + futures data + sinyal Groq, lalu memverifikasi
    secara independen. Return: { decision, reason, confidence }
    """
    if not OPENROUTER_API_KEY:
        logger.warning("OPENROUTER_API_KEY belum diisi — validator dilewati")
        return groq_signal  # fallback: percaya Groq saja

    # ── Blok multi-timeframe ────────────────────────────────────────────────
    tf_blocks = (
        _build_tf_block("1m — Primary Entry", df_1m, 5)
        + _build_tf_block("5m — Momentum Confirmation", df_5m, 3)
        + _build_tf_block("15m — Trend Direction", df_15m, 3)
    )

    # ── ATR + R:R info ──────────────────────────────────────────────────────
    atr_now   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
    price_now = float(df_1m.iloc[-1]["close"])
    rr_block  = (
        f"\nR:R Setup (ATR-based):\n"
        f"  ATR14(1m) = {atr_now:.6f}\n"
        f"  SL target = {price_now - SL_ATR_MULT * atr_now:.6f} (entry − {SL_ATR_MULT}×ATR)\n"
        f"  TP target = {price_now + TP_ATR_MULT * atr_now:.6f} (entry + {TP_ATR_MULT}×ATR)\n"
        f"  R:R ratio = 1:{int(TP_ATR_MULT / SL_ATR_MULT)}"
    )

    # ── Futures data ────────────────────────────────────────────────────────
    futures_block = ""
    if funding:
        futures_block += (
            f"\nFutures Data:\n"
            f"  Funding Rate : {funding['funding_rate_pct']:+.4f}% → {funding['sentiment']}\n"
            f"  Mark Price   : {funding['mark_price']}"
        )
    if oi_change:
        futures_block += (
            f"\n  OI trend     : {oi_change['oi_change_pct']:+.3f}% ({oi_change['trend']})"
        )
    if not futures_block:
        futures_block = "\nFutures Data: tidak tersedia (spot-only pair)"

    # ── Berita ──────────────────────────────────────────────────────────────
    news_items = get_relevant_news(symbol)
    news_block = ""
    if news_items:
        headlines = "\n".join(f"  - {n['title']} ({n['source']})" for n in news_items)
        news_block = f"\nBerita:\n{headlines}"

    user_msg = (
        f"=== VALIDASI {symbol} [{datetime.now(timezone.utc).strftime('%H:%M UTC')}] ===\n"
        f"\n— MULTI-TIMEFRAME —{tf_blocks}"
        f"\n\n— RISK-REWARD —{rr_block}"
        f"\n\n— FUTURES DATA —{futures_block}"
        + (f"\n\n— BERITA —{news_block}" if news_block else "")
        + f"\n\n— SINYAL AI PERTAMA (Groq) —\n"
        f"  Keputusan : {groq_signal['decision']} ({groq_signal['confidence']}%)\n"
        f"  Alasan    : {groq_signal['reason']}\n\n"
        f"Verifikasi secara independen. Apakah kamu setuju? Berikan analisismu (JSON)."
    )

    raw = ""
    for attempt in range(3):
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://replit.com",
                    "X-Title": "Trading Bot Validator",
                },
                json={
                    "model": "anthropic/claude-sonnet-5",
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT_VALIDATOR},
                        {"role": "user",   "content": user_msg},
                    ],
                    "max_tokens": 250,
                    "temperature": 0.2,
                },
                timeout=30,
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json").strip()

            result = json.loads(raw)
            result["confidence"] = int(result.get("confidence", 0))
            result["decision"]   = result.get("decision", "HOLD").upper()
            logger.info(
                f"Claude validator → {symbol} {result['decision']} "
                f"({result['confidence']}%) | {result['reason']}"
            )
            return result

        except json.JSONDecodeError:
            logger.warning(f"OpenRouter response bukan JSON ({symbol}, attempt {attempt+1}): {raw}")
        except Exception as e:
            logger.error(f"OpenRouter error ({symbol}, attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)

    return {"decision": "HOLD", "reason": "Validator AI gagal", "confidence": 0}


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
                f"• Chat AI → `TELEGRAM_CHAT_TOPIC_ID`\n"
                f"• Laporan → `TELEGRAM_REPORT_TOPIC_ID`\n"
                f"• Berita → `TELEGRAM_NEWS_TOPIC_ID`"
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
            f"Chat AI    : `{TELEGRAM_CHAT_TOPIC_ID or 'belum diset'}`\n"
            f"Laporan    : `{TELEGRAM_REPORT_TOPIC_ID or 'belum diset'}`\n"
            f"Berita     : `{TELEGRAM_NEWS_TOPIC_ID or 'belum diset'}`"
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
            "`/laporan` — laporan profit/loss hari ini\n"
            "`/berita`  — headline crypto/market terbaru"
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

    if cmd in ("/berita", "/news"):
        items = get_relevant_news(max_items=6)
        if not items:
            send_telegram_message(
                "📰 Belum ada berita tersimpan, coba lagi sebentar\\.",
                topic_id=thread_id, chat_id=chat_id,
            )
            return
        lines = [f"• [{n['title']}]({n['link']}) \\- _{n['source']}_" for n in items]
        send_telegram_message(
            "📰 *Berita crypto/market terbaru:*\n\n" + "\n\n".join(lines)
            + (f"\n\nFeed real\\-time ada di topic `{TELEGRAM_NEWS_TOPIC_ID}`" if TELEGRAM_NEWS_TOPIC_ID else ""),
            topic_id=thread_id, chat_id=chat_id,
        )
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
                    atr: float = 0.0) -> Optional[dict]:
    """Pasang OCO sell dengan ATR-based dynamic TP/SL (R:R 1:4).
    TP = entry + TP_ATR_MULT × ATR  (default 4×ATR di atas entry)
    SL = entry − SL_ATR_MULT × ATR  (default 1×ATR di bawah entry)
    Kalau ATR = 0, fallback ke fixed pct (TP_PCT / SL_PCT) untuk keamanan."""
    from binance.client import Client
    f = get_symbol_filters(symbol)
    tick = f.get("tickSize", 0.00000001)
    step = f.get("stepSize", 0.00001)

    qty = _round_step(qty, step)
    if qty <= 0:
        logger.warning(f"⏭️ Lewati OCO {symbol}: qty setelah rounding jadi 0")
        return None

    if atr > 0:
        # ATR-based dynamic levels — R:R 1:4
        tp_price = _round_price(entry_price + TP_ATR_MULT * atr, tick)
        sl_stop  = _round_price(entry_price - SL_ATR_MULT * atr, tick)
        logger.info(
            f"🎯 OCO ATR-based {symbol}: ATR={atr:.6f} "
            f"TP=entry+{TP_ATR_MULT}×ATR={tp_price} SL=entry-{SL_ATR_MULT}×ATR={sl_stop} "
            f"R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}"
        )
    else:
        # Fallback ke fixed pct
        tp_price = _round_price(entry_price * (1 + TP_PCT / 100), tick)
        sl_stop  = _round_price(entry_price * (1 - SL_PCT / 100), tick)
        logger.warning(f"⚠️ OCO {symbol}: ATR=0, fallback ke fixed pct TP={TP_PCT}% SL={SL_PCT}%")

    sl_limit = _round_price(sl_stop * 0.999, tick)

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
            "qty":           qty,
            "entry_price":   entry_price,
            "tp_order_id":   oco.get("_tp_order_id"),
            "sl_order_id":   oco.get("_sl_order_id"),
            "tp_price":      oco.get("_tp_price"),
            "sl_price":      oco.get("_sl_price"),
            "order_list_id": oco.get("orderListId"),   # untuk cancel OCO sekaligus
            "opened_at":     datetime.now(timezone.utc).isoformat(),
            "reversal_exits_attempted": 0,             # guard agar tidak loop
        }


def cancel_oco_orders(symbol: str, pos: dict) -> bool:
    """Cancel OCO order list posisi terbuka. Return True kalau berhasil atau sudah tidak ada."""
    from binance.client import Client
    client = Client(BINANCE_API_KEY, BINANCE_API_SECRET)
    order_list_id = pos.get("order_list_id")

    if order_list_id:
        try:
            client.cancel_order_list(symbol=symbol, orderListId=order_list_id)
            logger.info(f"✅ OCO orderList {order_list_id} {symbol} dicancel")
            return True
        except Exception as e:
            err = str(e)
            if "Unknown order" in err or "Order list does not exist" in err or "-2011" in err:
                logger.info(f"OCO {symbol} sudah tidak aktif (sudah fill/cancel sebelumnya)")
                return True
            logger.warning(f"Gagal cancel OCO via orderListId {symbol}: {e}")

    # Fallback: cancel satu per satu
    for oid in filter(None, [pos.get("tp_order_id"), pos.get("sl_order_id")]):
        try:
            client.cancel_order(symbol=symbol, orderId=oid)
        except Exception as e:
            if "Unknown order" not in str(e) and "-2011" not in str(e):
                logger.warning(f"Gagal cancel order {oid} {symbol}: {e}")
    return True


def detect_reversal(df: pd.DataFrame) -> tuple[bool, str]:
    """
    Deteksi sinyal pembalikan arah (reversal) atau breakdown dari indikator teknikal.
    Tidak pakai AI — cepat dan tidak buang token.

    Logika: minimal 2 dari 4 sinyal berikut harus aktif sekaligus:
      1. MACD histogram flip dari positif ke negatif (momentum bearish muncul)
      2. RSI turun ke bawah 50 dari atas 50 (atau sudah < 45)
      3. Harga close di bawah SMA20
      4. Dua candle bearish berturut-turut dengan body masing-masing > 0.3%

    Return: (True, alasan) atau (False, "")
    """
    if df is None or len(df) < 5:
        return False, ""

    signals: list[str] = []
    last  = df.iloc[-1]
    prev  = df.iloc[-2]
    prev2 = df.iloc[-3]

    close = float(last["close"])

    # 1. MACD histogram flip negatif
    hist      = float(last.get("macd_hist", 0) or 0)
    prev_hist = float(prev.get("macd_hist", 0) or 0)
    prev2_hist = float(prev2.get("macd_hist", 0) or 0)
    if prev_hist > 0 and hist < 0:
        signals.append("MACD hist cross negatif")
    elif hist < 0 and prev2_hist > 0:
        signals.append("MACD hist negatif 2 candle")

    # 2. RSI cross bawah 50 atau sudah sangat lemah
    rsi      = float(last.get("rsi14", 50) or 50)
    prev_rsi = float(prev.get("rsi14", 50) or 50)
    if prev_rsi >= 50 and rsi < 50:
        signals.append(f"RSI cross bawah 50 ({rsi:.1f})")
    elif rsi < 45:
        signals.append(f"RSI lemah ({rsi:.1f})")

    # 3. Close di bawah SMA20
    sma20 = float(last.get("sma20", 0) or 0)
    if sma20 > 0 and close < sma20:
        signals.append(f"Close {close:.6f} < SMA20 {sma20:.6f}")

    # 4. Dua candle bearish berturut-turut, body > 0.3%
    o1 = float(last.get("open", close) or close)
    o2 = float(prev.get("open", 0) or 0)
    c2 = float(prev.get("close", 0) or 0)
    body1 = (o1 - close) / o1 if o1 > 0 else 0
    body2 = (o2 - c2) / o2 if o2 > 0 else 0
    if close < o1 and c2 < o2 and body1 > 0.003 and body2 > 0.003:
        signals.append("2 candle bearish berturut-turut")

    if len(signals) >= 2:
        return True, " | ".join(signals)
    return False, ""


def emergency_close_position(symbol: str, pos: dict, reason: str) -> None:
    """
    Tutup posisi BUY lebih awal karena sinyal reversal:
      1. Cancel OCO (TP+SL) yang masih aktif
      2. Market sell seluruh qty
      3. Log + kirim notif Telegram
    """
    qty         = pos.get("qty", 0.0)
    entry_price = pos.get("entry_price", 0.0)

    if qty <= 0:
        logger.warning(f"⚠️ emergency_close {symbol}: qty=0, dilewati")
        return

    logger.info(f"🚨 Early exit {symbol} — {reason}")

    send_telegram_message(
        f"🚨 *Early Exit — `{symbol}`*\n\n"
        f"Sinyal reversal terdeteksi sebelum SL kena\\!\n\n"
        f"📊 _{reason}_\n\n"
        f"🔄 Membatalkan OCO & menutup posisi\\.\\.\\.",
        topic_id=TELEGRAM_REPORT_TOPIC_ID,
    )

    # Step 1: cancel OCO
    cancel_oco_orders(symbol, pos)
    time.sleep(0.5)

    # Step 2: market sell
    f_info   = get_symbol_filters(symbol)
    sell_qty = _round_step(qty, f_info.get("stepSize", 0.00001))
    if sell_qty <= 0:
        logger.error(f"❌ emergency_close {symbol}: sell_qty=0 setelah rounding")
        return

    exit_price = entry_price
    fill_info: dict = {}
    try:
        fill_info = execute_binance(symbol, "SELL", sell_qty)
        fills = fill_info.get("fills", [])
        if fills:
            total_quote = sum(float(f["price"]) * float(f["qty"]) for f in fills)
            total_qty   = sum(float(f["qty"]) for f in fills)
            exit_price  = total_quote / total_qty if total_qty else entry_price
        else:
            exit_price = float(fill_info.get("price", entry_price) or entry_price)
    except Exception as e:
        logger.error(f"❌ Market sell gagal (emergency_close {symbol}): {e}")
        send_telegram_message(
            f"⛔ *Emergency sell GAGAL — `{symbol}`*\n\n"
            f"Error: `{e}`\n"
            f"⚠️ Pantau posisi secara manual\\!",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )
        return

    # Step 3: log + notif
    pnl     = (exit_price - entry_price) * sell_qty
    pnl_pct = ((exit_price / entry_price) - 1) * 100 if entry_price else 0.0

    log_trade(symbol, "SELL", sell_qty, exit_price, 0,
              f"Early exit reversal: {reason}",
              "EARLY_EXIT", str(fill_info.get("orderId", "")),
              extra={"pnl": round(pnl, 4), "pnl_pct": round(pnl_pct, 3)})

    icon = "🟡" if pnl >= 0 else "🟠"
    send_telegram_message(
        f"{icon} *Posisi `{symbol}` ditutup lebih awal*\n\n"
        f"Entry  : `{entry_price}`\n"
        f"Exit   : `{exit_price:.8f}`\n"
        f"PnL    : `{pnl:+.4f} USDT` \\(`{pnl_pct:+.2f}%`\\)\n\n"
        f"💡 _Keluar sebelum SL/MC kena — reversal terdeteksi_",
        topic_id=TELEGRAM_REPORT_TOPIC_ID,
    )

    with positions_lock:
        open_positions.pop(symbol, None)


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
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )

        with positions_lock:
            open_positions.pop(symbol, None)
        return


def position_monitor_loop() -> None:
    """Cek berkala apakah ada posisi yang ditutup lewat TP/SL, dan:
    - Deteksi sinyal reversal → early exit sebelum SL kena
    - Kirim laporan profit/loss harian otomatis (DAILY_REPORT_HOUR_UTC)."""
    global daily_report_sent_date
    while True:
        try:
            with positions_lock:
                snapshot = dict(open_positions)

            for symbol, pos in snapshot.items():
                # ── 1. Cek apakah OCO (TP/SL) sudah FILLED ──────────────────
                _check_position_close(symbol, pos)

                # Kalau posisi sudah tutup oleh TP/SL di atas, skip reversal
                with positions_lock:
                    if symbol not in open_positions:
                        continue

                # ── 2. Guard: jangan coba early exit lebih dari 1 kali ──────
                if pos.get("reversal_exits_attempted", 0) >= 1:
                    continue

                # ── 3. Ambil candle segar & cek reversal ────────────────────
                if not (LIVE_MODE and BINANCE_API_KEY):
                    continue  # reversal exit hanya di mode LIVE

                try:
                    df_fresh = fetch_market(symbol, "1m", 30)
                    if df_fresh is None or len(df_fresh) < 10:
                        continue
                    df_fresh = compute_indicators(df_fresh)

                    is_rev, rev_reason = detect_reversal(df_fresh)
                    if is_rev:
                        # Tandai dulu agar thread lain tidak ikut masuk
                        with positions_lock:
                            if symbol in open_positions:
                                open_positions[symbol]["reversal_exits_attempted"] = 1
                            else:
                                continue  # sudah ditutup thread lain

                        logger.warning(
                            f"🔄 Reversal terdeteksi pada posisi terbuka {symbol}: {rev_reason}"
                        )
                        emergency_close_position(symbol, pos, rev_reason)

                except Exception as e:
                    logger.warning(f"Reversal check error {symbol}: {e}")

            # ── 4. Laporan harian ────────────────────────────────────────────
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


def send_daily_report(date_str: str, chat_id: Optional[int] = None,
                       topic_id: Optional[int] = TELEGRAM_REPORT_TOPIC_ID) -> None:
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

def process_signal(symbol: str, signal: dict, current_price: float, atr: float,
                   df_1m: pd.DataFrame,
                   df_5m: Optional[pd.DataFrame] = None,
                   df_15m: Optional[pd.DataFrame] = None,
                   funding: Optional[dict] = None,
                   oi_change: Optional[dict] = None) -> None:
    """
    Auto-trading dengan dual-AI consensus (Groq + Claude Sonnet 5 via OpenRouter).
    Menggunakan ATR-based dynamic TP/SL (R:R 1:4) dan data multi-TF + Futures.

    Alur:
    1. Groq sudah analisis (parameter signal)
    2. Claude Sonnet 5 via OpenRouter memverifikasi secara independen
    3. Kalau keduanya sepakat arah (BUY/SELL) → eksekusi OTOMATIS tanpa tombol
    4. Kalau beda pendapat → skip, kirim info ke Telegram
    5. Setelah eksekusi → pasang OCO ATR-based TP/SL, kirim notifikasi
    """
    decision   = signal["decision"]
    confidence = signal["confidence"]
    reason     = signal["reason"]

    # ATR untuk sizing + OCO levels
    atr_sl = atr * SL_ATR_MULT  # jarak Stop Loss dari entry
    atr_tp = atr * TP_ATR_MULT  # jarak Take Profit dari entry

    raw_equity    = get_binance_equity() if LIVE_MODE and BINANCE_API_KEY else 10_000.0
    equity        = raw_equity * CAPITAL_ALLOCATION_PCT   # hanya pakai sebagian saldo
    qty           = calc_quantity(current_price, atr_sl if atr_sl > 0 else atr, equity, symbol=symbol)

    if LIVE_MODE and not qty_is_tradable(symbol, qty, current_price):
        f = get_symbol_filters(symbol)
        logger.warning(f"⏭️ Lewati sinyal {symbol}: saldo kekecilan")
        log_trade(symbol, decision, qty, current_price, confidence, reason, "SKIPPED_TOO_SMALL")
        send_telegram_message(
            f"⏭️ *Sinyal {symbol} dilewati*\n\n"
            f"Groq bilang {decision} \\({confidence}%\\) tapi saldo USDT kekecilan "
            f"\\(butuh min notional ~{f['minNotional']}\\)\\.",
            topic_id=_signal_topic(decision),
        )
        return

    # Hitung TP/SL levels untuk preview di Telegram
    sl_preview = round(current_price - atr_sl, 8) if atr > 0 else round(current_price * (1 - SL_PCT / 100), 8)
    tp_preview = round(current_price + atr_tp, 8) if atr > 0 else round(current_price * (1 + TP_PCT / 100), 8)
    atr_pct    = (atr / current_price * 100) if current_price else 0

    # ── Step 2: Validator Claude Sonnet 5 via OpenRouter ────────────────────
    send_telegram_message(
        f"🔍 *Menganalisis {symbol}…*\n\n"
        f"Groq: *{decision}* \\({confidence}%\\)\n"
        f"💬 _{reason}_\n\n"
        f"📐 ATR={atr:.6f} \\({atr_pct:.3f}%\\) → SL=`{sl_preview}` TP=`{tp_preview}`\n"
        f"📊 Multi\\-TF: 1m\\+5m\\+15m dianalisis\n\n"
        f"⏳ Menunggu validasi Claude Sonnet 5…",
        topic_id=_signal_topic(decision),
    )

    claude_signal = ask_ai_openrouter(
        symbol, df_1m, signal,
        df_5m=df_5m, df_15m=df_15m,
        funding=funding, oi_change=oi_change,
    )
    claude_decision   = claude_signal["decision"]
    claude_confidence = claude_signal["confidence"]
    claude_reason     = claude_signal["reason"]

    # ── Step 3: Cek consensus ────────────────────────────────────────────────
    both_agree = (decision == claude_decision and decision != "HOLD")
    avg_confidence = (confidence + claude_confidence) // 2

    if not both_agree:
        log_trade(symbol, decision, 0, current_price, confidence, reason, "CONSENSUS_FAIL")
        send_telegram_message(
            f"🤔 *Dua AI beda pendapat — {symbol} dilewati*\n\n"
            f"Groq   : *{decision}* \\({confidence}%\\) — _{reason}_\n"
            f"Claude : *{claude_decision}* \\({claude_confidence}%\\) — _{claude_reason}_\n\n"
            f"⏸ _Tidak ada order — tunggu sinyal lebih jelas_",
            topic_id=_signal_topic(decision),
        )
        return

    # ── Step 4: Keduanya sepakat → eksekusi otomatis ─────────────────────────
    if not LIVE_MODE:
        logger.info(f"[SIM] CONSENSUS {decision} {qty} {symbol} @ ~{current_price}")
        log_trade(symbol, decision, qty, current_price, avg_confidence, reason, "SIMULATED")
        send_telegram_message(
            f"🔵 *\\[SIMULASI\\] Konsensus 2 AI\\!*\n\n"
            f"Koin    : `{symbol}`\n"
            f"Aksi    : *{'Beli' if decision=='BUY' else 'Jual'}*\n"
            f"Volume  : `{qty}`\n"
            f"Harga   : `~{current_price}`\n"
            f"Groq    : `{confidence}%` — _{reason}_\n"
            f"Claude  : `{claude_confidence}%` — _{claude_reason}_\n\n"
            f"🎯 *R:R 1:{int(TP_ATR_MULT/SL_ATR_MULT)} \\(ATR\\-based\\)*\n"
            f"TP preview : `{tp_preview}`\n"
            f"SL preview : `{sl_preview}`",
            topic_id=_signal_topic(decision),
        )
        return

    if not check_daily_loss(raw_equity):
        return

    # Kirim notif "sedang eksekusi" sebelum order masuk
    send_telegram_message(
        f"⚡ *Eksekusi otomatis {symbol}\\!*\n\n"
        f"Groq + Claude sepakat → *{'BELI' if decision=='BUY' else 'JUAL'}*\n"
        f"Keyakinan rata\\-rata: `{avg_confidence}%`\n\n"
        f"🔄 _Mengirim order ke Binance…_",
        topic_id=_signal_topic(decision),
    )

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

    log_trade(symbol, decision, qty, fill_price, avg_confidence,
              f"[Groq] {reason} | [Claude] {claude_reason}", status_str, order_id)

    icon = "✅" if not errors else "⚠️"
    send_telegram_message(
        f"{icon} *Order masuk ke Binance\\!*\n\n"
        f"Koin    : `{symbol}`\n"
        f"Aksi    : *{'Beli' if decision=='BUY' else 'Jual'}*\n"
        f"Volume  : `{qty}`\n"
        f"Harga   : `{fill_price}`\n"
        f"ID Order: `{order_id}`\n"
        f"Groq    : `{confidence}%` — _{reason}_\n"
        f"Claude  : `{claude_confidence}%` — _{claude_reason}_\n"
        f"Status  : {'Eksekusi otomatis ✅' if not errors else '⚠️ ' + '; '.join(errors)}",
        topic_id=_signal_topic(decision),
    )

    # Pasang OCO ATR-based TP/SL otomatis setelah BUY tereksekusi
    if not errors and decision == "BUY" and filled_qty > 0:
        oco = place_oco_sell(symbol, filled_qty, fill_price, atr=atr)
        if oco:
            tp_price = oco.get("_tp_price", fill_price + atr_tp)
            sl_price = oco.get("_sl_price", fill_price - atr_sl)
            tp_pct_actual = ((tp_price / fill_price) - 1) * 100
            sl_pct_actual = (1 - (sl_price / fill_price)) * 100
            register_open_position(symbol, filled_qty, fill_price, oco)
            log_trade(symbol, "OCO_TP_SL", filled_qty, fill_price, avg_confidence,
                      f"ATR={atr:.6f} TP={tp_price} SL={sl_price} R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}",
                      "PLACED", str(oco.get("orderListId", "")))
            send_telegram_message(
                f"🎯 *TP/SL ATR\\-based terpasang* `{symbol}`\n\n"
                f"ATR14      : `{atr:.6f}`\n"
                f"Take Profit: `{tp_price}` \\(\\+{tp_pct_actual:.2f}% = {TP_ATR_MULT}×ATR\\)\n"
                f"Stop Loss  : `{sl_price}` \\(\\-{sl_pct_actual:.2f}% = {SL_ATR_MULT}×ATR\\)\n"
                f"R:R ratio  : `1:{int(TP_ATR_MULT/SL_ATR_MULT)}`",
                topic_id=_signal_topic(decision),
            )
        else:
            send_telegram_message(
                f"⚠️ *TP/SL gagal dipasang* untuk `{symbol}`\\. "
                f"Posisi terbuka — pantau manual\\.",
                topic_id=_signal_topic(decision),
            )

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
        f"Chat AI    : `{TELEGRAM_CHAT_TOPIC_ID or 'general'}`\n"
        f"Laporan    : `{TELEGRAM_REPORT_TOPIC_ID or 'general'}`\n"
        f"Berita     : `{TELEGRAM_NEWS_TOPIC_ID or 'general'}`"
    )
    send_telegram_message(
        f"👋 *Bot trading udah nyala nih\\!*\n\n"
        f"Broker  : Binance Spot\n"
        f"Mode    : {'🔴 LIVE \\(uang beneran\\)' if LIVE_MODE else '🔵 Simulasi'}\n"
        f"Pair    : memindai `{n_pairs}` pair USDT setiap `{CANDLE_INTERVAL}`\n"
        f"AI      : Groq Llama 3\\.1 \\+ Claude Sonnet 5 \\(validator\\)\n"
        f"Filter  : Multi\\-TF 1m\\+5m\\+15m \\+ Funding Rate \\+ Open Interest\n"
        f"TP/SL   : ATR\\-based dynamic \\(R:R 1:{int(TP_ATR_MULT/SL_ATR_MULT)}\\)\n"
        f"Modal   : `{int(CAPITAL_ALLOCATION_PCT*100)}%` dari saldo \\(sisanya tidak disentuh\\)\n"
        f"Min keyakinan: `{CONFIDENCE_THRESHOLD}%`"
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

                    # ── Primary timeframe (1m) — pre-filter ─────────────────
                    df_1m = fetch_market(symbol, "1m", MTF_LIMIT)
                    if df_1m is None or len(df_1m) < 30:
                        continue

                    df_1m = compute_indicators(df_1m)
                    if not is_interesting(df_1m):
                        continue

                    # Filter sideways: skip pair yang pasar lagi ranging/stagnan
                    if not is_trending(df_1m):
                        continue

                    if ai_calls_this_cycle >= MAX_AI_CALLS_PER_CYCLE:
                        continue

                    # ── Multi-timeframe (5m + 15m) setelah lolos pre-filter ─
                    df_5m  = fetch_market(symbol, "5m",  MTF_LIMIT)
                    df_15m = fetch_market(symbol, "15m", MTF_LIMIT)
                    if df_5m  is not None and len(df_5m)  >= 30:
                        df_5m  = compute_indicators(df_5m)
                    else:
                        df_5m = None
                    if df_15m is not None and len(df_15m) >= 30:
                        df_15m = compute_indicators(df_15m)
                    else:
                        df_15m = None

                    # ── Futures data (funding rate + OI) ────────────────────
                    funding   = fetch_funding_rate(symbol)
                    oi_change = fetch_oi_change(symbol)

                    if funding:
                        logger.debug(
                            f"Futures {symbol}: FR={funding['funding_rate_pct']:+.4f}% "
                            f"({funding['sentiment']})"
                        )
                    if oi_change:
                        logger.debug(
                            f"OI {symbol}: {oi_change['oi_change_pct']:+.3f}% "
                            f"({oi_change['trend']})"
                        )

                    last = df_1m.iloc[-1]
                    current_price = float(last["close"])
                    atr = float(last["atr14"]) if not pd.isna(last["atr14"]) else 0.0

                    signal = ask_ai(
                        symbol, df_1m,
                        df_5m=df_5m, df_15m=df_15m,
                        funding=funding, oi_change=oi_change,
                    )
                    ai_calls_this_cycle += 1
                    decision   = signal["decision"]
                    confidence = signal["confidence"]
                    reason     = signal["reason"]

                    # Ringkasan futures untuk log
                    fr_str = f" FR={funding['funding_rate_pct']:+.4f}%" if funding else ""
                    oi_str = f" OI={oi_change['trend']}" if oi_change else ""
                    logger.info(
                        f"AI → {symbol} {decision} ({confidence}%){fr_str}{oi_str} | {reason}"
                    )

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
                        args=(symbol, signal, current_price, atr, df_1m),
                        kwargs=dict(
                            df_5m=df_5m, df_15m=df_15m,
                            funding=funding, oi_change=oi_change,
                        ),
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

    # Ambil berita crypto/market pertama kali sebelum mulai, lalu refresh berkala
    threading.Thread(target=news_refresher_loop, daemon=True).start()

    # Main trading loop
    main_loop()
