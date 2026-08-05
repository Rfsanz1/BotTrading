"""
AI Trading Bot – Binance (semua pair USDT) + Multi-AI (via 9Router) + Telegram
===============================================================================
Mode saat ini: LIVE (LIVE_MODE = True)
Data pasar    : Binance public API — memindai SEMUA pair spot USDT
Pre-filter    : indikator teknikal (RSI/MACD) memilih pair yang "menarik"
                sebelum dikirim ke AI, supaya tidak membanjiri rate-limit AI
AI Analyst    : Multi-AI via 9Router (Gemini/Claude/GPT-4o, conversational)
Notifikasi    : Telegram (konfirmasi inline ✅ / ❌, group topics support)
Eksekusi      : Binance Spot market order
"""

import os
import re
import json
import time
import queue
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

import hashlib
import hmac
import math
import shutil
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import pandas as pd
import psutil
import requests
from flask import Flask, request as flask_request

# ---------------------------------------------------------------------------
# ─── CONFIG FILE LOADER (config.json prioritas di atas env vars) ─────────────
# ---------------------------------------------------------------------------

_BOT_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

def _load_bot_config() -> dict:
    """Baca config.json — dipakai agar user tidak perlu isi Replit Secrets manual."""
    try:
        with open(_BOT_CONFIG_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_bot_config(data: dict) -> None:
    """Simpan config ke config.json."""
    with open(_BOT_CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)

_BOT_CONFIG: dict = _load_bot_config()

def _cfg(key: str, default: str = "") -> str:
    """Ambil nilai config: config.json dulu, lalu env var, lalu default."""
    v = str(_BOT_CONFIG.get(key, "")).strip()
    return v if v else os.getenv(key, default)

# ---------------------------------------------------------------------------
# ─── KONFIGURASI ────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

LIVE_MODE: bool = _cfg("LIVE_MODE", "false").lower() in ("1", "true", "yes")

# Kosongkan / set "ALL" di TRADING_PAIRS env var untuk memindai SEMUA pair
# spot USDT yang ada di Binance. Atau isi daftar spesifik, contoh:
# TRADING_PAIRS=BTCUSDT,ETHUSDT,SOLUSDT
# Mode testnet Binance — pakai API key dari testnet.binance.vision (uang virtual)
# Set BINANCE_TESTNET=true di config.json atau Replit Secrets untuk aktifkan
BINANCE_TESTNET: bool = _cfg("BINANCE_TESTNET", "true").lower() in ("1", "true", "yes")

TRADING_PAIRS_ENV: str = _cfg("TRADING_PAIRS", "ALL").strip()
# Pair yang selalu dipindai PERTAMA setiap siklus (pisah koma), misal: XAUTUSDT,BTCUSDT
PRIORITY_PAIRS: list[str] = [
    p.strip().upper()
    for p in _cfg("PRIORITY_PAIRS", "").split(",")
    if p.strip()
]

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

# Berapa pair maksimum yang boleh AI analisis per siklus — pre-filter
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
NEWS_FEEDS_FOREX: list[str] = [
    "https://www.forexlive.com/feed/news",
    "https://www.dailyfx.com/feeds/all",
]
NEWS_FEEDS_SAHAM: list[str] = [
    "https://feeds.reuters.com/reuters/businessNews",
    "https://finance.yahoo.com/news/rssindex",
]
NEWS_REFRESH_SEC: int = int(os.getenv("NEWS_REFRESH_SEC", "900"))  # 15 menit

# ─── EMAIL NOTIFICATIONS ──────────────────────────────────────────────────────
EMAIL_ENABLED: bool       = _cfg("EMAIL_ENABLED", "false").lower() in ("1", "true", "yes")
EMAIL_SMTP_HOST: str      = _cfg("EMAIL_SMTP_HOST", "smtp.gmail.com")
EMAIL_SMTP_PORT: int      = int(_cfg("EMAIL_SMTP_PORT", "587"))
EMAIL_FROM: str           = _cfg("EMAIL_FROM", "")
EMAIL_TO: str             = _cfg("EMAIL_TO", "")
EMAIL_PASSWORD: str       = _cfg("EMAIL_PASSWORD", "")
EMAIL_SUBJECT_PREFIX: str = _cfg("EMAIL_SUBJECT_PREFIX", "[TradingBot]")

# ─── DCA AUTOMATION ──────────────────────────────────────────────────────────
DCA_ENABLED: bool              = _cfg("DCA_ENABLED", "false").lower() in ("1", "true", "yes")
DCA_DEFAULT_AMOUNT_USDT: float = float(_cfg("DCA_DEFAULT_AMOUNT_USDT", "10"))
DCA_DEFAULT_INTERVAL_HOURS: int = int(_cfg("DCA_DEFAULT_INTERVAL_HOURS", "24"))

# ─── VACATION MODE / SCHEDULED TRADING HOURS ─────────────────────────────────
VACATION_MODE_INIT: bool = _cfg("VACATION_MODE", "false").lower() in ("1", "true", "yes")
TRADING_START_HOUR_UTC: int = int(_cfg("TRADING_START_HOUR_UTC", "0"))
TRADING_END_HOUR_UTC: int   = int(_cfg("TRADING_END_HOUR_UTC", "24"))

# ─── DATABASE BACKUP ─────────────────────────────────────────────────────────
DB_BACKUP_ENABLED: bool         = _cfg("DB_BACKUP_ENABLED", "false").lower() in ("1", "true", "yes")
DB_BACKUP_INTERVAL_HOURS: int   = int(_cfg("DB_BACKUP_INTERVAL_HOURS", "6"))
DB_BACKUP_DIR: str              = "backups"

# Dashboard security ─────────────────────────────────────────────────────────
# Mutating API endpoints (pause/resume/DCA/backup/etc.) require this key in
# the X-Dashboard-Key header.  If left empty, all writes are blocked.
DASHBOARD_API_KEY: str = _cfg("DASHBOARD_API_KEY", "")

# CORS: only these origin prefixes may call the API.
# Accepts a comma-separated list, e.g. "https://myapp.replit.dev,http://localhost:5173"
# Defaults to the Replit dev-domain pattern so the dashboard works out of the box.
_CORS_ALLOWED_ORIGINS_RAW: str = _cfg(
    "CORS_ALLOWED_ORIGINS",
    f"https://{os.getenv('REPLIT_DEV_DOMAIN', '')},http://localhost:5173,http://127.0.0.1:5173"
)
_CORS_ALLOWED_ORIGINS: list = [
    o.strip().rstrip("/") for o in _CORS_ALLOWED_ORIGINS_RAW.split(",") if o.strip()
]

# AI history – berapa exchange terakhir yang diingat (1 exchange = 1 user + 1 assistant)
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

# ── Trailing Stop Loss ───────────────────────────────────────────────────────
# Aktifkan trailing SL (geser SL naik seiring harga naik untuk kunci profit)
TRAILING_SL_ENABLED: bool = os.getenv("TRAILING_SL_ENABLED", "true").lower() in ("1","true","yes")
# Harga harus naik berapa % dari entry sebelum trailing mulai aktif
TRAILING_SL_ACTIVATE_PCT: float = float(os.getenv("TRAILING_SL_ACTIVATE_PCT", "1.0"))
# Trailing SL dipasang berapa % DI BAWAH harga tertinggi yang dicapai
TRAILING_SL_TRAIL_PCT: float = float(os.getenv("TRAILING_SL_TRAIL_PCT", "0.6"))

# ── Concurrent position limit ────────────────────────────────────────────────
# Maksimum posisi terbuka sekaligus — mencegah overexposure saat banyak sinyal
MAX_CONCURRENT_POSITIONS: int = int(os.getenv("MAX_CONCURRENT_POSITIONS", "4"))
# Maksimum posisi per "grup aset" (BTC-family, ETH-family, dll)
MAX_POSITIONS_PER_GROUP: int = int(os.getenv("MAX_POSITIONS_PER_GROUP", "2"))

# ── State persistence ────────────────────────────────────────────────────────
# Path relatif terhadap working directory (trading-bot/) saat bot dijalankan
STATE_FILE: str = os.getenv("STATE_FILE", "bot_state.json")

# ── Binance API weight guard ─────────────────────────────────────────────────
# Kalau used-weight sudah > threshold ini, tambah delay antar request
BINANCE_WEIGHT_WARN: int = int(os.getenv("BINANCE_WEIGHT_WARN", "800"))
BINANCE_WEIGHT_PAUSE: int = int(os.getenv("BINANCE_WEIGHT_PAUSE", "1100"))

# ── Hard Stop Daily Loss ──────────────────────────────────────────────────────
# Bot otomatis di-PAUSE kalau equity turun > X% dari awal hari (threshold awal).
# Berbeda dari DAILY_LOSS_LIMIT_PCT (5%, matikan LIVE_MODE) — ini threshold
# pertama (default 3%) yang masih bisa di-resume manual via /resume.
HARD_STOP_LOSS_PCT: float = float(os.getenv("HARD_STOP_LOSS_PCT", "3.0"))

# ── Breakeven Stop Loss ───────────────────────────────────────────────────────
# Saat profit ≥ X%, otomatis pindahkan SL ke harga entry — tidak mungkin rugi.
BREAKEVEN_ENABLED: bool = os.getenv("BREAKEVEN_ENABLED", "true").lower() in ("1","true","yes")
BREAKEVEN_ACTIVATE_PCT: float = float(os.getenv("BREAKEVEN_ACTIVATE_PCT", "0.5"))

# ── Partial Take Profit ───────────────────────────────────────────────────────
# Saat profit mencapai 50% dari jarak ke TP, tutup 50% posisi untuk kunci profit.
# Sisa 50% biarkan jalan dengan trailing SL ke TP penuh.
PARTIAL_TP_ENABLED: bool = os.getenv("PARTIAL_TP_ENABLED", "true").lower() in ("1","true","yes")
PARTIAL_TP_RATIO: float = float(os.getenv("PARTIAL_TP_RATIO", "0.5"))         # tutup 50% posisi
PARTIAL_TP_TRIGGER_RATIO: float = float(os.getenv("PARTIAL_TP_TRIGGER_RATIO", "0.5"))  # trigger di 50% jarak ke TP

# ── Dynamic Position Sizing (Kelly Criterion lite) ───────────────────────────
# Kurangi ukuran posisi saat win rate rendah, naikkan saat sedang hot.
KELLY_SIZING_ENABLED: bool = os.getenv("KELLY_SIZING_ENABLED", "true").lower() in ("1","true","yes")
KELLY_LOOKBACK: int = int(os.getenv("KELLY_LOOKBACK", "20"))  # lihat N trade terakhir

# ── Health Monitor ────────────────────────────────────────────────────────────
# Alert ke Telegram kalau bot diam > X jam atau equity drop > Y%
HEALTH_NO_SIGNAL_HOURS: float = float(os.getenv("HEALTH_NO_SIGNAL_HOURS", "2.0"))
HEALTH_EQUITY_DROP_PCT: float = float(os.getenv("HEALTH_EQUITY_DROP_PCT", "5.0"))

# ── SQLite database ───────────────────────────────────────────────────────────
# Path relatif terhadap working directory (trading-bot/) saat bot dijalankan
DB_FILE: str = os.getenv("DB_FILE", "trades.db")

# ---------------------------------------------------------------------------
# ─── ENVIRONMENT VARIABLES (dibaca dari config.json atau env var) ────────────
# ---------------------------------------------------------------------------

# ─── 9Router AI Gateway ───────────────────────────────────────────────────────
# Semua traffic AI dirouting lewat 9Router (OpenAI-compatible proxy).
# Set AI_BASE_URL ke URL 9Router kamu, contoh: https://9router.domain.com/v1
AI_BASE_URL:         str = _cfg("AI_BASE_URL",        "http://localhost:20128/v1").rstrip("/")
AI_API_KEY:          str = _cfg("AI_API_KEY",         "")
AI_MODEL:            str = _cfg("AI_MODEL",            "google/gemini-2.5-pro")
AI_VALIDATOR_MODEL:  str = _cfg("AI_VALIDATOR_MODEL",  "anthropic/claude-sonnet-5")
AI_VALIDATOR_MODEL2: str = _cfg("AI_VALIDATOR_MODEL2", "openai/gpt-4o")
AI_VALIDATOR_MODEL3: str = _cfg("AI_VALIDATOR_MODEL3", "google/gemini-1.5-flash")
AI_CODING_MODEL:     str = _cfg("AI_CODING_MODEL",     "anthropic/claude-opus-4-5")
AI_TIMEOUT_MS:       int = int(_cfg("AI_TIMEOUT_MS",   "30000"))

# Legacy keys — disimpan agar config.json lama tidak error, tapi tidak dipakai
GROQ_API_KEY        = _cfg("GROQ_API_KEY",       "")  # deprecated → pakai 9Router
OPENROUTER_API_KEY  = _cfg("OPENROUTER_API_KEY", "")  # deprecated
ANTHROPIC_API_KEY   = _cfg("ANTHROPIC_API_KEY",  "")  # deprecated
OPENAI_API_KEY      = _cfg("OPENAI_API_KEY",     "")  # deprecated
GEMINI_API_KEY      = _cfg("GEMINI_API_KEY",     "")  # deprecated

TELEGRAM_BOT_TOKEN  = _cfg("TELEGRAM_BOT_TOKEN")

_raw_chat_id = _cfg("TELEGRAM_CHAT_ID", "0")
try:
    TELEGRAM_CHAT_ID = int(_raw_chat_id)
except ValueError:
    # Bukan angka (misalnya masih placeholder) — set ke 0 supaya
    # startup check di __main__ bisa deteksi dan serve /config page
    print(
        f"\n⚠️  TELEGRAM_CHAT_ID '{_raw_chat_id}' bukan angka — bot akan serve /config untuk pengisian.\n"
        f"   Cara dapat Chat ID: cari @userinfobot di Telegram → klik Start.\n"
    )
    TELEGRAM_CHAT_ID = 0

ALLOWED_CHAT_IDS = [
    int(x.strip())
    for x in _cfg("ALLOWED_CHAT_IDS", "").split(",")
    if x.strip()
]

# Topic IDs untuk Telegram group forum
def _parse_topic(env_key: str) -> Optional[int]:
    v = _cfg(env_key, "").strip()
    return int(v) if v.isdigit() else None

TELEGRAM_BUY_TOPIC_ID:      Optional[int] = _parse_topic("TELEGRAM_BUY_TOPIC_ID")
TELEGRAM_SELL_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_SELL_TOPIC_ID")
TELEGRAM_BULL_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_BULL_TOPIC_ID")
TELEGRAM_BEAR_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_BEAR_TOPIC_ID")
TELEGRAM_CHAT_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_CHAT_TOPIC_ID")
TELEGRAM_REPORT_TOPIC_ID:   Optional[int] = _parse_topic("TELEGRAM_REPORT_TOPIC_ID")
TELEGRAM_NEWS_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_NEWS_TOPIC_ID")
TELEGRAM_HOLD_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_HOLD_TOPIC_ID")
# Topik tambahan — isi di config.json setelah buat topik di grup Telegram kamu
TELEGRAM_ALERTS_TOPIC_ID:       Optional[int] = _parse_topic("TELEGRAM_ALERTS_TOPIC_ID")       # Alert Market (health, error)
TELEGRAM_ANALYSIS_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_ANALYSIS_TOPIC_ID")     # Analisis AI per pair
TELEGRAM_CODING_TOPIC_ID:       Optional[int] = _parse_topic("TELEGRAM_CODING_TOPIC_ID")       # log AI coding updates
TELEGRAM_HOT_COIN_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_HOT_COIN_TOPIC_ID")     # Hot Coin watchlist
TELEGRAM_FOREX_NEWS_TOPIC_ID:   Optional[int] = _parse_topic("TELEGRAM_FOREX_NEWS_TOPIC_ID")   # Berita Forex
TELEGRAM_STOCK_NEWS_TOPIC_ID:   Optional[int] = _parse_topic("TELEGRAM_STOCK_NEWS_TOPIC_ID")   # Berita Saham
TELEGRAM_CALENDAR_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_CALENDAR_TOPIC_ID")     # Kalender Ekonomi
TELEGRAM_STRATEGY_TOPIC_ID:     Optional[int] = _parse_topic("TELEGRAM_STRATEGY_TOPIC_ID")     # Strategi Trading
TELEGRAM_SCHOOL_TOPIC_ID:       Optional[int] = _parse_topic("TELEGRAM_SCHOOL_TOPIC_ID")       # Sekolah Trading

# Mapping kategori berita → topic ID (dipakai oleh _post_news_item)
# Dideklarasikan setelah semua topic var tersedia
def _news_topic_for_category(category: str) -> Optional[int]:
    return {
        "crypto": TELEGRAM_NEWS_TOPIC_ID,
        "forex":  TELEGRAM_FOREX_NEWS_TOPIC_ID,
        "saham":  TELEGRAM_STOCK_NEWS_TOPIC_ID,
    }.get(category, TELEGRAM_NEWS_TOPIC_ID)

# Binance credentials
BINANCE_API_KEY    = _cfg("BINANCE_API_KEY")
BINANCE_API_SECRET = _cfg("BINANCE_API_SECRET")

# MEXC credentials
MEXC_API_KEY    = _cfg("MEXC_API_KEY")
MEXC_API_SECRET = _cfg("MEXC_API_SECRET")

# Bybit credentials
BYBIT_API_KEY    = _cfg("BYBIT_API_KEY")
BYBIT_API_SECRET = _cfg("BYBIT_API_SECRET")

# Exchange aktif: "binance" (default), "mexc", atau "bybit"
# Set lewat config.json (halaman /config) atau env var ACTIVE_EXCHANGE
ACTIVE_EXCHANGE: str = _cfg("ACTIVE_EXCHANGE", "binance").lower()

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
# ─── SQLITE DATABASE ─────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

_db_lock = threading.Lock()

def init_db() -> None:
    """Inisialisasi SQLite — buat tabel kalau belum ada."""
    with _db_lock:
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp  TEXT    NOT NULL,
                    symbol     TEXT,
                    side       TEXT,
                    qty        REAL,
                    price      REAL,
                    confidence INTEGER,
                    reason     TEXT,
                    result     TEXT,
                    order_id   TEXT,
                    pnl        REAL,
                    pnl_pct    REAL,
                    live_mode  INTEGER DEFAULT 1
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(timestamp)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS equity_snapshots (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    equity    REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_equity_ts ON equity_snapshots(timestamp)
            """)
            # ── New tables ─────────────────────────────────────────────────
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT    NOT NULL,
                    action    TEXT    NOT NULL,
                    user      TEXT    DEFAULT 'bot',
                    details   TEXT    DEFAULT ''
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp)
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dca_positions (
                    symbol          TEXT    PRIMARY KEY,
                    amount_usdt     REAL    DEFAULT 10,
                    interval_hours  INTEGER DEFAULT 24,
                    enabled         INTEGER DEFAULT 1,
                    total_invested  REAL    DEFAULT 0,
                    total_qty       REAL    DEFAULT 0,
                    buy_count       INTEGER DEFAULT 0,
                    last_buy_at     TEXT    DEFAULT '',
                    next_buy_at     TEXT    DEFAULT ''
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS schedule_config (
                    id                  INTEGER PRIMARY KEY,
                    trading_start_hour  INTEGER DEFAULT 0,
                    trading_end_hour    INTEGER DEFAULT 24,
                    trading_days        TEXT    DEFAULT '0,1,2,3,4,5,6',
                    enabled             INTEGER DEFAULT 0
                )
            """)
            conn.commit()
    logger.info(f"✅ SQLite DB siap: {DB_FILE}")


def db_insert_trade(record: dict) -> None:
    """Tulis satu record trade ke SQLite (non-blocking, hanya log kalau gagal)."""
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute("""
                    INSERT INTO trades
                        (timestamp, symbol, side, qty, price, confidence,
                         reason, result, order_id, pnl, pnl_pct, live_mode)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    record.get("timestamp"),
                    record.get("symbol"),
                    record.get("side"),
                    record.get("qty"),
                    record.get("price"),
                    record.get("confidence"),
                    record.get("reason"),
                    record.get("result"),
                    record.get("order_id"),
                    record.get("pnl"),
                    record.get("pnl_pct"),
                    int(record.get("live_mode", True)),
                ))
                conn.commit()
    except Exception as e:
        logger.warning(f"SQLite insert trade gagal: {e}")


def db_save_equity_snapshot(equity: float) -> None:
    """Simpan snapshot equity sekarang ke SQLite."""
    try:
        ts = datetime.now(timezone.utc).isoformat()
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute(
                    "INSERT INTO equity_snapshots (timestamp, equity) VALUES (?,?)",
                    (ts, equity)
                )
                conn.commit()
    except Exception as e:
        logger.warning(f"SQLite insert equity gagal: {e}")


def db_get_recent_trades(n: int = 20) -> list[dict]:
    """Ambil N trade terakhir yang closed (TP/SL/EARLY_EXIT) dari SQLite."""
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("""
                    SELECT result, pnl FROM trades
                    WHERE result IN ('CLOSED_TP','CLOSED_SL','EARLY_EXIT')
                    ORDER BY id DESC LIMIT ?
                """, (n,)).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"SQLite get trades gagal: {e}")
        return []


def db_get_equity_history(days: int = 7) -> list[dict]:
    """Ambil snapshot equity N hari terakhir (satu per jam) untuk chart."""
    try:
        since = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        # Ambil semua snapshot lalu downsample di Python supaya ringan
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("""
                    SELECT timestamp, equity FROM equity_snapshots
                    WHERE timestamp >= datetime('now', ?)
                    ORDER BY timestamp ASC
                """, (f"-{days} days",)).fetchall()
        return [{"timestamp": r["timestamp"], "equity": r["equity"]} for r in rows]
    except Exception as e:
        logger.warning(f"SQLite get equity history gagal: {e}")
        return []


def db_get_daily_pnl_history(days: int = 7) -> list[dict]:
    """Hitung PnL per hari dari SQLite untuk chart bar."""
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("""
                    SELECT substr(timestamp,1,10) as date,
                           SUM(COALESCE(pnl,0)) as pnl,
                           SUM(CASE WHEN result='CLOSED_TP' THEN 1 ELSE 0 END) as wins,
                           SUM(CASE WHEN result IN ('CLOSED_SL') THEN 1 ELSE 0 END) as losses
                    FROM trades
                    WHERE result IN ('CLOSED_TP','CLOSED_SL','EARLY_EXIT')
                      AND timestamp >= datetime('now', ?)
                    GROUP BY date
                    ORDER BY date ASC
                """, (f"-{days} days",)).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"SQLite get daily PnL gagal: {e}")
        return []


# ---------------------------------------------------------------------------
# ─── STATE PERSISTENCE ───────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def save_state() -> None:
    """Simpan state bot (open_positions + seen_news_links) ke disk.
    Dipanggil setiap kali posisi terbuka / tertutup supaya data tidak hilang
    saat bot restart karena crash atau update."""
    try:
        with positions_lock:
            positions_snapshot = dict(open_positions)
        state = {
            "open_positions": positions_snapshot,
            "seen_news_links": list(seen_news_links),
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }
        # Tulis ke file temp dulu, lalu rename — atomic write
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, STATE_FILE)
        logger.debug(f"💾 State tersimpan: {len(positions_snapshot)} posisi terbuka")
    except Exception as e:
        logger.warning(f"Gagal simpan state: {e}")


def load_state() -> None:
    """Load state bot dari disk saat startup — pulihkan posisi terbuka
    yang ada sebelum bot di-restart."""
    global seen_news_links
    if not os.path.exists(STATE_FILE):
        logger.info("📂 Tidak ada state tersimpan — mulai segar")
        return
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        positions = state.get("open_positions", {})
        news_links = set(state.get("seen_news_links", []))
        saved_at = state.get("saved_at", "?")
        with positions_lock:
            open_positions.update(positions)
        seen_news_links.update(news_links)
        logger.info(
            f"📂 State di-load: {len(positions)} posisi dipulihkan "
            f"(tersimpan: {saved_at})"
        )
        if positions:
            pos_list = ", ".join(f"`{s}`" for s in positions)
            send_telegram_message(
                f"♻️ *Bot restart — posisi dipulihkan*\n\n"
                f"Posisi aktif: {pos_list}\n\n"
                f"_Monitoring TP/SL dilanjutkan otomatis\\._",
                topic_id=TELEGRAM_REPORT_TOPIC_ID,
            )
    except Exception as e:
        logger.warning(f"Gagal load state: {e}")

# ---------------------------------------------------------------------------
# ─── GLOBAL STATE ───────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

daily_start_equity: float = 0.0  # di-set oleh main_loop setelah fetch equity dari Binance

# AI conversation history (shared antara analisis trading & chat)
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

# Flag untuk pause/resume trading dari Telegram
bot_paused: bool = False
bot_paused_lock = threading.Lock()

# Event untuk memaksa scan langsung (dipicu oleh /start)
force_scan_event = threading.Event()

# Tracking Binance API weight (dari response header x-mbx-used-weight-1m)
_api_weight_1m: int = 0
_api_weight_lock = threading.Lock()

# Health monitoring — kapan terakhir AI menghasilkan sinyal (apapun arahnya)
_last_signal_time: float = time.time()
_last_signal_lock = threading.Lock()

# Equity snapshot — terakhir kali kita simpan snapshot ke DB (setiap 1 jam)
_last_equity_snapshot_time: float = 0.0

# ---------------------------------------------------------------------------
# ─── FLASK KEEP-ALIVE ───────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

flask_app = Flask(__name__)

@flask_app.route("/")
def keep_alive():
    return "alive", 200


@flask_app.route("/api/status")
@flask_app.route("/status")
def status():
    with pairs_lock:
        n_pairs = len(active_pairs)
    with positions_lock:
        n_pos = len(open_positions)
    with bot_paused_lock:
        paused = bot_paused
    with _api_weight_lock:
        weight = _api_weight_1m
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily = compute_daily_report(today_str)
    return json.dumps({
        "live_mode":         LIVE_MODE,
        "testnet":           BINANCE_TESTNET,
        "paused":            paused,
        "pairs_scanned":     n_pairs,
        "interval":          CANDLE_INTERVAL,
        "open_positions":    n_pos,
        "max_positions":     MAX_CONCURRENT_POSITIONS,
        "api_weight_1m":     weight,
        "trailing_sl":       TRAILING_SL_ENABLED,
        "confidence_min":    CONFIDENCE_THRESHOLD,
        "capital_pct":       CAPITAL_ALLOCATION_PCT,
        "daily_pnl":         daily["total_pnl"],
        "daily_wins":        daily["wins"],
        "daily_losses":      daily["losses"],
        "daily_win_rate":    daily["win_rate"],
    }), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/positions")
def api_positions():
    with positions_lock:
        snap = dict(open_positions)
    result = []
    for sym, pos in snap.items():
        entry = pos.get("entry_price", 0)
        tp    = pos.get("tp_price", 0)
        sl    = pos.get("sl_price", 0)
        highest = pos.get("highest_price_seen", entry)
        profit_pct = round((highest / entry - 1) * 100, 2) if entry else 0
        result.append({
            "symbol":           sym,
            "qty":              pos.get("qty", 0),
            "entry_price":      entry,
            "tp_price":         tp,
            "sl_price":         sl,
            "original_sl":      pos.get("original_sl_price", sl),
            "highest_price":    highest,
            "unrealized_pct":   profit_pct,
            "trailing_active":  pos.get("trailing_sl_active", False),
            "breakeven_done":   pos.get("breakeven_done", False),
            "partial_tp_done":  pos.get("partial_tp_done", False),
            "opened_at":        pos.get("opened_at", ""),
            "asset_group":      pos.get("asset_group", ""),
        })
    return json.dumps(result), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/daily")
def api_daily():
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily = compute_daily_report(today_str)
    equity = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 0.0
    daily["current_equity"] = equity
    daily["start_equity"]   = daily_start_equity
    daily["net_change"]     = round(equity - daily_start_equity, 4) if daily_start_equity else 0
    return json.dumps(daily), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/history")
def api_history():
    """Riwayat equity + PnL harian untuk chart performa di dashboard."""
    equity_history = db_get_equity_history(days=7)
    daily_pnl      = db_get_daily_pnl_history(days=7)
    recent_trades  = db_get_recent_trades(50)
    wins = sum(1 for t in recent_trades
               if t.get("result") == "CLOSED_TP"
               or (t.get("result") == "EARLY_EXIT" and (t.get("pnl") or 0) >= 0))
    win_rate_7d = round(wins / len(recent_trades) * 100, 1) if recent_trades else 0.0
    wr_now = get_recent_win_rate(KELLY_LOOKBACK)
    return json.dumps({
        "equity_history": equity_history,
        "daily_pnl":      daily_pnl,
        "win_rate_7d":    win_rate_7d,
        "kelly_mult":     round(_kelly_multiplier(), 2),
        "kelly_wr":       round(wr_now * 100, 1),
    }), 200, {"Content-Type": "application/json"}


_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trading Bot Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }
  .header { background: linear-gradient(135deg, #1a1f2e 0%, #0f1117 100%);
            border-bottom: 1px solid #2d3748; padding: 16px 24px;
            display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 1.4rem; font-weight: 700; }
  .badge { padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
  .badge-live { background: #2d4a22; color: #68d391; }
  .badge-testnet { background: #4a3922; color: #f6ad55; }
  .badge-paused { background: #4a2222; color: #fc8181; }
  .refresh-ts { margin-left: auto; font-size: 0.78rem; color: #4a5568; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 16px; }
  .card-title { font-size: 0.72rem; color: #718096; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .card-value { font-size: 1.7rem; font-weight: 700; line-height: 1.1; }
  .card-sub { font-size: 0.76rem; color: #718096; margin-top: 4px; }
  .green { color: #68d391; } .red { color: #fc8181; } .yellow { color: #f6ad55; }
  .blue { color: #63b3ed; } .purple { color: #b794f4; }
  .section-title { font-size: 1rem; font-weight: 600; margin-bottom: 12px; color: #a0aec0; }
  .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 28px; }
  @media (max-width: 680px) { .charts-row { grid-template-columns: 1fr; } }
  .chart-card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 18px; }
  .chart-card canvas { max-height: 210px; }
  .chart-note { text-align: center; font-size: 0.7rem; color: #4a5568; margin-top: 6px; }
  .positions-table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  .positions-table th { text-align: left; padding: 8px 12px; font-size: 0.7rem; color: #718096;
                        text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #2d3748; }
  .positions-table td { padding: 10px 12px; font-size: 0.83rem; border-bottom: 1px solid #171c27; }
  .positions-table tr:hover { background: #1e2535; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem;
          font-weight: 600; margin-right: 3px; white-space: nowrap; }
  .pill-trail { background: #2d4a22; color: #68d391; }
  .pill-be    { background: #1a3a4a; color: #63b3ed; }
  .pill-ptp   { background: #3a2d4a; color: #b794f4; }
  .empty-state { text-align: center; padding: 48px; color: #4a5568; font-size: 0.9rem; }
  .weight-bar { height: 5px; background: #2d3748; border-radius: 3px; margin-top: 7px; }
  .weight-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
  .footer { text-align: center; color: #4a5568; font-size: 0.72rem; padding: 20px; border-top: 1px solid #1a1f2e; }
</style>
</head>
<body>
<div class="header">
  <h1>🤖 Trading Bot AI</h1>
  <span id="mode-badge" class="badge"></span>
  <span id="pause-badge" class="badge badge-paused" style="display:none">⏸ PAUSED</span>
  <span class="refresh-ts" id="refresh-ts">—</span>
</div>
<div class="container">

  <!-- ── Metric Cards ── -->
  <div class="grid">
    <div class="card">
      <div class="card-title">P&L Hari Ini</div>
      <div class="card-value" id="daily-pnl">—</div>
      <div class="card-sub" id="daily-wr">Win rate —</div>
    </div>
    <div class="card">
      <div class="card-title">Saldo USDT</div>
      <div class="card-value blue" id="equity">—</div>
      <div class="card-sub" id="equity-change">vs. awal hari —</div>
    </div>
    <div class="card">
      <div class="card-title">Posisi Terbuka</div>
      <div class="card-value yellow" id="open-pos">—</div>
      <div class="card-sub" id="max-pos">max — slot</div>
    </div>
    <div class="card">
      <div class="card-title">Win / Loss</div>
      <div class="card-value" id="winloss">—</div>
      <div class="card-sub" id="trades-opened">— trade dibuka</div>
    </div>
    <div class="card">
      <div class="card-title">Kelly Sizing</div>
      <div class="card-value purple" id="kelly-mult">—</div>
      <div class="card-sub" id="kelly-wr">WR — dari — trade</div>
    </div>
    <div class="card">
      <div class="card-title">API Weight</div>
      <div class="card-value" id="api-weight">—</div>
      <div class="weight-bar"><div class="weight-fill" id="weight-fill" style="width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-title">Pair Dipindai</div>
      <div class="card-value blue" id="pairs">—</div>
      <div class="card-sub">setiap 1 menit</div>
    </div>
  </div>

  <!-- ── Charts ── -->
  <div class="charts-row">
    <div class="chart-card">
      <div class="section-title">📈 Equity Curve (7 hari)</div>
      <canvas id="equityChart"></canvas>
      <div class="chart-note" id="equity-note">Memuat data…</div>
    </div>
    <div class="chart-card">
      <div class="section-title">📊 PnL Harian (7 hari)</div>
      <canvas id="pnlChart"></canvas>
      <div class="chart-note" id="pnl-note">Memuat data…</div>
    </div>
  </div>

  <!-- ── Positions Table ── -->
  <div class="section-title">📂 Posisi Terbuka</div>
  <table class="positions-table">
    <thead>
      <tr>
        <th>Symbol</th><th>Entry</th><th>TP</th><th>SL (aktif)</th>
        <th>Tertinggi</th><th>Unrealized</th><th>Dibuka</th><th>Status</th>
      </tr>
    </thead>
    <tbody id="positions-body">
      <tr><td colspan="8" class="empty-state">Memuat data…</td></tr>
    </tbody>
  </table>

</div>
<div class="footer">
  Auto-refresh status 30s · Chart update 5 menit · Binance Testnet ·
  <span id="footer-ts">—</span>
</div>

<script>
let equityInst = null, pnlInst = null;

const CHART_DEFAULTS = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#718096', font: { size: 10 }, maxRotation: 40 },
         grid: { color: '#1a1f2e' } },
    y: { ticks: { color: '#718096', font: { size: 10 } },
         grid: { color: '#2d3748' } }
  }
};

async function loadStatus() {
  const [status, positions, daily] = await Promise.all([
    fetch('/api/status').then(r=>r.json()),
    fetch('/api/positions').then(r=>r.json()),
    fetch('/api/daily').then(r=>r.json()),
  ]);

  /* badges */
  const b = document.getElementById('mode-badge');
  b.textContent = status.testnet ? '🟡 TESTNET' : (status.live_mode ? '🔴 LIVE' : '🔵 Simulasi');
  b.className = 'badge ' + (status.testnet ? 'badge-testnet' : 'badge-live');
  document.getElementById('pause-badge').style.display = status.paused ? '' : 'none';

  /* P&L */
  const pnl = daily.total_pnl;
  const pe = document.getElementById('daily-pnl');
  pe.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(4) + ' USDT';
  pe.className = 'card-value ' + (pnl >= 0 ? 'green' : 'red');
  document.getElementById('daily-wr').textContent =
    `WR ${daily.win_rate}% (${daily.wins}W ${daily.losses}L)`;

  /* equity */
  const eq = daily.current_equity;
  document.getElementById('equity').textContent = eq.toFixed(2) + ' USDT';
  const chg = daily.net_change;
  const ce = document.getElementById('equity-change');
  ce.textContent = 'vs. awal: ' + (chg >= 0 ? '+' : '') + chg.toFixed(4) + ' USDT';
  ce.style.color = chg >= 0 ? '#68d391' : '#fc8181';

  /* counters */
  document.getElementById('open-pos').textContent = status.open_positions;
  document.getElementById('max-pos').textContent = `max ${status.max_positions} slot`;
  const wle = document.getElementById('winloss');
  wle.textContent = daily.wins + 'W / ' + daily.losses + 'L';
  wle.className = 'card-value ' + (daily.wins > daily.losses ? 'green' : daily.losses > daily.wins ? 'red' : '');
  document.getElementById('trades-opened').textContent = daily.trades_opened + ' trade dibuka';
  document.getElementById('pairs').textContent = status.pairs_scanned;

  /* weight bar */
  const w = status.api_weight_1m;
  document.getElementById('api-weight').textContent = w + ' / 1200';
  const pct = Math.min(w / 1200 * 100, 100);
  const fill = document.getElementById('weight-fill');
  fill.style.width = pct + '%';
  fill.style.background = pct > 85 ? '#fc8181' : pct > 60 ? '#f6ad55' : '#68d391';

  /* positions table */
  const tbody = document.getElementById('positions-body');
  if (!positions.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">📭 Tidak ada posisi terbuka</td></tr>';
  } else {
    tbody.innerHTML = positions.map(p => {
      const upct = p.unrealized_pct;
      const cl = upct > 0 ? 'green' : upct < 0 ? 'red' : '';
      const pills = [
        p.trailing_active ? '<span class="pill pill-trail">📈 Trail</span>' : '',
        p.breakeven_done  ? '<span class="pill pill-be">🛡️ BE</span>'       : '',
        p.partial_tp_done ? '<span class="pill pill-ptp">🎯 PTP</span>'     : '',
      ].join('');
      const opened = p.opened_at ? p.opened_at.replace('T',' ').slice(0,16)+' UTC' : '—';
      return `<tr>
        <td><strong>${p.symbol}</strong><br><span style="font-size:0.68rem;color:#718096">${p.asset_group||''}</span></td>
        <td>${p.entry_price}</td>
        <td class="green">${p.tp_price}</td>
        <td class="red">${p.sl_price}</td>
        <td>${p.highest_price}</td>
        <td class="${cl}" style="font-weight:600">${upct >= 0 ? '+' : ''}${upct}%</td>
        <td style="font-size:0.72rem;color:#718096">${opened}</td>
        <td>${pills || '<span style="color:#4a5568">—</span>'}</td>
      </tr>`;
    }).join('');
  }

  /* timestamp */
  const now = new Date().toLocaleString('id-ID');
  document.getElementById('refresh-ts').textContent = 'Update: ' + new Date().toLocaleTimeString('id-ID');
  document.getElementById('footer-ts').textContent = now;
}

async function loadHistory() {
  try {
    const h = await fetch('/api/history').then(r=>r.json());

    /* Kelly card */
    document.getElementById('kelly-mult').textContent = h.kelly_mult + '×';
    document.getElementById('kelly-wr').textContent =
      `WR ${h.kelly_wr}% dari ${h.daily_pnl.reduce((s,d)=>s+d.wins+d.losses,0)} trade`;

    /* Equity curve */
    const eqD = h.equity_history;
    document.getElementById('equity-note').textContent =
      eqD.length > 1 ? `${eqD.length} snapshot` : 'Butuh >1 jam untuk muncul';
    if (eqD.length > 1) {
      const labels = eqD.map(d => d.timestamp.slice(5,16).replace('T',' '));
      const vals   = eqD.map(d => d.equity);
      if (equityInst) equityInst.destroy();
      equityInst = new Chart(document.getElementById('equityChart'), {
        type: 'line',
        data: { labels, datasets: [{
          data: vals, borderColor: '#63b3ed',
          backgroundColor: 'rgba(99,179,237,0.07)',
          borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true,
        }]},
        options: CHART_DEFAULTS,
      });
    }

    /* Daily PnL bars */
    const pnlD = h.daily_pnl;
    document.getElementById('pnl-note').textContent =
      pnlD.length ? `${pnlD.length} hari tercatat` : 'Belum ada trade closed';
    if (pnlD.length) {
      const labels = pnlD.map(d => d.date.slice(5));
      const vals   = pnlD.map(d => parseFloat(d.pnl)||0);
      const colors = vals.map(v => v >= 0 ? 'rgba(104,211,145,0.75)' : 'rgba(252,129,129,0.75)');
      if (pnlInst) pnlInst.destroy();
      pnlInst = new Chart(document.getElementById('pnlChart'), {
        type: 'bar',
        data: { labels, datasets: [{
          data: vals, backgroundColor: colors, borderRadius: 5,
        }]},
        options: CHART_DEFAULTS,
      });
    }
  } catch(e) { console.error('History:', e); }
}

(async () => { await loadStatus(); await loadHistory(); })();
setInterval(loadStatus,  30_000);   /* status refresh 30s */
setInterval(loadHistory, 300_000);  /* chart refresh 5 menit */
</script>
</body>
</html>"""


@flask_app.route("/dashboard")
def dashboard():
    return _DASHBOARD_HTML, 200, {"Content-Type": "text/html"}


# ---------------------------------------------------------------------------
# ─── HALAMAN KONFIGURASI API KEYS ───────────────────────────────────────────
# ---------------------------------------------------------------------------

_CONFIG_HTML = """<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bot Config — API Keys</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }
  .header { background: linear-gradient(135deg,#1a1f2e,#0f1117); border-bottom: 1px solid #2d3748;
            padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 1.3rem; font-weight: 700; }
  .header a { margin-left: auto; font-size: 0.82rem; color: #63b3ed; text-decoration: none; }
  .container { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
  .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
  .card h2 { font-size: 0.9rem; color: #a0aec0; text-transform: uppercase; letter-spacing: .05em;
             margin-bottom: 16px; border-bottom: 1px solid #2d3748; padding-bottom: 10px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.8rem; color: #a0aec0; margin-bottom: 5px; }
  .field input, .field select {
    width: 100%; padding: 9px 12px; background: #0f1117; border: 1px solid #2d3748;
    border-radius: 8px; color: #e1e4e8; font-size: 0.88rem; outline: none;
    transition: border-color .2s;
  }
  .field input:focus, .field select:focus { border-color: #63b3ed; }
  .field .hint { font-size: 0.72rem; color: #4a5568; margin-top: 4px; }
  .btn { width: 100%; padding: 12px; background: #2b6cb0; border: none; border-radius: 8px;
         color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background .2s; }
  .btn:hover { background: #2c5282; }
  .alert { padding: 12px 16px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 18px; display: none; }
  .alert-ok  { background: #1a3a2a; border: 1px solid #2f855a; color: #68d391; }
  .alert-err { background: #3a1a1a; border: 1px solid #c53030; color: #fc8181; }
  .masked { letter-spacing: .15em; color: #718096; }
  .note { font-size: 0.78rem; color: #4a5568; padding: 12px 16px; background: #161b27;
          border-left: 3px solid #2d3748; border-radius: 4px; margin-top: 12px; }
</style>
</head>
<body>
<div class="header">
  <span>🔑</span>
  <h1>Konfigurasi API Keys</h1>
  <a href="/dashboard">← Dashboard</a>
</div>
<div class="container">
  <div id="alert" class="alert"></div>

  <form id="configForm">

    <div class="card">
      <h2>🔄 Exchange</h2>
      <div class="field">
        <label>Exchange Aktif</label>
        <select name="ACTIVE_EXCHANGE" id="ACTIVE_EXCHANGE">
          <option value="binance">Binance</option>
          <option value="mexc">MEXC</option>
          <option value="bybit">Bybit</option>
        </select>
        <div class="hint">Bot hanya mengeksekusi order di exchange yang dipilih.</div>
      </div>
    </div>

    <div class="card" id="binanceCard">
      <h2>🟡 Binance</h2>
      <div class="field">
        <label>API Key</label>
        <input type="password" name="BINANCE_API_KEY" id="BINANCE_API_KEY" placeholder="Kosongkan = tidak diubah" autocomplete="off">
        <div class="hint" id="binance_key_status"></div>
      </div>
      <div class="field">
        <label>API Secret</label>
        <input type="password" name="BINANCE_API_SECRET" id="BINANCE_API_SECRET" placeholder="Kosongkan = tidak diubah" autocomplete="off">
      </div>
      <div class="field">
        <label>Mode Testnet?</label>
        <select name="BINANCE_TESTNET">
          <option value="false">Tidak (LIVE — uang beneran)</option>
          <option value="true">Ya (Testnet — uang virtual)</option>
        </select>
        <div class="hint">Testnet: buat API key di testnet.binance.vision</div>
      </div>
    </div>

    <div class="card" id="mexcCard" style="display:none">
      <h2>🔵 MEXC</h2>
      <div class="field">
        <label>API Key</label>
        <input type="password" name="MEXC_API_KEY" id="MEXC_API_KEY" placeholder="Kosongkan = tidak diubah" autocomplete="off">
        <div class="hint" id="mexc_key_status"></div>
      </div>
      <div class="field">
        <label>API Secret</label>
        <input type="password" name="MEXC_API_SECRET" id="MEXC_API_SECRET" placeholder="Kosongkan = tidak diubah" autocomplete="off">
      </div>
    </div>

    <div class="card" id="bybitCard" style="display:none">
      <h2>🟠 Bybit</h2>
      <div class="hint" style="margin-bottom:12px;color:#ffa726">Buat API key di <a href="https://www.bybit.com/app/user/api-management" target="_blank">bybit.com → API Management</a>. Aktifkan izin: Spot Trading.</div>
      <div class="field">
        <label>API Key</label>
        <input type="password" name="BYBIT_API_KEY" id="BYBIT_API_KEY" placeholder="Kosongkan = tidak diubah" autocomplete="off">
        <div class="hint" id="bybit_key_status"></div>
      </div>
      <div class="field">
        <label>API Secret</label>
        <input type="password" name="BYBIT_API_SECRET" id="BYBIT_API_SECRET" placeholder="Kosongkan = tidak diubah" autocomplete="off">
      </div>
    </div>

    <div class="card">
      <h2>🤖 AI — 9Router Gateway</h2>
      <div class="hint" style="margin-bottom:12px;color:#ffa726">Semua AI traffic dirouting lewat 9Router (OpenAI-compatible proxy). Set URL 9Router kamu di bawah.</div>
      <div class="field">
        <label>AI Base URL (9Router)</label>
        <input type="text" name="AI_BASE_URL" id="AI_BASE_URL" placeholder="http://localhost:20128/v1">
        <div class="hint">URL 9Router kamu, contoh: https://9router.domain.com/v1</div>
      </div>
      <div class="field">
        <label>AI API Key (Bearer Token)</label>
        <input type="password" name="AI_API_KEY" id="AI_API_KEY" placeholder="Kosongkan = tidak diubah" autocomplete="off">
        <div class="hint" id="ai_key_status"></div>
        <div class="hint">Kosongkan jika 9Router tidak butuh autentikasi (local instance)</div>
      </div>
      <div class="field">
        <label>Model Utama (AI_MODEL)</label>
        <input type="text" name="AI_MODEL" id="AI_MODEL" placeholder="google/gemini-2.5-pro">
        <div class="hint">Model untuk analisis trading utama</div>
      </div>
      <div class="field">
        <label>Model Validator-1 (AI_VALIDATOR_MODEL)</label>
        <input type="text" name="AI_VALIDATOR_MODEL" id="AI_VALIDATOR_MODEL" placeholder="anthropic/claude-sonnet-5">
      </div>
      <div class="field">
        <label>Model Validator-2 (AI_VALIDATOR_MODEL2)</label>
        <input type="text" name="AI_VALIDATOR_MODEL2" id="AI_VALIDATOR_MODEL2" placeholder="openai/gpt-4o">
      </div>
      <div class="field">
        <label>Model Validator-3 (AI_VALIDATOR_MODEL3)</label>
        <input type="text" name="AI_VALIDATOR_MODEL3" id="AI_VALIDATOR_MODEL3" placeholder="google/gemini-1.5-flash">
      </div>
      <div class="field">
        <label>Model AI Coding (AI_CODING_MODEL)</label>
        <input type="text" name="AI_CODING_MODEL" id="AI_CODING_MODEL" placeholder="anthropic/claude-opus-4-5">
        <div class="hint">Dipakai endpoint /api/ai/code untuk auto-update bot</div>
      </div>
    </div>

    <div class="card">
      <h2>📱 Telegram</h2>
      <div class="field">
        <label>Bot Token</label>
        <input type="password" name="TELEGRAM_BOT_TOKEN" id="TELEGRAM_BOT_TOKEN" placeholder="Kosongkan = tidak diubah" autocomplete="off">
        <div class="hint" id="tg_token_status"></div>
        <div class="hint">Dari @BotFather → /newbot</div>
      </div>
      <div class="field">
        <label>Chat ID</label>
        <input type="text" name="TELEGRAM_CHAT_ID" id="TELEGRAM_CHAT_ID" placeholder="Contoh: -1001234567890">
        <div class="hint">Kirim pesan ke bot, buka api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</div>
      </div>
      <div class="field">
        <label>Topic ID — Sinyal BUY (opsional)</label>
        <input type="text" name="TELEGRAM_BUY_TOPIC_ID" placeholder="Nomor topic ID">
      </div>
      <div class="field">
        <label>Topic ID — Sinyal SELL/TP/SL (opsional)</label>
        <input type="text" name="TELEGRAM_SELL_TOPIC_ID" placeholder="Nomor topic ID">
      </div>
      <div class="field">
        <label>Topic ID — Laporan harian (opsional)</label>
        <input type="text" name="TELEGRAM_REPORT_TOPIC_ID" placeholder="Nomor topic ID">
      </div>
      <div class="field">
        <label>Topic ID — Berita (opsional)</label>
        <input type="text" name="TELEGRAM_NEWS_TOPIC_ID" placeholder="Nomor topic ID">
      </div>
    </div>

    <button type="submit" class="btn">💾 Simpan Konfigurasi</button>
    <div class="note">
      ⚠️ Setelah simpan, <strong>restart bot</strong> agar perubahan aktif.<br>
      Konfigurasi disimpan ke <code>config.json</code> di folder <code>trading-bot/</code>.
      Kolom yang dikosongkan tidak akan mengubah nilai yang sudah tersimpan.
    </div>
  </form>
</div>

<script>
async function loadCurrentConfig() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    document.getElementById('ACTIVE_EXCHANGE').value = d.ACTIVE_EXCHANGE || 'binance';
    toggleExchangeCards(d.ACTIVE_EXCHANGE || 'binance');
    if (d.BINANCE_TESTNET === 'true') {
      document.querySelector('[name=BINANCE_TESTNET]').value = 'true';
    }
    document.getElementById('TELEGRAM_CHAT_ID').value = d.TELEGRAM_CHAT_ID || '';
    document.querySelector('[name=TELEGRAM_BUY_TOPIC_ID]').value = d.TELEGRAM_BUY_TOPIC_ID || '';
    document.querySelector('[name=TELEGRAM_SELL_TOPIC_ID]').value = d.TELEGRAM_SELL_TOPIC_ID || '';
    document.querySelector('[name=TELEGRAM_REPORT_TOPIC_ID]').value = d.TELEGRAM_REPORT_TOPIC_ID || '';
    document.querySelector('[name=TELEGRAM_NEWS_TOPIC_ID]').value = d.TELEGRAM_NEWS_TOPIC_ID || '';
    // Status badge untuk key yang sudah terisi
    if (d.has_BINANCE_API_KEY)    document.getElementById('binance_key_status').textContent  = '✅ Sudah terisi';
    if (d.has_MEXC_API_KEY)       document.getElementById('mexc_key_status').textContent     = '✅ Sudah terisi';
    if (d.has_BYBIT_API_KEY)      document.getElementById('bybit_key_status').textContent    = '✅ Sudah terisi';
    if (d.has_TELEGRAM_BOT_TOKEN) document.getElementById('tg_token_status').textContent     = '✅ Sudah terisi';
  } catch(e) { console.warn('Gagal load config:', e); }
}

function toggleExchangeCards(val) {
  document.getElementById('binanceCard').style.display = val === 'binance' ? '' : 'none';
  document.getElementById('mexcCard').style.display    = val === 'mexc'    ? '' : 'none';
  document.getElementById('bybitCard').style.display   = val === 'bybit'   ? '' : 'none';
}

document.getElementById('ACTIVE_EXCHANGE').addEventListener('change', function() {
  toggleExchangeCards(this.value);
});

document.getElementById('configForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const data = {};
  new FormData(this).forEach((v, k) => { if (v.trim()) data[k] = v.trim(); });
  try {
    const r = await fetch('/api/config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await r.json();
    const alert = document.getElementById('alert');
    if (result.ok) {
      alert.className = 'alert alert-ok';
      alert.textContent = '✅ ' + result.message;
      alert.style.display = '';
      loadCurrentConfig();
    } else {
      alert.className = 'alert alert-err';
      alert.textContent = '❌ ' + (result.error || 'Gagal simpan');
      alert.style.display = '';
    }
    setTimeout(() => alert.style.display = 'none', 6000);
  } catch(err) {
    const alert = document.getElementById('alert');
    alert.className = 'alert alert-err';
    alert.textContent = '❌ Error: ' + err.message;
    alert.style.display = '';
  }
});

loadCurrentConfig();
</script>
</body>
</html>"""

# Kolom yang TIDAK boleh dikembalikan plain ke browser (hanya status has_*)
_SENSITIVE_KEYS = {
    "BINANCE_API_KEY", "BINANCE_API_SECRET",
    "MEXC_API_KEY", "MEXC_API_SECRET",
    "BYBIT_API_KEY", "BYBIT_API_SECRET",
    "AI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    # Legacy — tetap disembunyikan jika ada di config lama
    "GROQ_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY", "GEMINI_API_KEY",
}

@flask_app.route("/config")
def config_page():
    return _CONFIG_HTML, 200, {"Content-Type": "text/html"}


@flask_app.route("/api/config")
def api_config_get():
    """Kembalikan config saat ini — key sensitif hanya ditampilkan sebagai has_* boolean."""
    cfg = _load_bot_config()
    safe = {}
    for k, v in cfg.items():
        if k in _SENSITIVE_KEYS:
            safe[f"has_{k}"] = bool(v)
        else:
            safe[k] = v
    # Tambahkan has_* untuk env var yang mungkin tidak ada di config.json
    for sk in _SENSITIVE_KEYS:
        if f"has_{sk}" not in safe:
            safe[f"has_{sk}"] = bool(os.getenv(sk, ""))
    return json.dumps(safe), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/config/save", methods=["POST"])
def api_config_save():
    """Simpan API keys ke config.json. Kolom kosong/tidak dikirim = tidak diubah."""
    denied = _check_api_key()
    if denied: return denied
    try:
        data = flask_request.get_json(force=True) or {}
        cfg = _load_bot_config()
        for key, value in data.items():
            v = str(value).strip()
            if v:
                cfg[key] = v
        _save_bot_config(cfg)
        return json.dumps({
            "ok": True,
            "message": "Tersimpan! Restart bot agar konfigurasi aktif.",
        }), 200, {"Content-Type": "application/json"}
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)}), 500, {"Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# ─── ANALYTICS ENGINE ────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def compute_analytics(days: int = 30) -> dict:
    """Comprehensive analytics: Sharpe, Sortino, Calmar, drawdown, attribution."""
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("""
                    SELECT timestamp, symbol, pnl, result
                    FROM trades
                    WHERE result IN ('CLOSED_TP','CLOSED_SL','EARLY_EXIT')
                      AND timestamp >= datetime('now', ?)
                    ORDER BY timestamp ASC
                """, (f"-{days} days",)).fetchall()
        trades = [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"Analytics DB: {e}")
        trades = []

    if not trades:
        return {"days": days, "trades_count": 0, "win_rate": 0, "total_pnl": 0,
                "avg_pnl": 0, "best_trade": 0, "worst_trade": 0, "gross_profit": 0,
                "gross_loss": 0, "sharpe_ratio": 0, "sortino_ratio": 0,
                "calmar_ratio": 0, "max_drawdown_pct": 0, "max_drawdown_usdt": 0,
                "profit_factor": 0, "expectancy": 0, "consecutive_wins": 0,
                "consecutive_losses": 0, "by_symbol": [], "by_result": {}}

    pnls = [float(t.get("pnl") or 0) for t in trades]
    wins_list = [p for p in pnls if p > 0]
    loss_list  = [p for p in pnls if p < 0]
    win_rate   = len(wins_list) / len(pnls) * 100 if pnls else 0
    total_pnl  = sum(pnls)
    avg_pnl    = total_pnl / len(pnls) if pnls else 0

    # Sharpe (annualised, assumes each trade = 1 period)
    if len(pnls) > 1:
        mu = sum(pnls) / len(pnls)
        variance = sum((p - mu) ** 2 for p in pnls) / (len(pnls) - 1)
        std = math.sqrt(variance) if variance > 0 else 0
        sharpe = (mu / std * math.sqrt(252)) if std > 0 else 0
    else:
        sharpe = 0

    # Sortino (downside deviation only)
    if loss_list:
        down_var = sum(p ** 2 for p in loss_list) / len(loss_list)
        down_std = math.sqrt(down_var) if down_var > 0 else 0
        mu = sum(pnls) / len(pnls)
        sortino = (mu / down_std * math.sqrt(252)) if down_std > 0 else 0
    else:
        sortino = 0

    # Max drawdown from cumulative PnL curve
    cum = []
    running = 0.0
    for p in pnls:
        running += p
        cum.append(running)
    peak = cum[0] if cum else 0
    max_dd = 0.0
    for val in cum:
        if val > peak:
            peak = val
        dd = peak - val
        if dd > max_dd:
            max_dd = dd
    max_dd_pct = (max_dd / (peak + 1e-9)) * 100 if peak > 0 else 0

    # Calmar = annualised return / max drawdown
    ann_return = total_pnl * (365 / max(days, 1))
    calmar = (ann_return / max_dd) if max_dd > 0 else 0

    gross_profit = sum(wins_list) if wins_list else 0
    gross_loss   = abs(sum(loss_list)) if loss_list else 0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 999

    avg_win = (gross_profit / len(wins_list)) if wins_list else 0
    avg_loss = (gross_loss / len(loss_list)) if loss_list else 0
    wr_dec   = win_rate / 100
    expectancy = (wr_dec * avg_win) - ((1 - wr_dec) * avg_loss)

    # By symbol
    sym_map: dict = {}
    for t in trades:
        s = t.get("symbol", "?")
        if s not in sym_map:
            sym_map[s] = {"symbol": s, "trades": 0, "wins": 0, "pnl": 0.0}
        p = float(t.get("pnl") or 0)
        sym_map[s]["trades"] += 1
        sym_map[s]["pnl"] += p
        if p > 0:
            sym_map[s]["wins"] += 1
    for s in sym_map:
        d = sym_map[s]
        d["win_rate"] = round(d["wins"] / d["trades"] * 100, 1) if d["trades"] else 0
        d["pnl"] = round(d["pnl"], 4)
    by_symbol = sorted(sym_map.values(), key=lambda x: x["pnl"], reverse=True)[:20]

    # By result type
    by_result: dict = {}
    for t in trades:
        r = t.get("result", "?")
        by_result[r] = by_result.get(r, 0) + 1

    # Consecutive wins/losses
    cw = cl = max_cw = max_cl = 0
    for p in pnls:
        if p > 0:
            cw += 1; cl = 0; max_cw = max(max_cw, cw)
        else:
            cl += 1; cw = 0; max_cl = max(max_cl, cl)

    return {
        "days": days, "trades_count": len(trades),
        "win_rate": round(win_rate, 1), "total_pnl": round(total_pnl, 4),
        "avg_pnl": round(avg_pnl, 4), "best_trade": round(max(pnls), 4),
        "worst_trade": round(min(pnls), 4), "gross_profit": round(gross_profit, 4),
        "gross_loss": round(gross_loss, 4), "sharpe_ratio": round(sharpe, 3),
        "sortino_ratio": round(sortino, 3), "calmar_ratio": round(calmar, 3),
        "max_drawdown_pct": round(max_dd_pct, 2), "max_drawdown_usdt": round(max_dd, 4),
        "profit_factor": round(profit_factor, 3), "expectancy": round(expectancy, 4),
        "consecutive_wins": max_cw, "consecutive_losses": max_cl,
        "by_symbol": by_symbol, "by_result": by_result,
    }


# ---------------------------------------------------------------------------
# ─── BACKTESTING ENGINE ──────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def run_backtest(symbol: str, days: int = 14, initial_capital: float = 1000.0,
                 tp_pct: float = 3.0, sl_pct: float = 1.0,
                 rsi_threshold: float = 35.0) -> dict:
    """RSI-based backtest simulation on Binance 15m historical candles."""
    try:
        limit = min(days * 24 * 4, 1000)
        base = ("https://testnet.binance.vision" if BINANCE_TESTNET
                else "https://api.binance.com")
        resp = requests.get(f"{base}/api/v3/klines",
                            params={"symbol": symbol.upper(), "interval": "15m", "limit": limit},
                            timeout=12)
        if resp.status_code != 200:
            return {"error": f"Binance API {resp.status_code}"}
        raw = resp.json()
        if len(raw) < 20:
            return {"error": "Not enough data"}
        df = pd.DataFrame(raw, columns=[
            "open_time","open","high","low","close","volume",
            "close_time","qvol","trades","tbb","tbq","ignore"
        ])
        df = df.astype({"open": float, "high": float, "low": float, "close": float})
        delta = df["close"].diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta).clip(lower=0).rolling(14).mean()
        df["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, 1e-9))

        capital = initial_capital
        position = None
        bt_trades: list = []
        equity_curve: list = [{"idx": 0, "equity": capital}]

        for i in range(20, len(df)):
            c = df.iloc[i]
            price, rsi = c["close"], c["rsi"]
            if position is None:
                if rsi < rsi_threshold:
                    qty = (capital * 0.02) / price
                    position = {"entry": price, "qty": qty,
                                "tp": price * (1 + tp_pct / 100),
                                "sl": price * (1 - sl_pct / 100)}
            else:
                hi, lo = df.iloc[i]["high"], df.iloc[i]["low"]
                if hi >= position["tp"]:
                    pnl = (position["tp"] - position["entry"]) * position["qty"]
                    capital += pnl
                    bt_trades.append({"result": "TP", "pnl": round(pnl, 4)})
                    position = None
                elif lo <= position["sl"]:
                    pnl = (position["sl"] - position["entry"]) * position["qty"]
                    capital += pnl
                    bt_trades.append({"result": "SL", "pnl": round(pnl, 4)})
                    position = None
            equity_curve.append({"idx": i, "equity": round(capital, 4)})

        wins  = [t for t in bt_trades if t["pnl"] > 0]
        losses= [t for t in bt_trades if t["pnl"] <= 0]
        pnl_sum = sum(t["pnl"] for t in bt_trades)

        peak2 = initial_capital; mdd = 0.0; running2 = initial_capital
        for t in bt_trades:
            running2 += t["pnl"]
            if running2 > peak2: peak2 = running2
            mdd = max(mdd, peak2 - running2)

        return {
            "symbol": symbol.upper(), "days": days, "candles": len(df),
            "initial_capital": initial_capital, "final_capital": round(capital, 4),
            "total_pnl": round(pnl_sum, 4),
            "total_return_pct": round((capital - initial_capital) / initial_capital * 100, 2),
            "trades_count": len(bt_trades), "wins": len(wins), "losses": len(losses),
            "win_rate": round(len(wins) / len(bt_trades) * 100, 1) if bt_trades else 0,
            "max_drawdown_usdt": round(mdd, 4),
            "profit_factor": round(
                sum(t["pnl"] for t in wins) / max(abs(sum(t["pnl"] for t in losses)), 1e-9), 3
            ),
            "params": {"tp_pct": tp_pct, "sl_pct": sl_pct, "rsi_threshold": rsi_threshold},
            "equity_curve": equity_curve[-100:],
            "recent_trades": bt_trades[-10:],
        }
    except Exception as e:
        logger.warning(f"Backtest {symbol}: {e}")
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# ─── EMAIL NOTIFICATIONS ──────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

_email_lock = threading.Lock()

def send_email_notification(subject: str, body: str) -> bool:
    """Send HTML email via SMTP. Returns True on success."""
    if not EMAIL_ENABLED or not all([EMAIL_FROM, EMAIL_TO, EMAIL_PASSWORD]):
        return False
    try:
        with _email_lock:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"{EMAIL_SUBJECT_PREFIX} {subject}"
            msg["From"]    = EMAIL_FROM
            msg["To"]      = EMAIL_TO
            msg.attach(MIMEText(body, "html"))
            with smtplib.SMTP(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(EMAIL_FROM, EMAIL_PASSWORD)
                smtp.sendmail(EMAIL_FROM, EMAIL_TO, msg.as_string())
        logger.info(f"✉️ Email: {subject}")
        return True
    except Exception as e:
        logger.warning(f"Email error: {e}")
        return False


# ---------------------------------------------------------------------------
# ─── AUDIT LOG ───────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def log_audit(action: str, details: str = "", user: str = "bot") -> None:
    try:
        ts = datetime.now(timezone.utc).isoformat()
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute(
                    "INSERT INTO audit_log (timestamp, action, user, details) VALUES (?,?,?,?)",
                    (ts, action, user, details)
                )
                conn.commit()
    except Exception as e:
        logger.debug(f"Audit log: {e}")


def db_get_audit_log(limit: int = 100) -> list:
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
                ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"Audit fetch: {e}")
        return []


# ---------------------------------------------------------------------------
# ─── SYSTEM RESOURCES ────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

_bot_start_time: float = time.time()

def get_system_resources() -> dict:
    try:
        cpu  = psutil.cpu_percent(interval=0.1)
        mem  = psutil.virtual_memory()
        disk = psutil.disk_usage(".")
        net  = psutil.net_io_counters()
        return {
            "cpu_pct":        round(cpu, 1),
            "mem_total_gb":   round(mem.total  / 1024**3, 2),
            "mem_used_gb":    round(mem.used   / 1024**3, 2),
            "mem_pct":        round(mem.percent, 1),
            "disk_total_gb":  round(disk.total / 1024**3, 2),
            "disk_used_gb":   round(disk.used  / 1024**3, 2),
            "disk_pct":       round(disk.percent, 1),
            "net_sent_mb":    round(net.bytes_sent / 1024**2, 2),
            "net_recv_mb":    round(net.bytes_recv / 1024**2, 2),
            "bot_uptime_sec": int(time.time() - _bot_start_time),
        }
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# ─── DATABASE BACKUP ─────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def backup_database() -> dict:
    try:
        os.makedirs(DB_BACKUP_DIR, exist_ok=True)
        ts   = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        dest = os.path.join(DB_BACKUP_DIR, f"trades_{ts}.db")
        shutil.copy2(DB_FILE, dest)
        size = os.path.getsize(dest)
        log_audit("DB_BACKUP", f"{dest} ({size}B)")
        return {"ok": True, "file": dest, "size_bytes": size, "timestamp": ts}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def list_backups() -> list:
    try:
        if not os.path.isdir(DB_BACKUP_DIR):
            return []
        files = []
        for f in sorted(os.listdir(DB_BACKUP_DIR), reverse=True):
            if f.endswith(".db"):
                fp = os.path.join(DB_BACKUP_DIR, f)
                files.append({
                    "file": f, "size_bytes": os.path.getsize(fp),
                    "modified": datetime.fromtimestamp(
                        os.path.getmtime(fp), tz=timezone.utc
                    ).isoformat(),
                })
        return files[:20]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# ─── DCA MANAGEMENT ──────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def db_get_dca_positions() -> list:
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT * FROM dca_positions ORDER BY symbol"
                ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"DCA get: {e}")
        return []


def db_save_dca_position(symbol: str, data: dict) -> None:
    try:
        next_buy = datetime.now(timezone.utc).isoformat()
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute("""
                    INSERT INTO dca_positions
                        (symbol, amount_usdt, interval_hours, enabled, next_buy_at)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT(symbol) DO UPDATE SET
                        amount_usdt=excluded.amount_usdt,
                        interval_hours=excluded.interval_hours,
                        enabled=excluded.enabled,
                        next_buy_at=excluded.next_buy_at
                """, (
                    symbol,
                    float(data.get("amount_usdt", DCA_DEFAULT_AMOUNT_USDT)),
                    int(data.get("interval_hours", DCA_DEFAULT_INTERVAL_HOURS)),
                    int(data.get("enabled", 1)),
                    data.get("next_buy_at", next_buy),
                ))
                conn.commit()
    except Exception as e:
        logger.warning(f"DCA save: {e}")


def db_delete_dca_position(symbol: str) -> None:
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute("DELETE FROM dca_positions WHERE symbol=?", (symbol,))
                conn.commit()
    except Exception as e:
        logger.warning(f"DCA delete: {e}")


def execute_dca_buy(symbol: str, amount_usdt: float) -> dict:
    """Execute a DCA market buy for amount_usdt worth of symbol."""
    try:
        base = ("https://testnet.binance.vision" if BINANCE_TESTNET
                else "https://api.binance.com")
        resp = requests.get(f"{base}/api/v3/ticker/price",
                            params={"symbol": symbol}, timeout=5)
        if resp.status_code != 200:
            return {"ok": False, "error": f"Price fetch: {resp.status_code}"}
        price = float(resp.json()["price"])
        qty   = amount_usdt / price
        order = execute_exchange(symbol, "BUY", qty)
        if order.get("error"):
            return {"ok": False, "error": order["error"]}
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute("""
                    UPDATE dca_positions
                    SET total_invested = total_invested + ?,
                        total_qty = total_qty + ?,
                        buy_count = buy_count + 1,
                        last_buy_at = ?,
                        next_buy_at = datetime('now', '+' || interval_hours || ' hours')
                    WHERE symbol = ?
                """, (amount_usdt, qty, datetime.now(timezone.utc).isoformat(), symbol))
                conn.commit()
        log_audit("DCA_BUY", f"{symbol} {qty:.6f} @ {price:.4f} ({amount_usdt:.2f} USDT)")
        return {"ok": True, "symbol": symbol, "qty": qty,
                "price": price, "spent": amount_usdt}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# ─── VACATION MODE & SCHEDULE ────────────────────────────────────────────────
# ---------------------------------------------------------------------------

_vacation_mode_lock  = threading.Lock()
_vacation_mode_state = VACATION_MODE_INIT


def get_vacation_mode() -> bool:
    with _vacation_mode_lock:
        return _vacation_mode_state


def set_vacation_mode(enabled: bool) -> None:
    global _vacation_mode_state, bot_paused
    with _vacation_mode_lock:
        _vacation_mode_state = enabled
    if enabled:
        with bot_paused_lock:
            bot_paused = True
        log_audit("VACATION_ON")
        send_telegram_message(
            "🏖 *Vacation mode aktif\\. Bot di\\-pause\\.*",
            topic_id=TELEGRAM_REPORT_TOPIC_ID
        )
    else:
        with bot_paused_lock:
            bot_paused = False
        log_audit("VACATION_OFF")
        send_telegram_message(
            "👋 *Vacation mode nonaktif\\. Bot lanjut\\.*",
            topic_id=TELEGRAM_REPORT_TOPIC_ID
        )


def get_schedule_config() -> dict:
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM schedule_config WHERE id=1"
                ).fetchone()
        if row:
            return dict(row)
    except Exception:
        pass
    return {
        "trading_start_hour": TRADING_START_HOUR_UTC,
        "trading_end_hour":   TRADING_END_HOUR_UTC,
        "trading_days":       "0,1,2,3,4,5,6",
        "enabled":            0,
    }


def save_schedule_config(data: dict) -> None:
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.execute("""
                    INSERT INTO schedule_config
                        (id, trading_start_hour, trading_end_hour, trading_days, enabled)
                    VALUES (1,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                        trading_start_hour=excluded.trading_start_hour,
                        trading_end_hour=excluded.trading_end_hour,
                        trading_days=excluded.trading_days,
                        enabled=excluded.enabled
                """, (
                    int(data.get("trading_start_hour", 0)),
                    int(data.get("trading_end_hour", 24)),
                    data.get("trading_days", "0,1,2,3,4,5,6"),
                    int(data.get("enabled", 0)),
                ))
                conn.commit()
    except Exception as e:
        logger.warning(f"Schedule config: {e}")


# ---------------------------------------------------------------------------
# ─── NEW FLASK ROUTES ─────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@flask_app.route("/api/analytics")
@flask_app.route("/api/stats/advanced")
def api_analytics():
    days = int(flask_request.args.get("days", 30))
    return json.dumps(compute_analytics(days)), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/backtest/run", methods=["GET", "POST"])
@flask_app.route("/api/backtest", methods=["GET", "POST"])
def api_backtest():
    data = (flask_request.get_json(force=True) or {}) if flask_request.method == "POST" \
           else flask_request.args.to_dict()
    result = run_backtest(
        symbol          = data.get("symbol", "BTCUSDT"),
        days            = int(data.get("days", 14)),
        initial_capital = float(data.get("initial_capital", 1000)),
        tp_pct          = float(data.get("tp_pct", TP_PCT)),
        sl_pct          = float(data.get("sl_pct", SL_PCT)),
        rsi_threshold   = float(data.get("rsi_threshold", 35)),
    )
    return json.dumps(result), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/system")
@flask_app.route("/api/system/resources")
def api_system():
    res = get_system_resources()
    with _last_signal_lock:
        last_sig = _last_signal_time
    res["last_signal_ago_sec"] = int(time.time() - last_sig)
    return json.dumps(res), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/healthz/detail")
def api_healthz_detail():
    with positions_lock:   n_pos   = len(open_positions)
    with bot_paused_lock:  paused  = bot_paused
    with pairs_lock:       n_pairs = len(active_pairs)
    with _api_weight_lock: weight  = _api_weight_1m
    with _last_signal_lock: last_sig = _last_signal_time
    sys_res = get_system_resources()
    checks = {
        "bot_running":    not paused,
        "db_accessible":  os.path.exists(DB_FILE),
        "pairs_loaded":   n_pairs > 0,
        "api_weight_ok":  weight < 1000,
        "vacation_mode":  get_vacation_mode(),
    }
    status = "healthy" if checks["db_accessible"] and checks["pairs_loaded"] else "degraded"
    return json.dumps({
        "status": status, "checks": checks, "open_positions": n_pos,
        "pairs_scanned": n_pairs, "api_weight_1m": weight, "paused": paused,
        "last_signal_ago_sec": int(time.time() - last_sig), "system": sys_res,
    }), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/audit")
def api_audit():
    limit = int(flask_request.args.get("limit", 100))
    return json.dumps(db_get_audit_log(limit)), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/backup", methods=["POST"])
def api_backup():
    denied = _check_api_key()
    if denied: return denied
    result = backup_database()
    code = 200 if result["ok"] else 500
    return json.dumps(result), code, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/backup/list")
def api_backup_list():
    return json.dumps(list_backups()), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/vacation")
def api_vacation_get():
    return json.dumps({"vacation_mode": get_vacation_mode()}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/vacation/toggle", methods=["POST"])
def api_vacation_toggle():
    denied = _check_api_key()
    if denied: return denied
    data    = flask_request.get_json(force=True) or {}
    enabled = data.get("enabled", not get_vacation_mode())
    set_vacation_mode(bool(enabled))
    log_audit("VACATION_TOGGLE", f"enabled={enabled}", user=data.get("user", "api"))
    return json.dumps({"ok": True, "vacation_mode": get_vacation_mode()}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/schedule")
def api_schedule_get():
    return json.dumps(get_schedule_config()), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/schedule/save", methods=["POST"])
def api_schedule_save():
    denied = _check_api_key()
    if denied: return denied
    data = flask_request.get_json(force=True) or {}
    save_schedule_config(data)
    log_audit("SCHEDULE_UPDATE", str(data))
    return json.dumps({"ok": True}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/dca")
def api_dca_get():
    return json.dumps(db_get_dca_positions()), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/dca/add", methods=["POST"])
def api_dca_add():
    denied = _check_api_key()
    if denied: return denied
    data   = flask_request.get_json(force=True) or {}
    symbol = data.get("symbol", "").upper().strip()
    if not symbol:
        return json.dumps({"ok": False, "error": "symbol required"}), 400, \
            {"Content-Type": "application/json"}
    db_save_dca_position(symbol, data)
    log_audit("DCA_ADD", symbol)
    return json.dumps({"ok": True, "symbol": symbol}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/dca/remove", methods=["POST"])
def api_dca_remove():
    denied = _check_api_key()
    if denied: return denied
    data   = flask_request.get_json(force=True) or {}
    symbol = data.get("symbol", "").upper().strip()
    db_delete_dca_position(symbol)
    log_audit("DCA_REMOVE", symbol)
    return json.dumps({"ok": True, "symbol": symbol}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/dca/trigger", methods=["POST"])
def api_dca_trigger():
    denied = _check_api_key()
    if denied: return denied
    data   = flask_request.get_json(force=True) or {}
    symbol = data.get("symbol", "").upper().strip()
    amount = float(data.get("amount_usdt", DCA_DEFAULT_AMOUNT_USDT))
    result = execute_dca_buy(symbol, amount)
    code   = 200 if result.get("ok") else 400
    return json.dumps(result), code, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/email/test", methods=["POST"])
def api_email_test():
    denied = _check_api_key()
    if denied: return denied
    data = flask_request.get_json(force=True) or {}
    ok   = send_email_notification(
        data.get("subject", "Test Email"),
        data.get("body", "<b>Email notifikasi berhasil!</b>"),
    )
    return json.dumps({
        "ok": ok, "email_enabled": EMAIL_ENABLED,
        "from": EMAIL_FROM, "to": EMAIL_TO,
    }), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/trades")
def api_trades_all():
    limit   = int(flask_request.args.get("limit", 100))
    days    = int(flask_request.args.get("days", 30))
    res_f   = flask_request.args.get("result", "")
    sym_f   = flask_request.args.get("symbol", "")
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                q  = ("SELECT id,timestamp,symbol,side,qty,price,confidence,"
                      "reason,result,pnl,pnl_pct FROM trades "
                      "WHERE timestamp >= datetime('now', ?)")
                ps: list = [f"-{days} days"]
                if res_f:
                    q += " AND result=?";  ps.append(res_f)
                if sym_f:
                    q += " AND symbol=?";  ps.append(sym_f.upper())
                q += " ORDER BY id DESC LIMIT ?"; ps.append(limit)
                rows = conn.execute(q, ps).fetchall()
        return json.dumps([dict(r) for r in rows]), 200, \
            {"Content-Type": "application/json"}
    except Exception as e:
        return json.dumps({"error": str(e)}), 500, {"Content-Type": "application/json"}


@flask_app.route("/api/ai/code", methods=["POST"])
def api_ai_code():
    """
    AI Coding endpoint via 9Router.
    Bot bisa minta AI untuk membaca, menjelaskan, atau menyarankan perubahan kode.

    Body JSON:
      { "task": "deskripsi task coding",
        "context": "snippet kode yang relevan (opsional)",
        "model": "model override (opsional)" }

    Return:
      { "result": "...", "model": "...", "tokens_used": N }

    Contoh pakai dari Telegram: /code <deskripsi>
    """
    try:
        body    = flask_request.get_json(force=True, silent=True) or {}
        task    = str(body.get("task", "")).strip()
        context = str(body.get("context", "")).strip()
        model   = str(body.get("model", AI_CODING_MODEL)).strip() or AI_CODING_MODEL

        if not task:
            return json.dumps({"error": "Field 'task' wajib diisi"}), 400, \
                   {"Content-Type": "application/json"}

        system_prompt = (
            "Kamu adalah AI engineer ahli Python dan sistem trading. "
            "Bantu pengguna dengan task coding yang diberikan. "
            "Berikan kode yang bersih, lengkap, dan siap pakai. "
            "Kalau diminta review/explain, jelaskan secara ringkas dan tepat sasaran."
        )
        user_msg = f"TASK: {task}"
        if context:
            user_msg += f"\n\nKONTEKS KODE:\n```python\n{context}\n```"

        result = _call_9router(
            [{"role": "system", "content": system_prompt},
             {"role": "user",   "content": user_msg}],
            model=model,
            max_tokens=4096,
            temperature=0.2,
        )

        # Kirim notif ke Telegram (topik CODING jika ada)
        if TELEGRAM_CODING_TOPIC_ID:
            _tg_send(
                f"🤖 *AI Coding Task*\n"
                f"Model: `{model}`\n"
                f"Task: {task[:200]}",
                topic_id=TELEGRAM_CODING_TOPIC_ID,
            )

        return json.dumps({"result": result, "model": model}), 200, \
               {"Content-Type": "application/json"}

    except Exception as e:
        logger.error(f"api_ai_code error: {e}")
        return json.dumps({"error": str(e)}), 500, \
               {"Content-Type": "application/json"}


@flask_app.route("/api/ai/fear-greed")
def api_fear_greed():
    """Return Fear & Greed Index saat ini (cached 1 jam)."""
    return json.dumps(get_fear_greed_index()), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/news")
def api_news_endpoint():
    symbol = flask_request.args.get("symbol", "")
    limit  = int(flask_request.args.get("limit", 20))
    try:
        items = get_relevant_news(symbol, limit)
    except Exception:
        items = []
    return json.dumps(items), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/position/close", methods=["POST"])
def api_position_close():
    denied = _check_api_key()
    if denied: return denied
    data   = flask_request.get_json(force=True) or {}
    symbol = data.get("symbol", "").upper().strip()
    if not symbol:
        return json.dumps({"ok": False, "error": "symbol required"}), 400, \
            {"Content-Type": "application/json"}
    with positions_lock:
        pos = open_positions.get(symbol)
    if not pos:
        return json.dumps({"ok": False, "error": f"No open position for {symbol}"}), 404, \
            {"Content-Type": "application/json"}
    try:
        emergency_close_position(symbol, pos, "API_MANUAL_CLOSE")
        log_audit("POSITION_CLOSE", symbol, user="api")
        return json.dumps({"ok": True, "symbol": symbol}), 200, \
            {"Content-Type": "application/json"}
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)}), 500, \
            {"Content-Type": "application/json"}


@flask_app.route("/api/bot/pause", methods=["POST"])
def api_bot_pause():
    denied = _check_api_key()
    if denied: return denied
    global bot_paused
    with bot_paused_lock:
        bot_paused = True
    log_audit("BOT_PAUSE", "via API")
    return json.dumps({"ok": True, "paused": True}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/bot/resume", methods=["POST"])
def api_bot_resume():
    denied = _check_api_key()
    if denied: return denied
    global bot_paused
    with bot_paused_lock:
        bot_paused = False
    log_audit("BOT_RESUME", "via API")
    return json.dumps({"ok": True, "paused": False}), 200, \
        {"Content-Type": "application/json"}


@flask_app.route("/api/bot/close-all", methods=["POST"])
def api_bot_close_all():
    denied = _check_api_key()
    if denied: return denied
    with positions_lock:
        syms = list(open_positions.keys())
    closed, errors = [], []
    for sym in syms:
        try:
            with positions_lock:
                pos = open_positions.get(sym)
            if pos:
                emergency_close_position(sym, pos, "API_CLOSE_ALL")
                closed.append(sym)
        except Exception as e:
            errors.append(f"{sym}: {e}")
    log_audit("CLOSE_ALL", f"closed={closed}")
    return json.dumps({"ok": True, "closed": closed, "errors": errors}), 200, \
        {"Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# ─── TRADINGVIEW WEBHOOK ─────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

# Format JSON yang dikirim dari TradingView Alert Message:
# {
#   "symbol":     "BTCUSDT",
#   "action":     "BUY",          ← BUY | SELL | CLOSE
#   "price":      {{close}},
#   "confidence": 80,             ← opsional (default 80)
#   "reason":     "RSI oversold", ← opsional
#   "secret":     "xxxxxx"        ← optional API key guard
# }

@flask_app.route("/api/tradingview/webhook", methods=["POST"])
def api_tradingview_webhook():
    """
    Terima sinyal dari TradingView Pine Script Alert.
    Bot akan menjalankan process_signal jika bot tidak di-pause.
    """
    try:
        data = flask_request.get_json(force=True) or {}
    except Exception:
        return json.dumps({"ok": False, "error": "Invalid JSON"}), 400, \
            {"Content-Type": "application/json"}

    # Secret guard — WEBHOOK_SECRET wajib dikonfigurasi; reject semua request jika belum diset
    webhook_secret = _cfg("WEBHOOK_SECRET", "")
    if not webhook_secret:
        return json.dumps({"ok": False, "error": "Webhook not configured (WEBHOOK_SECRET not set)"}), 403, \
            {"Content-Type": "application/json"}
    if data.get("secret", "") != webhook_secret:
        return json.dumps({"ok": False, "error": "Unauthorized"}), 401, \
            {"Content-Type": "application/json"}

    symbol     = str(data.get("symbol", "")).upper().strip()
    action     = str(data.get("action", "")).upper().strip()
    price_raw  = data.get("price", 0)
    confidence = int(data.get("confidence", 80))
    reason     = str(data.get("reason", "TradingView signal"))

    if not symbol or action not in ("BUY", "SELL", "CLOSE"):
        return json.dumps({"ok": False, "error": "symbol dan action (BUY/SELL/CLOSE) wajib diisi"}), 400, \
            {"Content-Type": "application/json"}

    try:
        current_price = float(price_raw)
    except (ValueError, TypeError):
        current_price = 0.0

    # Jika action CLOSE → tutup posisi yang ada
    if action == "CLOSE":
        with positions_lock:
            pos = open_positions.get(symbol)
        if pos:
            threading.Thread(
                target=emergency_close_position,
                args=(symbol, pos, f"TradingView CLOSE signal"),
                daemon=True,
            ).start()
            log_audit("TV_WEBHOOK", f"CLOSE {symbol}")
            return json.dumps({"ok": True, "action": "CLOSE", "symbol": symbol}), 200, \
                {"Content-Type": "application/json"}
        return json.dumps({"ok": True, "action": "CLOSE", "symbol": symbol, "note": "no open position"}), 200, \
            {"Content-Type": "application/json"}

    # Sinyal BUY/SELL → buat signal dict dan jalankan di thread terpisah
    signal = {"decision": action, "confidence": confidence, "reason": reason}

    def _run_tv_signal():
        try:
            df_1m = fetch_market(symbol, "1m", CANDLE_LIMIT)
            if df_1m is None or len(df_1m) < 20:
                logger.warning(f"TV webhook {symbol}: tidak bisa ambil data market")
                return
            df_1m = add_indicators(df_1m)
            price = current_price or float(df_1m.iloc[-1]["close"])
            atr   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
            process_signal(symbol, signal, price, atr, df_1m)
        except Exception as e:
            logger.error(f"TV webhook execute error {symbol}: {e}")

    threading.Thread(target=_run_tv_signal, daemon=True).start()
    log_audit("TV_WEBHOOK", f"{action} {symbol} conf={confidence}%")

    return json.dumps({"ok": True, "action": action, "symbol": symbol,
                       "confidence": confidence}), 200, \
        {"Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# ─── METATRADER 5 (MT5) WEBHOOK ──────────────────────────────────────────────
# ---------------------------------------------------------------------------

# Format JSON yang dikirim dari MT5 Expert Advisor (EA) via HTTP request:
# {
#   "symbol":     "EURUSD",      ← simbol MT5 — USDT pair akan di-map ke Binance/Bybit
#   "action":     "BUY",         ← BUY | SELL | CLOSE
#   "price":      1.08500,
#   "confidence": 75,
#   "reason":     "MA crossover",
#   "secret":     "xxxxxx"       ← opsional, cocokkan dengan WEBHOOK_SECRET
# }
#
# Cara setup EA MT5:
# 1. Buat script Expert Advisor yang memanggil WebRequest ke:
#    POST https://<repl-url>/api/mt5/webhook
#    Content-Type: application/json
# 2. Izinkan URL di MT5: Tools → Options → Expert Advisors → Allow WebRequest
# 3. Isi body sesuai format di atas

@flask_app.route("/api/mt5/webhook", methods=["POST"])
def api_mt5_webhook():
    """
    Terima sinyal dari MetaTrader 5 Expert Advisor via HTTP WebRequest.
    MT5 EA harus diizinkan memanggil URL bot ini (Tools → Options → Expert Advisors).
    """
    try:
        # MT5 kadang kirim form-data atau raw JSON
        if flask_request.is_json:
            data = flask_request.get_json(force=True) or {}
        else:
            # Coba parse dari form data atau raw body
            try:
                data = json.loads(flask_request.data.decode("utf-8"))
            except Exception:
                data = flask_request.form.to_dict()
    except Exception:
        return json.dumps({"ok": False, "error": "Invalid request body"}), 400, \
            {"Content-Type": "application/json"}

    # Secret guard — WEBHOOK_SECRET wajib dikonfigurasi; reject semua request jika belum diset
    webhook_secret = _cfg("WEBHOOK_SECRET", "")
    if not webhook_secret:
        return json.dumps({"ok": False, "error": "Webhook not configured (WEBHOOK_SECRET not set)"}), 403, \
            {"Content-Type": "application/json"}
    if data.get("secret", "") != webhook_secret:
        return json.dumps({"ok": False, "error": "Unauthorized"}), 401, \
            {"Content-Type": "application/json"}

    raw_symbol = str(data.get("symbol", "")).upper().strip()
    action     = str(data.get("action", "")).upper().strip()
    price_raw  = data.get("price", 0)
    confidence = int(data.get("confidence", 75))
    reason     = str(data.get("reason", "MT5 EA signal"))

    if not raw_symbol or action not in ("BUY", "SELL", "CLOSE"):
        return json.dumps({"ok": False, "error": "symbol dan action (BUY/SELL/CLOSE) wajib diisi"}), 400, \
            {"Content-Type": "application/json"}

    # Normalisasi simbol: EURUSD → EURUSDT, BTCUSD → BTCUSDT (kalau belum ada USDT)
    symbol = raw_symbol if raw_symbol.endswith("USDT") else raw_symbol.replace("USD", "") + "USDT"

    try:
        current_price = float(price_raw)
    except (ValueError, TypeError):
        current_price = 0.0

    if action == "CLOSE":
        with positions_lock:
            pos = open_positions.get(symbol)
        if pos:
            threading.Thread(
                target=emergency_close_position,
                args=(symbol, pos, f"MT5 EA CLOSE signal"),
                daemon=True,
            ).start()
            log_audit("MT5_WEBHOOK", f"CLOSE {symbol}")
            return json.dumps({"ok": True, "action": "CLOSE", "symbol": symbol}), 200, \
                {"Content-Type": "application/json"}
        return json.dumps({"ok": True, "action": "CLOSE", "symbol": symbol, "note": "no open position"}), 200, \
            {"Content-Type": "application/json"}

    signal = {"decision": action, "confidence": confidence, "reason": reason}

    def _run_mt5_signal():
        try:
            df_1m = fetch_market(symbol, "1m", CANDLE_LIMIT)
            if df_1m is None or len(df_1m) < 20:
                logger.warning(f"MT5 webhook {symbol}: tidak bisa ambil data market (cek simbol)")
                return
            df_1m = add_indicators(df_1m)
            price = current_price or float(df_1m.iloc[-1]["close"])
            atr   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
            process_signal(symbol, signal, price, atr, df_1m)
        except Exception as e:
            logger.error(f"MT5 webhook execute error {symbol}: {e}")

    threading.Thread(target=_run_mt5_signal, daemon=True).start()
    log_audit("MT5_WEBHOOK", f"{action} {raw_symbol}→{symbol} conf={confidence}%")

    return json.dumps({"ok": True, "action": action, "symbol": symbol,
                       "mt5_symbol": raw_symbol, "confidence": confidence}), 200, \
        {"Content-Type": "application/json"}


# CORS preflight
def _cors_origin_for(request_origin: str | None) -> str:
    """Return the allowed origin string for this request, or empty string."""
    if not request_origin:
        return ""
    for allowed in _CORS_ALLOWED_ORIGINS:
        if allowed and request_origin.startswith(allowed):
            return request_origin
    return ""


def _check_api_key() -> "flask.Response | None":
    """Return a 401 response if the X-Dashboard-Key header is missing or wrong.
    Returns None when the request is authorised.
    If DASHBOARD_API_KEY is not configured the endpoint is disabled (503)."""
    if not DASHBOARD_API_KEY:
        resp = flask_app.make_response(
            (json.dumps({"error": "DASHBOARD_API_KEY not configured — "
                                  "set it in config.json to enable write endpoints"}),
             503, {"Content-Type": "application/json"})
        )
        return resp
    provided = (flask_request.headers.get("X-Dashboard-Key") or
                flask_request.headers.get("Authorization", "").removeprefix("Bearer "))
    if not provided or provided != DASHBOARD_API_KEY:
        return flask_app.make_response(
            (json.dumps({"error": "Unauthorized — provide X-Dashboard-Key header"}),
             401, {"Content-Type": "application/json"})
        )
    return None


@flask_app.after_request
def _add_cors(response):
    origin = flask_request.headers.get("Origin", "")
    allowed = _cors_origin_for(origin)
    if allowed:
        response.headers["Access-Control-Allow-Origin"] = allowed
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,X-Dashboard-Key"
    return response


@flask_app.route("/api/<path:path>", methods=["OPTIONS"])
def _api_options(path):
    origin = flask_request.headers.get("Origin", "")
    allowed = _cors_origin_for(origin)
    headers = {
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Dashboard-Key",
    }
    if allowed:
        headers["Access-Control-Allow-Origin"] = allowed
        headers["Vary"] = "Origin"
    return "", 204, headers


@flask_app.route("/api/events")
def api_events():
    """Server-Sent Events stream — pushes live status + positions every 3 s.
    Auto-closes after 60 events (~3 min); clients reconnect transparently."""
    def generate():
        for _ in range(60):
            try:
                with pairs_lock:
                    n_pairs = len(active_pairs)
                with positions_lock:
                    snap = dict(open_positions)
                with bot_paused_lock:
                    paused = bot_paused
                with _api_weight_lock:
                    weight = _api_weight_1m
                today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                daily = compute_daily_report(today_str)
                positions_list = []
                for sym, pos in snap.items():
                    entry   = pos.get("entry_price", 0)
                    highest = pos.get("highest_price_seen", entry)
                    unrealized_pct = round((highest / entry - 1) * 100, 2) if entry else 0
                    positions_list.append({
                        "symbol":          sym,
                        "qty":             pos.get("qty", 0),
                        "entry_price":     entry,
                        "tp_price":        pos.get("tp_price", 0),
                        "sl_price":        pos.get("sl_price", 0),
                        "original_sl":     pos.get("original_sl_price", pos.get("sl_price", 0)),
                        "highest_price":   highest,
                        "unrealized_pct":  unrealized_pct,
                        "trailing_active": pos.get("trailing_sl_active", False),
                        "breakeven_done":  pos.get("breakeven_done", False),
                        "partial_tp_done": pos.get("partial_tp_done", False),
                        "opened_at":       pos.get("opened_at", ""),
                        "asset_group":     pos.get("asset_group", ""),
                    })
                payload = {
                    "status": {
                        "paused":          paused,
                        "pairs_scanned":   n_pairs,
                        "open_positions":  len(snap),
                        "api_weight_1m":   weight,
                        "daily_pnl":       daily["total_pnl"],
                        "daily_wins":      daily["wins"],
                        "daily_losses":    daily["losses"],
                        "daily_win_rate":  daily["win_rate"],
                        "testnet":         BINANCE_TESTNET,
                        "live_mode":       LIVE_MODE,
                        "confidence_min":  CONFIDENCE_THRESHOLD,
                        "capital_pct":     CAPITAL_ALLOCATION_PCT,
                        "max_positions":   MAX_CONCURRENT_POSITIONS,
                        "trailing_sl":     TRAILING_SL_ENABLED,
                    },
                    "positions": positions_list,
                }
                yield f"data: {json.dumps(payload)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            time.sleep(3)
        yield 'data: {"close": true}\n\n'

    origin = flask_request.headers.get("Origin", "")
    allowed = _cors_origin_for(origin)
    headers = {
        "Content-Type":    "text/event-stream",
        "Cache-Control":   "no-cache",
        "X-Accel-Buffering": "no",
        "Connection":      "keep-alive",
    }
    if allowed:
        headers["Access-Control-Allow-Origin"] = allowed
        headers["Vary"] = "Origin"
    return flask_app.response_class(generate(), headers=headers)


@flask_app.route("/api/auth/required")
def api_auth_required():
    """Returns whether a DASHBOARD_API_KEY is configured on the backend."""
    return json.dumps({"required": bool(DASHBOARD_API_KEY)}), 200, {"Content-Type": "application/json"}


@flask_app.route("/api/auth/verify", methods=["POST"])
def api_auth_verify():
    """Validate a dashboard API key. Returns {valid: bool}."""
    if not DASHBOARD_API_KEY:
        return json.dumps({"valid": False, "reason": "not_configured"}), 200, {"Content-Type": "application/json"}
    data = flask_request.get_json(silent=True) or {}
    key = data.get("key", "")
    valid = bool(key) and key == DASHBOARD_API_KEY
    return json.dumps({"valid": valid}), 200, {"Content-Type": "application/json"}


def run_flask():
    port = int(os.getenv("PORT", 3000))
    flask_app.run(host="0.0.0.0", port=port, use_reloader=False, threaded=True)

# ---------------------------------------------------------------------------
# ─── 0. DAFTAR PAIR (SEMUA USDT DI BINANCE) ─────────────────────────────────
# ---------------------------------------------------------------------------

_HTML_TAG_RE = re.compile(r"<[^<]+?>")

def _clean_html(text: str, max_len: int = 220) -> str:
    text = _HTML_TAG_RE.sub("", text or "").strip()
    text = " ".join(text.split())
    return text[:max_len].rstrip() + ("…" if len(text) > max_len else "")


def _fetch_feeds(feeds: list[str], category: str) -> list[dict]:
    """Ambil headline dari daftar URL RSS dengan tag kategori tertentu."""
    import feedparser
    items = []
    for url in feeds:
        try:
            feed = feedparser.parse(url)
            source = feed.feed.get("title", url)
            for entry in feed.entries[:10]:
                items.append({
                    "title":     entry.get("title", "").strip(),
                    "summary":   _clean_html(entry.get("summary", "")),
                    "link":      entry.get("link", ""),
                    "source":    source,
                    "published": entry.get("published", ""),
                    "category":  category,
                })
        except Exception as e:
            logger.warning(f"Gagal ambil RSS {url}: {e}")
    return items


def fetch_crypto_news() -> list[dict]:
    """Ambil headline dari semua RSS feed: crypto, forex, dan saham."""
    items  = _fetch_feeds(NEWS_FEEDS,       "crypto")
    items += _fetch_feeds(NEWS_FEEDS_FOREX, "forex")
    items += _fetch_feeds(NEWS_FEEDS_SAHAM, "saham")
    return items


def _post_news_item(n: dict) -> None:
    """Posting headline ke topic sesuai kategorinya (crypto/forex/saham)."""
    category = n.get("category", "crypto")
    topic_id = _news_topic_for_category(category)
    emoji    = {"crypto": "🪙", "forex": "💱", "saham": "📊"}.get(category, "📰")
    text = f"{emoji} *{n['source']}*\n\n*{n['title']}*"
    if n.get("summary"):
        text += f"\n\n{n['summary']}"
    if n.get("link"):
        text += f"\n\n🔗 {n['link']}"
    send_telegram_message(text, topic_id=topic_id)


def news_refresher_loop() -> None:
    """Refresh cache berita tiap NEWS_REFRESH_SEC detik di background, dan posting
    headline baru ke topic masing-masing kategori (crypto/forex/saham) secara real-time."""
    global latest_news
    first_run       = True
    all_feeds_count = len(NEWS_FEEDS) + len(NEWS_FEEDS_FOREX) + len(NEWS_FEEDS_SAHAM)
    while True:
        try:
            items = fetch_crypto_news()
            if items:
                # Simpan hanya crypto ke latest_news — dipakai AI untuk konteks sinyal
                crypto_items = [n for n in items if n.get("category") == "crypto"]
                with news_lock:
                    latest_news = crypto_items or items

                new_items = [n for n in items if n["link"] and n["link"] not in seen_news_links]
                for n in items:
                    if n["link"]:
                        seen_news_links.add(n["link"])

                if new_items and not first_run:
                    # Hanya posting kalau topic-nya sudah terkonfigurasi
                    postable = [
                        n for n in new_items
                        if _news_topic_for_category(n.get("category", "crypto"))
                    ]
                    for n in list(reversed(postable))[-MAX_NEW_NEWS_PER_CYCLE:]:
                        _post_news_item(n)
                        time.sleep(1.5)  # hindari rate-limit Telegram

                n_crypto = len([n for n in items if n.get("category") == "crypto"])
                n_forex  = len([n for n in items if n.get("category") == "forex"])
                n_saham  = len([n for n in items if n.get("category") == "saham"])
                logger.info(
                    f"📰 Berita ter-update: {len(items)} headline dari {all_feeds_count} sumber "
                    f"(crypto={n_crypto}, forex={n_forex}, saham={n_saham}), {len(new_items)} baru"
                )
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


def _apply_priority(pairs: list[str]) -> list[str]:
    """Pindahkan PRIORITY_PAIRS ke depan, sisanya tetap urut di belakang."""
    if not PRIORITY_PAIRS:
        return pairs
    priority = [p for p in PRIORITY_PAIRS if p in pairs]
    rest     = [p for p in pairs if p not in set(PRIORITY_PAIRS)]
    return priority + rest


def refresh_pairs() -> None:
    """Refresh daftar pair yang dipindai — dipanggil di startup & tiap 1 jam."""
    global active_pairs
    if TRADING_PAIRS_ENV.upper() == "ALL":
        if ACTIVE_EXCHANGE == "mexc":
            fetched = fetch_mexc_pairs()
            exch_label = "MEXC"
        elif ACTIVE_EXCHANGE == "bybit":
            fetched = fetch_bybit_pairs()
            exch_label = "Bybit"
        else:
            fetched = fetch_usdt_pairs()
            exch_label = "Binance"
        if fetched:
            ordered = _apply_priority(fetched)
            with pairs_lock:
                active_pairs = ordered
            priority_note = (
                f" (prioritas: {', '.join(PRIORITY_PAIRS)})" if PRIORITY_PAIRS else ""
            )
            logger.info(f"📈 Memindai SEMUA pair USDT {exch_label}: {len(ordered)} pair{priority_note}")
        else:
            logger.warning("⚠️ Gagal refresh daftar pair — pakai daftar lama/fallback")
            with pairs_lock:
                if not active_pairs:
                    active_pairs = _apply_priority(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"])
    else:
        explicit = [p.strip().upper() for p in TRADING_PAIRS_ENV.split(",") if p.strip()]
        ordered  = _apply_priority(explicit)
        with pairs_lock:
            active_pairs = ordered
        logger.info(f"📈 Memindai pair dari TRADING_PAIRS: {', '.join(ordered)}")


def pairs_refresher_loop() -> None:
    while True:
        time.sleep(3600)
        refresh_pairs()

# ---------------------------------------------------------------------------
# ─── 1. FETCH MARKET DATA ───────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def fetch_market(symbol: str, interval: str = CANDLE_INTERVAL,
                  limit: int = CANDLE_LIMIT) -> Optional[pd.DataFrame]:
    """Route ke MEXC, Bybit, atau Binance sesuai ACTIVE_EXCHANGE."""
    if ACTIVE_EXCHANGE == "mexc":
        return fetch_mexc_market(symbol, interval, limit)
    if ACTIVE_EXCHANGE == "bybit":
        return fetch_bybit_market(symbol, interval, limit)
    global _api_weight_1m  # diperbarui dari response header Binance
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}

    for attempt in range(3):
        try:
            # Guard: periksa API weight sebelum request baru
            with _api_weight_lock:
                w = _api_weight_1m
            if w >= BINANCE_WEIGHT_PAUSE:
                logger.warning(f"⚠️ API weight kritis ({w}/1200) — tunggu 10s sebelum request")
                time.sleep(10)
            elif w >= BINANCE_WEIGHT_WARN:
                time.sleep(0.5)  # slow down saja

            r = requests.get(url, params=params, timeout=10)

            # Catat used-weight dari header Binance
            weight_hdr = r.headers.get("x-mbx-used-weight-1m")
            if weight_hdr:
                with _api_weight_lock:
                    _api_weight_1m = int(weight_hdr)

            if r.status_code == 429:
                retry_after = int(r.headers.get("Retry-After", 30))
                logger.warning(f"🚫 Rate-limited Binance ({symbol}), tunggu {retry_after}s …")
                time.sleep(retry_after)
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
# ─── CORRELATION / ASSET GROUP FILTER ────────────────────────────────────────
# ---------------------------------------------------------------------------

# Grup aset berdasarkan ekosistem / korelasi tinggi
_ASSET_GROUPS: dict[str, list[str]] = {
    "btc":     ["BTC"],
    "eth":     ["ETH", "WETH"],
    "bnb":     ["BNB"],
    "solana":  ["SOL", "BONK", "JTO", "PYTH", "WIF", "BOME", "JUP", "RNDR"],
    "l2":      ["MATIC", "POL", "ARB", "OP", "STRK", "MANTA", "BLAST"],
    "defi":    ["UNI", "AAVE", "CRV", "COMP", "MKR", "SNX", "BAL", "1INCH"],
    "ai":      ["FET", "AGIX", "OCEAN", "RNDR", "TAO", "WLD", "GRT"],
    "gaming":  ["AXS", "SAND", "MANA", "GALA", "IMX", "PIXEL", "PORTAL"],
    "meme":    ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "BOME", "NEIRO"],
    "xrp":     ["XRP", "XLM"],
    "ada":     ["ADA", "DOT", "ATOM"],
    "avax":    ["AVAX"],
    "link":    ["LINK"],
}

def _get_asset_group(symbol: str) -> str:
    """Kembalikan nama grup aset untuk simbol ini (misal 'meme', 'defi', dll.)"""
    base = symbol.replace("USDT", "")
    for group, assets in _ASSET_GROUPS.items():
        if base in assets:
            return group
    return f"other_{base[:3]}"  # satu grup unik per aset yang tidak dikenal


def _is_position_allowed(symbol: str) -> tuple[bool, str]:
    """Cek apakah boleh buka posisi baru:
    1. Total posisi < MAX_CONCURRENT_POSITIONS
    2. Posisi di grup aset ini < MAX_POSITIONS_PER_GROUP
    Return (allowed, reason)"""
    with positions_lock:
        n_total = len(open_positions)
        group = _get_asset_group(symbol)
        n_group = sum(
            1 for s in open_positions
            if _get_asset_group(s) == group
        )

    if n_total >= MAX_CONCURRENT_POSITIONS:
        return False, f"terlalu banyak posisi terbuka ({n_total}/{MAX_CONCURRENT_POSITIONS})"
    if n_group >= MAX_POSITIONS_PER_GROUP:
        return False, f"sudah {n_group} posisi di grup '{group}'"
    return True, ""

# ---------------------------------------------------------------------------
# ─── 2. HITUNG INDIKATOR TEKNIKAL ───────────────────────────────────────────
# ---------------------------------------------------------------------------

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Hitung indikator teknikal. Gunakan pandas-ta untuk indikator tambahan
    (Bollinger Bands, Supertrend, Williams %R, VWAP, Stochastic).
    Kolom lama (sma20/sma50/rsi14/macd_hist/atr14) tetap dipertahankan
    agar kode downstream tidak rusak.
    """
    close = df["close"]
    high  = df["high"]
    low   = df["low"]

    # ── Indikator dasar (manual, tetap untuk backward compat) ─────────────────
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

    # ── Indikator tambahan via pandas-ta ─────────────────────────────────────
    try:
        import pandas_ta as ta  # type: ignore

        # Bollinger Bands (20, 2σ)
        bb = ta.bbands(close, length=20, std=2)
        if bb is not None and not bb.empty:
            df["bb_upper"] = bb.get("BBU_20_2.0", float("nan"))
            df["bb_mid"]   = bb.get("BBM_20_2.0", float("nan"))
            df["bb_lower"] = bb.get("BBL_20_2.0", float("nan"))
            df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / df["bb_mid"]

        # Williams %R (oversold <-80, overbought >-20)
        df["willr14"] = ta.willr(high, low, close, length=14)

        # Stochastic K/D
        stoch = ta.stoch(high, low, close)
        if stoch is not None and not stoch.empty:
            df["stoch_k"] = stoch.get("STOCHk_14_3_3", float("nan"))
            df["stoch_d"] = stoch.get("STOCHd_14_3_3", float("nan"))

        # EMA 200 (tren jangka panjang)
        df["ema200"] = ta.ema(close, length=200)

        # VWAP (jika ada kolom volume)
        if "volume" in df.columns:
            df["vwap"] = ta.vwap(high, low, close, df["volume"])

    except Exception as _ta_err:
        logger.debug(f"pandas-ta indikator tambahan dilewati: {_ta_err}")

    return df


def is_interesting(df: pd.DataFrame) -> bool:
    """
    Pre-filter murah (tanpa AI) untuk mempersempit ratusan pair jadi
    beberapa kandidat yang layak dikirim ke AI. Menghindari boros
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
# ─── REGIME DETECTION ───────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def detect_market_regime(df_1m: pd.DataFrame,
                         df_5m: Optional[pd.DataFrame] = None,
                         df_15m: Optional[pd.DataFrame] = None) -> dict:
    """
    Deteksi regime pasar: BULL / BEAR / SIDEWAYS / HIGH_VOL.

    Pakai TF tertinggi yang tersedia (15m > 5m > 1m) sebagai acuan tren utama.
    HIGH_VOL override semua kalau ATR% ekstrem (sinyal sering jadi noise).

    Return:
        regime      : "BULL" | "BEAR" | "SIDEWAYS" | "HIGH_VOL"
        strength    : "strong" | "moderate" | "weak"
        conf_adjust : int  — tambah ke threshold (positif=lebih ketat, negatif=lebih longgar)
        description : str  — ringkasan untuk prompt AI
    """
    df = (df_15m if (df_15m is not None and len(df_15m) >= 50) else
          df_5m  if (df_5m  is not None and len(df_5m)  >= 50) else df_1m)

    last  = df.iloc[-1]
    close = float(last.get("close", 0) or 0)
    if close <= 0:
        return {"regime": "SIDEWAYS", "strength": "weak",
                "conf_adjust": 12, "description": "↔️ SIDEWAYS: data tidak valid"}

    rsi    = float(last.get("rsi14",    50)    or 50)
    sma20  = float(last.get("sma20",    close) or close)
    sma50  = float(last.get("sma50",    close) or close)
    ema200 = float(last.get("ema200",   0)     or 0)
    atr    = float(last.get("atr14",    0)     or 0)
    macd_h = float(last.get("macd_hist", 0)   or 0)

    # ── HIGH_VOL: ATR > 2.5% dari harga ──────────────────────────────────
    atr_pct = (atr / close * 100) if close > 0 else 0
    if atr_pct > 2.5:
        strength = "strong" if atr_pct > 4.0 else "moderate"
        return {
            "regime":      "HIGH_VOL",
            "strength":    strength,
            "conf_adjust": 10,
            "description": f"⚡ HIGH_VOL: ATR {atr_pct:.1f}% — volatilitas ekstrem, noise tinggi",
        }

    # ── Hitung sinyal bull vs bear ────────────────────────────────────────
    bull = 0; bear = 0; total = 0

    total += 1
    if sma20 > sma50 * 1.001:   bull += 1
    elif sma20 < sma50 * 0.999: bear += 1

    total += 1
    if rsi > 55:    bull += 1
    elif rsi < 45:  bear += 1

    total += 1
    if macd_h > 0:   bull += 1
    elif macd_h < 0: bear += 1

    if ema200 > 0:
        total += 1
        if close > ema200 * 1.005:   bull += 1
        elif close < ema200 * 0.995: bear += 1

    bull_ratio = bull / total if total else 0.5
    bear_ratio = bear / total if total else 0.5

    if bull_ratio >= 0.70:
        strength = "strong" if bull_ratio >= 0.85 else "moderate"
        return {
            "regime":      "BULL",
            "strength":    strength,
            "conf_adjust": -5 if strength == "strong" else 0,
            "description": (
                f"🟢 BULL {strength}: {bull}/{total} sinyal bullish | "
                f"RSI={rsi:.0f} SMA20{'>'if sma20>sma50 else '<'}SMA50"
            ),
        }
    elif bear_ratio >= 0.70:
        strength = "strong" if bear_ratio >= 0.85 else "moderate"
        return {
            "regime":      "BEAR",
            "strength":    strength,
            "conf_adjust": +10,
            "description": (
                f"🔴 BEAR {strength}: {bear}/{total} sinyal bearish | "
                f"RSI={rsi:.0f} SMA20{'<'if sma20<sma50 else '>'}SMA50"
            ),
        }
    else:
        return {
            "regime":      "SIDEWAYS",
            "strength":    "weak",
            "conf_adjust": +12,
            "description": (
                f"↔️ SIDEWAYS: sinyal mixed ({bull}B/{bear}S/{total}T) | RSI={rsi:.0f}"
            ),
        }


# ---------------------------------------------------------------------------
# ─── MULTI-TIMEFRAME CONFLUENCE SCORE ────────────────────────────────────────
# ---------------------------------------------------------------------------

def calc_confluence_score(df_1m: pd.DataFrame,
                          df_5m: Optional[pd.DataFrame] = None,
                          df_15m: Optional[pd.DataFrame] = None) -> dict:
    """
    Hitung skor konfluensi arah sinyal antar timeframe (0–100%).

    Bobot TF: 15m=3, 5m=2, 1m=1 (total max 6 poin).
    Tiap TF voting BULLISH / BEARISH / NEUTRAL berdasarkan RSI, MACD, SMA.

    Return:
        score     : float 0.0–1.0  — seberapa kompak semua TF sepakat
        direction : "BULLISH" | "BEARISH" | "MIXED"
        boost     : int  — langsung ditambahkan ke confidence AI
        detail    : str  — ringkasan per-TF untuk prompt
    """
    def _tf_vote(df: Optional[pd.DataFrame], label: str) -> tuple:
        if df is None or len(df) < 3:
            return "NEUTRAL", f"[{label}] no data"
        last = df.iloc[-1]; prev = df.iloc[-2]
        rsi    = float(last.get("rsi14",    50) or 50)
        macd_h = float(last.get("macd_hist", 0) or 0)
        prev_h = float(prev.get("macd_hist", 0) or 0)
        sma20  = float(last.get("sma20", 0) or 0)
        sma50  = float(last.get("sma50", 0) or 0)

        b = 0; s = 0
        if rsi < 45:                              b += 1
        elif rsi > 55:                            s += 1
        if macd_h > 0 and macd_h >= prev_h:      b += 1
        elif macd_h < 0 and macd_h <= prev_h:    s += 1
        if sma20 > 0 and sma50 > 0:
            if sma20 > sma50:                    b += 1
            elif sma20 < sma50:                  s += 1

        if b > s:
            return "BULLISH",  f"[{label}] BULLISH ({b}B/{s}S) RSI={rsi:.0f}"
        elif s > b:
            return "BEARISH",  f"[{label}] BEARISH ({b}B/{s}S) RSI={rsi:.0f}"
        else:
            return "NEUTRAL",  f"[{label}] NEUTRAL RSI={rsi:.0f}"

    tfs = [("15m", df_15m, 3), ("5m", df_5m, 2), ("1m", df_1m, 1)]
    w_bull = 0; w_bear = 0; w_total = 0; notes = []

    for label, df, w in tfs:
        direction, note = _tf_vote(df, label)
        notes.append(note)
        if direction == "BULLISH":   w_bull += w
        elif direction == "BEARISH": w_bear += w
        w_total += w

    dominant = max(w_bull, w_bear)
    score    = dominant / w_total if w_total > 0 else 0.5
    direction = ("BULLISH" if w_bull > w_bear else
                 "BEARISH" if w_bear > w_bull else "MIXED")

    if score >= 0.85:   boost = +8    # semua TF kompak → bonus confidence
    elif score >= 0.67: boost = +3    # mayoritas sepakat
    elif score >= 0.50: boost = 0
    else:               boost = -15   # TF berlawanan → penalty confidence

    detail = " | ".join(notes) + f" | Konfluensi: {score*100:.0f}% {direction}"
    return {
        "score":     round(score, 2),
        "direction": direction,
        "boost":     boost,
        "detail":    detail,
    }


# ---------------------------------------------------------------------------
# ─── FEEDBACK LOOP: PERFORMA PER-PAIR ────────────────────────────────────────
# ---------------------------------------------------------------------------

_pair_feedback_cache: dict = {}
_pair_feedback_lock  = threading.Lock()
PAIR_FEEDBACK_LOOKBACK = 15   # analisis N trade closed terakhir per pair
PAIR_FEEDBACK_TTL      = 3600  # cache 1 jam supaya tidak query SQLite tiap detik


def db_get_pair_trades(symbol: str, n: int = 20) -> list:
    """Ambil N trade closed terakhir untuk simbol tertentu dari SQLite."""
    try:
        with _db_lock:
            with sqlite3.connect(DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("""
                    SELECT result, pnl, confidence FROM trades
                    WHERE symbol = ?
                      AND result IN ('CLOSED_TP','CLOSED_SL','EARLY_EXIT')
                    ORDER BY id DESC LIMIT ?
                """, (symbol, n)).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"SQLite get_pair_trades gagal ({symbol}): {e}")
        return []


def get_pair_feedback(symbol: str) -> dict:
    """
    Analisis performa historis pair ini dari trade database.

    Bot belajar dari hasil trade sendiri:
    - Pair konsisten profit → confidence boost kecil
    - Pair konsisten rugi   → confidence penalty (threshold lebih ketat)
    - Belum cukup data      → tidak ada adjustment

    Return:
        win_rate    : float 0.0–1.0
        trade_count : int
        adj         : int  — tambahkan ke confidence (negatif = lebih ketat)
        label       : "outperforming" | "normal" | "underperforming" | "unknown"
        description : str
    """
    with _pair_feedback_lock:
        cached = _pair_feedback_cache.get(symbol, {})
        if cached and (time.time() - cached.get("_ts", 0)) < PAIR_FEEDBACK_TTL:
            return {k: v for k, v in cached.items() if not k.startswith("_")}

    trades = db_get_pair_trades(symbol, PAIR_FEEDBACK_LOOKBACK)
    count  = len(trades)

    if count < 3:
        result = {
            "win_rate":    0.5,
            "trade_count": count,
            "adj":         0,
            "label":       "unknown",
            "description": f"📊 {symbol}: data belum cukup ({count} trade) — confidence normal",
        }
    else:
        wins = sum(
            1 for t in trades
            if t.get("result") == "CLOSED_TP"
            or (t.get("result") == "EARLY_EXIT" and (t.get("pnl") or 0) >= 0)
        )
        wr = wins / count

        if wr >= 0.65:
            adj, label = +5,  "outperforming"
            desc = f"🌟 {symbol}: WR {wr*100:.0f}% dari {count} trade → confidence +{adj}"
        elif wr >= 0.45:
            adj, label = 0,   "normal"
            desc = f"📊 {symbol}: WR {wr*100:.0f}% dari {count} trade → normal"
        elif wr >= 0.30:
            adj, label = -10, "underperforming"
            desc = f"⚠️ {symbol}: WR {wr*100:.0f}% dari {count} trade → confidence {adj}"
        else:
            adj, label = -20, "underperforming"
            desc = f"🔴 {symbol}: WR {wr*100:.0f}% — sangat jelek → confidence {adj}"

        result = {
            "win_rate":    round(wr, 3),
            "trade_count": count,
            "adj":         adj,
            "label":       label,
            "description": desc,
        }

    with _pair_feedback_lock:
        _pair_feedback_cache[symbol] = {**result, "_ts": time.time()}
    return result


# ---------------------------------------------------------------------------
# ─── 3. ANALISIS AI (9Router – conversational, ingat history) ───────────────
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


# ---------------------------------------------------------------------------
# ─── FEAR & GREED INDEX (alternative.me — gratis, tanpa API key) ─────────────
# ---------------------------------------------------------------------------

_fear_greed_cache: dict = {}
_fear_greed_lock  = threading.Lock()

def get_fear_greed_index() -> dict:
    """
    Ambil Crypto Fear & Greed Index dari alternative.me.
    Di-cache 1 jam. Return: {"value": 0-100, "label": "Extreme Fear/Fear/Neutral/Greed/Extreme Greed"}
    """
    with _fear_greed_lock:
        now = time.time()
        if _fear_greed_cache and now - _fear_greed_cache.get("_ts", 0) < 3600:
            return _fear_greed_cache
    try:
        r = requests.get("https://api.alternative.me/fng/", timeout=10)
        r.raise_for_status()
        data = r.json()["data"][0]
        result = {
            "value": int(data["value"]),
            "label": data["value_classification"],
            "_ts":   time.time(),
        }
        with _fear_greed_lock:
            _fear_greed_cache.update(result)
        return result
    except Exception as e:
        logger.debug(f"Fear & Greed fetch error: {e}")
        return {"value": 50, "label": "Neutral", "_ts": 0}


# ---------------------------------------------------------------------------
# ─── VADER SENTIMENT SCORING ─────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _score_news_sentiment(headlines: list) -> float:
    """
    Hitung skor sentimen headline berita pakai VADER.
    Return: -1.0 (sangat negatif) s.d. +1.0 (sangat positif).
    Fallback 0.0 jika library tidak tersedia.
    """
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer  # type: ignore
        analyzer = SentimentIntensityAnalyzer()
        scores = [analyzer.polarity_scores(h)["compound"] for h in headlines if h]
        return round(sum(scores) / len(scores), 4) if scores else 0.0
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# ─── 9ROUTER GATEWAY HELPER ──────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _call_9router(
    messages: list,
    model: str = "",
    max_tokens: int = 350,
    temperature: float = 0.2,
) -> str:
    """
    Kirim request ke 9Router (OpenAI-compatible gateway).
    Semua AI traffic harus lewat fungsi ini — jangan panggil SDK
    SDK AI lain secara langsung.
    Return: string response mentah; raise Exception jika error.
    """
    url     = f"{AI_BASE_URL}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if AI_API_KEY:
        headers["Authorization"] = f"Bearer {AI_API_KEY}"
    payload: dict = {
        "model":       model or AI_MODEL,
        "messages":    messages,
        "max_tokens":  max_tokens,
        "temperature": temperature,
    }
    resp = requests.post(url, headers=headers, json=payload,
                         timeout=AI_TIMEOUT_MS / 1000)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def ask_ai(symbol: str, df_1m: pd.DataFrame,
           df_5m: Optional[pd.DataFrame] = None,
           df_15m: Optional[pd.DataFrame] = None,
           funding: Optional[dict] = None,
           oi_change: Optional[dict] = None,
           regime: Optional[dict] = None,
           confluence: Optional[dict] = None,
           feedback: Optional[dict] = None) -> dict:
    """
    Kirim data multi-TF + futures data + berita + regime + confluence + feedback ke 9Router.
    Return: { "decision": "BUY"|"SELL"|"HOLD", "reason": str, "confidence": int }
    """
    global conversation_history

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

    # ── Berita + Sentimen VADER ──────────────────────────────────────────────
    news_items = get_relevant_news(symbol)
    news_block = ""
    if news_items:
        headlines = [n["title"] for n in news_items]
        sentiment_score = _score_news_sentiment(headlines)
        sentiment_label = (
            "📈 Positif" if sentiment_score > 0.05 else
            "📉 Negatif" if sentiment_score < -0.05 else "😐 Netral"
        )
        news_block = (
            f"\nBerita terkini (VADER skor: {sentiment_score:+.2f} {sentiment_label}):\n"
            + "\n".join(f"  - {n['title']} ({n['source']})" for n in news_items)
        )

    # ── Fear & Greed Index ───────────────────────────────────────────────────
    fg = get_fear_greed_index()
    fg_block = (
        f"\nFear & Greed Index: {fg['value']}/100 → {fg['label']}\n"
        f"  (< 25 = Extreme Fear, > 75 = Extreme Greed — perhatikan kontrarian!)"
    )

    # ── Regime Pasar ─────────────────────────────────────────────────────────
    regime_block = ""
    if regime:
        regime_block = (
            f"\nRegime Pasar: {regime['description']}\n"
            f"  Adjustment threshold: {regime['conf_adjust']:+d} poin confidence"
        )

    # ── Konfluensi Multi-Timeframe ────────────────────────────────────────────
    confluence_block = ""
    if confluence:
        confluence_block = (
            f"\nKonfluensi TF: {confluence['detail']}\n"
            f"  Skor: {confluence['score']*100:.0f}% → boost confidence {confluence['boost']:+d}"
        )

    # ── Feedback Loop: Performa Pair Ini ─────────────────────────────────────
    feedback_block = ""
    if feedback:
        feedback_block = (
            f"\nFeedback Historis: {feedback['description']}"
        )

    user_msg = (
        f"=== ANALISIS {symbol} [{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}] ===\n"
        f"\n— MULTI-TIMEFRAME OHLCV + INDIKATOR —{tf_blocks}"
        f"\n\n— RISK-REWARD SETUP —{rr_block}"
        f"\n\n— FUTURES DATA —{futures_block}"
        f"\n\n— MARKET SENTIMENT —{fg_block}"
        + (f"\n\n— REGIME PASAR —{regime_block}" if regime_block else "")
        + (f"\n\n— KONFLUENSI TIMEFRAME —{confluence_block}" if confluence_block else "")
        + (f"\n\n— FEEDBACK HISTORIS PAIR —{feedback_block}" if feedback_block else "")
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

            raw = _call_9router(messages, model=AI_MODEL, max_tokens=350, temperature=0.2)
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
            logger.error(f"9Router AI error ({symbol}, attempt {attempt+1}): {e}")
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

def ask_ai_openrouter(symbol: str, df_1m: pd.DataFrame, primary_signal: dict,
                       df_5m: Optional[pd.DataFrame] = None,
                       df_15m: Optional[pd.DataFrame] = None,
                       funding: Optional[dict] = None,
                       oi_change: Optional[dict] = None) -> dict:
    """
    Validator-1 via 9Router (model: AI_VALIDATOR_MODEL, default Claude Sonnet).
    """
    if not AI_BASE_URL:
        return primary_signal

    # ── Blok multi-timeframe ────────────────────────────────────────────────
    tf_blocks = (
        _build_tf_block("1m — Primary Entry", df_1m, 5)
        + _build_tf_block("5m — Momentum Confirmation", df_5m, 3)
        + _build_tf_block("15m — Trend Direction", df_15m, 3)
    )
    atr_now   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
    price_now = float(df_1m.iloc[-1]["close"])
    futures_block = ""
    if funding:
        futures_block = f"\nFutures: FR={funding['funding_rate_pct']:+.4f}% → {funding['sentiment']}"
    if oi_change:
        futures_block += f" | OI {oi_change['oi_change_pct']:+.3f}% ({oi_change['trend']})"
    if not futures_block:
        futures_block = "\nFutures: tidak tersedia (spot-only)"

    news_items = get_relevant_news(symbol)
    news_block = ""
    if news_items:
        score = _score_news_sentiment([n["title"] for n in news_items])
        news_block = (
            f"\nBerita (VADER {score:+.2f}):\n"
            + "\n".join(f"  - {n['title']}" for n in news_items[:3])
        )

    fg = get_fear_greed_index()
    user_msg = (
        f"=== VALIDASI {symbol} [{datetime.now(timezone.utc).strftime('%H:%M UTC')}] ===\n"
        f"\n— MULTI-TIMEFRAME —{tf_blocks}"
        f"\n\n— RISK-REWARD —\nATR14={atr_now:.6f} | "
        f"TP={price_now + TP_ATR_MULT*atr_now:.6f} | "
        f"SL={price_now - SL_ATR_MULT*atr_now:.6f} | "
        f"R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}"
        f"\n\n— FUTURES —{futures_block}"
        f"\n\n— SENTIMENT — Fear&Greed={fg['value']} ({fg['label']})"
        + (f"\n\n— BERITA —{news_block}" if news_block else "")
        + f"\n\n— SINYAL AI PERTAMA —\n"
        f"  Keputusan : {primary_signal['decision']} ({primary_signal['confidence']}%)\n"
        f"  Alasan    : {primary_signal['reason']}\n\n"
        f"Verifikasi independen. Jawab hanya JSON."
    )

    raw = ""
    for attempt in range(3):
        try:
            raw = _call_9router(
                [{"role": "system", "content": SYSTEM_PROMPT_VALIDATOR},
                 {"role": "user",   "content": user_msg}],
                model=AI_VALIDATOR_MODEL,
                max_tokens=250,
                temperature=0.2,
            )
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json").strip()
            result = json.loads(raw)
            result["confidence"] = int(result.get("confidence", 0))
            result["decision"]   = result.get("decision", "HOLD").upper()
            logger.info(f"Validator-1 ({AI_VALIDATOR_MODEL}) → {symbol} {result['decision']} ({result['confidence']}%)")
            return result
        except json.JSONDecodeError:
            logger.warning(f"Validator-1 bukan JSON ({symbol}, attempt {attempt+1}): {raw}")
        except Exception as e:
            logger.error(f"Validator-1 9Router error ({symbol}, attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)

    return {"decision": "HOLD", "reason": "Validator-1 gagal", "confidence": 0}


# ---------------------------------------------------------------------------
# ─── VALIDATOR: OpenAI GPT-4o ────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def ask_ai_openai_validator(symbol: str, df_1m: pd.DataFrame, primary_signal: dict,
                              df_5m=None, df_15m=None, funding=None, oi_change=None):
    """Validator-2 via 9Router (model: AI_VALIDATOR_MODEL2, default GPT-4o)."""
    if not AI_BASE_URL:
        return None
    try:
        tf_blocks = (
            _build_tf_block("1m — Primary", df_1m, 5)
            + _build_tf_block("5m — Momentum", df_5m, 3)
            + _build_tf_block("15m — Trend", df_15m, 3)
        )
        atr_now   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
        price_now = float(df_1m.iloc[-1]["close"])
        fg = get_fear_greed_index()
        user_msg = (
            f"=== VALIDASI {symbol} [{datetime.now(timezone.utc).strftime('%H:%M UTC')}] ===\n"
            f"\n— MULTI-TIMEFRAME —{tf_blocks}\n"
            f"\n— RISK-REWARD —\nATR14={atr_now:.6f} | "
            f"TP={price_now + TP_ATR_MULT*atr_now:.6f} | "
            f"SL={price_now - SL_ATR_MULT*atr_now:.6f} | "
            f"R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}\n"
            f"\n— SENTIMENT — Fear&Greed={fg['value']} ({fg['label']})\n"
            f"\n— SINYAL AI PERTAMA —\n"
            f"{primary_signal['decision']} ({primary_signal['confidence']}%): {primary_signal['reason']}\n\n"
            f'Verifikasi independen. Jawab hanya JSON: {{"decision":"BUY|SELL|HOLD","confidence":0-100,"reason":"..."}}'
        )
        raw = _call_9router(
            [{"role": "system", "content": SYSTEM_PROMPT_VALIDATOR},
             {"role": "user",   "content": user_msg}],
            model=AI_VALIDATOR_MODEL2,
            max_tokens=200,
            temperature=0.2,
        )
        if "```" in raw:
            raw = raw.split("```")[1].lstrip("json").strip()
        result = json.loads(raw)
        result["confidence"] = int(result.get("confidence", 0))
        result["decision"]   = result.get("decision", "HOLD").upper()
        logger.info(f"Validator-2 ({AI_VALIDATOR_MODEL2}) → {symbol} {result['decision']} ({result['confidence']}%)")
        return result
    except Exception as e:
        logger.error(f"Validator-2 9Router error ({symbol}): {e}")
        return None


# ---------------------------------------------------------------------------
# ─── VALIDATOR: Claude Sonnet (Anthropic direct API) ─────────────────────────
# ---------------------------------------------------------------------------

def ask_ai_claude_direct_validator(symbol: str, df_1m: pd.DataFrame, primary_signal: dict,
                                    df_5m=None, df_15m=None, funding=None, oi_change=None):
    """Validator-3 via 9Router (AI_VALIDATOR_MODEL second pass, news-focused)."""
    if not AI_BASE_URL:
        return None
    try:
        tf_blocks = (
            _build_tf_block("1m — Primary", df_1m, 5)
            + _build_tf_block("5m — Momentum", df_5m, 3)
            + _build_tf_block("15m — Trend", df_15m, 3)
        )
        atr_now   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
        price_now = float(df_1m.iloc[-1]["close"])
        fg = get_fear_greed_index()
        news_items = get_relevant_news(symbol)
        sentiment_note = ""
        if news_items:
            score = _score_news_sentiment([n["title"] for n in news_items])
            sentiment_note = f"\nNews VADER skor: {score:+.2f}"
        user_msg = (
            f"=== VALIDASI INDEPENDEN {symbol} [{datetime.now(timezone.utc).strftime('%H:%M UTC')}] ===\n"
            f"\n— MULTI-TIMEFRAME —{tf_blocks}\n"
            f"\n— RISK-REWARD —\nATR14={atr_now:.6f} | "
            f"TP={price_now + TP_ATR_MULT*atr_now:.6f} | "
            f"SL={price_now - SL_ATR_MULT*atr_now:.6f} | "
            f"R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}\n"
            f"\n— SENTIMENT — Fear&Greed={fg['value']} ({fg['label']}){sentiment_note}\n"
            f"\n— SINYAL AI PERTAMA —\n"
            f"{primary_signal['decision']} ({primary_signal['confidence']}%): {primary_signal['reason']}\n\n"
            f'Verifikasi independen. Jawab hanya JSON: {{"decision":"BUY|SELL|HOLD","confidence":0-100,"reason":"..."}}'
        )
        raw = _call_9router(
            [{"role": "system", "content": SYSTEM_PROMPT_VALIDATOR},
             {"role": "user",   "content": user_msg}],
            model=AI_VALIDATOR_MODEL,
            max_tokens=200,
            temperature=0.35,
        )
        if "```" in raw:
            raw = raw.split("```")[1].lstrip("json").strip()
        result = json.loads(raw)
        result["confidence"] = int(result.get("confidence", 0))
        result["decision"]   = result.get("decision", "HOLD").upper()
        logger.info(f"Validator-3 ({AI_VALIDATOR_MODEL} pass-2) → {symbol} {result['decision']} ({result['confidence']}%)")
        return result
    except Exception as e:
        logger.error(f"Validator-3 9Router error ({symbol}): {e}")
        return None


# ---------------------------------------------------------------------------
# ─── VALIDATOR: Google Gemini ────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def ask_ai_gemini_validator(symbol: str, df_1m: pd.DataFrame, primary_signal: dict,
                             df_5m=None, df_15m=None, funding=None, oi_change=None):
    """Validator-4 via 9Router (model: AI_VALIDATOR_MODEL3, default Gemini Flash)."""
    if not AI_BASE_URL:
        return None
    try:
        tf_blocks = (
            _build_tf_block("1m — Primary", df_1m, 5)
            + _build_tf_block("5m — Momentum", df_5m, 3)
            + _build_tf_block("15m — Trend", df_15m, 3)
        )
        atr_now   = float(df_1m.iloc[-1].get("atr14", 0) or 0)
        price_now = float(df_1m.iloc[-1]["close"])
        fg = get_fear_greed_index()
        prompt = (
            SYSTEM_PROMPT_VALIDATOR + "\n\n"
            f"=== VALIDASI {symbol} [{datetime.now(timezone.utc).strftime('%H:%M UTC')}] ===\n"
            f"\n— MULTI-TIMEFRAME —{tf_blocks}\n"
            f"\n— RISK-REWARD —\nATR14={atr_now:.6f} | "
            f"TP={price_now + TP_ATR_MULT*atr_now:.6f} | "
            f"SL={price_now - SL_ATR_MULT*atr_now:.6f} | "
            f"R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}\n"
            f"\n— SENTIMENT — Fear&Greed={fg['value']} ({fg['label']})\n"
            f"\n— SINYAL AI PERTAMA —\n"
            f"{primary_signal['decision']} ({primary_signal['confidence']}%): {primary_signal['reason']}\n\n"
            f'Verifikasi independen. Jawab hanya JSON: {{"decision":"BUY|SELL|HOLD","confidence":0-100,"reason":"..."}}'
        )
        raw = _call_9router(
            [{"role": "user", "content": prompt}],
            model=AI_VALIDATOR_MODEL3,
            max_tokens=200,
            temperature=0.2,
        )
        if "```" in raw:
            raw = raw.split("```")[1].lstrip("json").strip()
        result = json.loads(raw)
        result["confidence"] = int(result.get("confidence", 0))
        result["decision"]   = result.get("decision", "HOLD").upper()
        logger.info(f"Validator-4 ({AI_VALIDATOR_MODEL3}) → {symbol} {result['decision']} ({result['confidence']}%)")
        return result
    except Exception as e:
        logger.error(f"Validator-4 9Router error ({symbol}): {e}")
        return None


# ---------------------------------------------------------------------------
# ─── MULTI-AI CONSENSUS (Primary + Validators via 9Router) ───────────────────
# ---------------------------------------------------------------------------

def run_multi_ai_consensus(symbol: str, df_1m: pd.DataFrame, primary_signal: dict,
                            df_5m=None, df_15m=None, funding=None, oi_change=None) -> dict:
    """
    Jalankan semua validator AI secara paralel.
    Return: {
      "decision": "BUY"|"SELL"|"HOLD",
      "confidence": int (rata-rata dari model yang setuju),
      "votes": { "BUY": n, "SELL": n, "HOLD": n },
      "models": { "ModelName": {"decision": ..., "confidence": ..., "reason": ...} },
      "total_responding": int,
      "passed": bool  (True jika majority agree on BUY/SELL)
    }
    """
    validators = {
        "9Router/Validator-1": lambda: ask_ai_openrouter(
            symbol, df_1m, primary_signal,
            df_5m=df_5m, df_15m=df_15m, funding=funding, oi_change=oi_change),
        "9Router/Validator-3": lambda: ask_ai_claude_direct_validator(
            symbol, df_1m, primary_signal,
            df_5m=df_5m, df_15m=df_15m, funding=funding, oi_change=oi_change),
        "9Router/Validator-2": lambda: ask_ai_openai_validator(
            symbol, df_1m, primary_signal,
            df_5m=df_5m, df_15m=df_15m, funding=funding, oi_change=oi_change),
        "9Router/Validator-4": lambda: ask_ai_gemini_validator(
            symbol, df_1m, primary_signal,
            df_5m=df_5m, df_15m=df_15m, funding=funding, oi_change=oi_change),
    }

    results: dict = {}
    threads = []

    def _run(name, fn):
        try:
            results[name] = fn()
        except Exception as e:
            logger.error(f"Validator {name} crashed: {e}")
            results[name] = None

    for name, fn in validators.items():
        t = threading.Thread(target=_run, args=(name, fn), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join(timeout=45)  # max 45 detik per validator

    # Gabungkan dengan 9Router/Primary sebagai suara pertama
    all_models = {"9Router/Primary": primary_signal}
    for name, res in results.items():
        if res is not None:
            all_models[name] = res

    votes: dict = {"BUY": [], "SELL": [], "HOLD": []}
    for name, res in all_models.items():
        decision = res.get("decision", "HOLD").upper()
        if decision not in votes:
            decision = "HOLD"
        votes[decision].append((name, res.get("confidence", 0)))

    total = len(all_models)
    n_buy  = len(votes["BUY"])
    n_sell = len(votes["SELL"])

    # Majority: lebih dari setengah model agree pada BUY atau SELL
    majority_decision = "HOLD"
    majority_confs    = []
    if n_buy > total / 2:
        majority_decision = "BUY"
        majority_confs    = [c for _, c in votes["BUY"]]
    elif n_sell > total / 2:
        majority_decision = "SELL"
        majority_confs    = [c for _, c in votes["SELL"]]

    avg_conf = int(sum(majority_confs) / len(majority_confs)) if majority_confs else 0
    passed   = majority_decision in ("BUY", "SELL")

    return {
        "decision":         majority_decision,
        "confidence":       avg_conf,
        "votes":            {k: len(v) for k, v in votes.items()},
        "models":           all_models,
        "total_responding": total,
        "passed":           passed,
    }


# ---------------------------------------------------------------------------
# ─── CHART GENERATOR ─────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def generate_price_chart(symbol: str, interval: str = "1h", limit: int = 72) -> Optional[str]:
    """
    Ambil OHLCV dari Binance public API, buat chart candlestick gelap,
    simpan ke temp PNG. Return path file atau None jika error.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import tempfile

        # Fetch OHLCV
        r = requests.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": symbol.upper(), "interval": interval, "limit": limit},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        if not data or len(data) < 5:
            return None

        opens   = [float(c[1]) for c in data]
        highs   = [float(c[2]) for c in data]
        lows    = [float(c[3]) for c in data]
        closes  = [float(c[4]) for c in data]
        volumes = [float(c[5]) for c in data]
        xs      = list(range(len(data)))

        # Indikator sederhana
        sma20 = [sum(closes[max(0, i-19):i+1]) / min(20, i+1) for i in range(len(closes))]
        sma50 = [sum(closes[max(0, i-49):i+1]) / min(50, i+1) for i in range(len(closes))]

        BG    = "#0f0f23"
        GREEN = "#26a69a"
        RED   = "#ef5350"

        fig, (ax1, ax2) = plt.subplots(
            2, 1, figsize=(13, 8),
            gridspec_kw={"height_ratios": [3, 1]},
            facecolor=BG,
        )
        for ax in (ax1, ax2):
            ax.set_facecolor(BG)
            for spine in ax.spines.values():
                spine.set_color("#2a2a3e")
            ax.tick_params(colors="#777777", labelsize=8)

        # Candlesticks
        for i in xs:
            col = GREEN if closes[i] >= opens[i] else RED
            ax1.plot([i, i], [lows[i], highs[i]], color=col, linewidth=0.7, alpha=0.9)
            ax1.bar(i, abs(closes[i] - opens[i]),
                    bottom=min(opens[i], closes[i]),
                    width=0.65, color=col, alpha=0.95)

        # SMA
        ax1.plot(xs, sma20, color="#ffa726", linewidth=1.3, label="SMA20", alpha=0.9)
        ax1.plot(xs, sma50, color="#42a5f5", linewidth=1.3, label="SMA50", alpha=0.9)
        ax1.legend(loc="upper left", facecolor="#1a1a2e", labelcolor="white",
                   framealpha=0.8, fontsize=8)

        # Harga terakhir
        last_close  = closes[-1]
        change_pct  = ((last_close - closes[0]) / closes[0]) * 100
        sign        = "+" if change_pct >= 0 else ""
        ax1.set_title(
            f"{symbol}  ·  {last_close:.4f} USDT  ({sign}{change_pct:.2f}%)",
            color="white", fontsize=13, pad=10, fontweight="bold",
        )
        ax1.set_ylabel("Harga (USDT)", color="#777777", fontsize=9)
        ax1.tick_params(axis="x", labelbottom=False)
        ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:.4f}"))

        # Harga line terakhir
        ax1.axhline(last_close, color="#ffd54f", linewidth=0.8, linestyle="--", alpha=0.6)

        # Volume
        vol_colors = [GREEN if closes[i] >= opens[i] else RED for i in xs]
        ax2.bar(xs, volumes, color=vol_colors, alpha=0.55, width=0.75)
        ax2.set_ylabel("Volume", color="#777777", fontsize=8)
        ax2.set_xlabel(
            f"Interval: {interval}  ·  {limit} candle terakhir  ·  "
            f"{datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}",
            color="#555555", fontsize=7,
        )

        plt.tight_layout(pad=1.5)

        tmp = tempfile.NamedTemporaryFile(
            suffix=".png", delete=False, prefix=f"chart_{symbol}_"
        )
        plt.savefig(tmp.name, dpi=130, bbox_inches="tight",
                    facecolor=BG, edgecolor="none")
        plt.close(fig)
        return tmp.name

    except Exception as e:
        logger.error(f"generate_price_chart ({symbol}): {e}")
        return None


def send_telegram_photo(image_path: str, caption: str = "",
                         topic_id=None, chat_id=None) -> Optional[dict]:
    """Kirim gambar ke Telegram via sendPhoto."""
    try:
        url     = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
        payload = {"chat_id": chat_id or TELEGRAM_CHAT_ID}
        if topic_id:
            payload["message_thread_id"] = topic_id
        if caption:
            payload["caption"]    = caption
            payload["parse_mode"] = "Markdown"
        with open(image_path, "rb") as f:
            resp = requests.post(url, data=payload, files={"photo": f}, timeout=30)
        return resp.json() if resp.ok else None
    except Exception as e:
        logger.error(f"send_telegram_photo error: {e}")
        return None
    finally:
        try:
            import os as _os_tmp
            _os_tmp.unlink(image_path)
        except Exception:
            pass


def ask_ai_chat(user_text: str, user_name: str = "User") -> str:
    """
    Percakapan bebas via 9Router (AI_MODEL).
    Support history conversation untuk konteks multi-turn.
    """
    global conversation_history
    user_msg = f"[{user_name}]: {user_text}"

    with history_lock:
        messages = (
            [{"role": "system", "content": SYSTEM_PROMPT_TRADING}]
            + conversation_history
            + [{"role": "user", "content": user_msg}]
        )

    try:
        reply = _call_9router(messages, model=AI_MODEL, max_tokens=800, temperature=0.7)
        logger.debug(f"ask_ai_chat: replied via 9Router ({AI_MODEL})")
    except Exception as e:
        logger.error(f"ask_ai_chat 9Router error: {e}")
        return f"Maaf, AI (9Router) sedang tidak bisa dihubungi: {e}"

    with history_lock:
        conversation_history.append({"role": "user",      "content": user_msg})
        conversation_history.append({"role": "assistant",  "content": reply})
        _trim_history()

    return reply

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

                # FIX 1: Markdown parse error — retry tanpa parse_mode (plain text)
                if "can't parse entities" in desc and "parse_mode" in payload:
                    logger.warning("⚠️ Markdown parse error — retry tanpa parse_mode (plain text)")
                    payload_plain = {k: v for k, v in payload.items() if k != "parse_mode"}
                    r2 = requests.post(url, json=payload_plain, timeout=10)
                    if r2.ok:
                        return r2.json()
                    logger.error(f"Telegram plain-text retry juga gagal: {r2.status_code}")
                    return None

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

def send_trend_message(text: str, decision: str = "HOLD", symbol: str = "") -> None:
    if decision == "BUY":
        topic = TELEGRAM_BULL_TOPIC_ID
    elif decision == "SELL":
        topic = TELEGRAM_BEAR_TOPIC_ID
    elif decision == "HOLD":
        topic = TELEGRAM_HOLD_TOPIC_ID
    else:
        sentiment = _detect_sentiment(text)
        topic = TELEGRAM_BULL_TOPIC_ID if sentiment == "bull" else TELEGRAM_BEAR_TOPIC_ID
    send_telegram_message(text, topic_id=topic)
    # Kirim duplikat ke Hot Coin untuk priority pair
    if TELEGRAM_HOT_COIN_TOPIC_ID and symbol and symbol.upper() in [p.upper() for p in PRIORITY_PAIRS]:
        send_telegram_message(text, topic_id=TELEGRAM_HOT_COIN_TOPIC_ID)


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
    global bot_paused
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

    if cmd == "/start":
        if not _is_allowed(chat_id):
            return
        with bot_paused_lock:
            was_paused = bot_paused
            bot_paused = False
        force_scan_event.set()
        with pairs_lock:
            n_pairs = len(active_pairs)
        resume_note = " \\(bot sudah di\\-unpause\\)" if was_paused else ""
        send_telegram_message(
            f"🚀 *Bot mulai analisis sekarang\\!*{resume_note}\n\n"
            f"Memindai `{n_pairs}` pair USDT langsung saat ini\\.\n"
            f"Sinyal buy/sell akan muncul jika AI menemukan peluang\\.\n\n"
            f"_Gunakan `/stop` untuk mematikan bot sepenuhnya\\._",
            topic_id=thread_id,
            chat_id=chat_id,
        )
        return

    if cmd == "/stop":
        if not _is_allowed(chat_id):
            return
        send_telegram_message(
            "🛑 *Bot dimatikan\\.*\n\nProses dihentikan sepenuhnya\\. "
            "Restart bot secara manual untuk menghidupkan kembali\\.",
            topic_id=thread_id,
            chat_id=chat_id,
        )
        time.sleep(1)
        import os as _os
        _os._exit(0)
        return

    if cmd == "/help":
        with pairs_lock:
            n_pairs = len(active_pairs)
        with positions_lock:
            n_pos = len(open_positions)
        with bot_paused_lock:
            paused = bot_paused
        mode_icon = "🟡" if BINANCE_TESTNET else ("🔴" if LIVE_MODE else "🔵")
        pause_note = "\n⏸ *BOT SEDANG DIPAUSE* — ketik `/start` untuk lanjut" if paused else ""
        n_ai_models = 1 + sum(bool(k) for k in [AI_VALIDATOR_MODEL, AI_VALIDATOR_MODEL2, AI_VALIDATOR_MODEL3])
        send_telegram_message(
            f"🤖 *Trading Bot AI*{pause_note}\n\n"
            f"Mode  : {mode_icon} {'TESTNET' if BINANCE_TESTNET else ('LIVE' if LIVE_MODE else 'Simulasi')}\n"
            f"Pair  : `{n_pairs}` USDT tiap `{CANDLE_INTERVAL}`\n"
            f"Posisi: `{n_pos}/{MAX_CONCURRENT_POSITIONS}` terbuka\n"
            f"AI    : `{n_ai_models}` model via 9Router \\(Primary \\+ Validator\\)\n\n"
            "*⚡ Perintah utama:*\n"
            "`/start`         — paksa analisis sekarang\n"
            "`/stop`          — matikan bot sepenuhnya\n"
            "`/pause`         — hentikan trading sementara\n"
            "`/resume`        — lanjutkan trading\n\n"
            "*📊 Pantau dari sini:*\n"
            "`/monitor`       — status bot, saldo, semua posisi\n"
            "`/chart SYMBOL`  — grafik candlestick \\(misal `/chart BTCUSDT 4h`\\)\n"
            "`/saldo`         — saldo & portfolio akun\n"
            "`/posisi`        — daftar posisi terbuka\n"
            "`/laporan`       — laporan P&L hari ini\n"
            "`/tutup SYMBOL`  — tutup posisi \\(misal `/tutup BTCUSDT`\\)\n"
            "`/tutupall`      — tutup semua posisi\n\n"
            "*💬 Perintah lain:*\n"
            "`/berita`   — headline crypto terbaru\n"
            "`/pairs`    — jumlah pair dipindai\n"
            "`/history`  — cek memory AI\n"
            "`/reset`    — hapus memory AI\n\n"
            "_💬 Chat bebas juga bisa — tanya apapun soal market atau minta chart_",
            topic_id=thread_id,
            chat_id=chat_id,
        )
        return

    if cmd in ("/saldo", "/balance", "/wallet"):
        if not (LIVE_MODE and BINANCE_API_KEY):
            send_telegram_message("⚠️ Cek saldo hanya tersedia di LIVE\\_MODE\\.", topic_id=thread_id, chat_id=chat_id)
            return
        portfolio = get_binance_portfolio()
        send_telegram_message(format_portfolio_text(portfolio), topic_id=thread_id, chat_id=chat_id)
        return

    if cmd in ("/posisi", "/positions", "/pos"):
        with positions_lock:
            snap = dict(open_positions)
        if not snap:
            send_telegram_message(
                "📭 *Tidak ada posisi terbuka saat ini\\.*",
                topic_id=thread_id, chat_id=chat_id,
            )
            return
        lines = [f"📂 *Posisi terbuka ({len(snap)}):*\n"]
        for sym, p in snap.items():
            entry  = p.get("entry_price", 0)
            tp     = p.get("tp_price", 0)
            sl     = p.get("sl_price", 0)
            qty    = p.get("qty", 0)
            opened = p.get("opened_at", "?")[:16].replace("T", " ")
            trailing_note = " 📈trail" if p.get("trailing_sl_active") else ""
            lines.append(
                f"• *`{sym}`*{trailing_note}\n"
                f"  Entry: `{entry}` \\| Qty: `{qty}`\n"
                f"  TP: `{tp}` \\| SL: `{sl}`\n"
                f"  Buka: `{opened} UTC`"
            )
        send_telegram_message("\n\n".join(lines), topic_id=thread_id, chat_id=chat_id)
        return

    if cmd == "/pause":
        if not _is_allowed(chat_id):
            return
        with bot_paused_lock:
            bot_paused = True
        send_telegram_message(
            "⏸ *Bot dipause\\.*\n\nTrading dihentikan sementara\\. "
            "Posisi terbuka tetap dipantau \\(TP/SL/trailing\\)\\.\n"
            "Ketik `/resume` untuk lanjutkan\\.",
            topic_id=thread_id, chat_id=chat_id,
        )
        return

    if cmd == "/resume":
        if not _is_allowed(chat_id):
            return
        with bot_paused_lock:
            bot_paused = False
        with pairs_lock:
            n_pairs = len(active_pairs)
        send_telegram_message(
            f"▶️ *Bot dilanjutkan\\!*\n\nMemindai `{n_pairs}` pair kembali\\.",
            topic_id=thread_id, chat_id=chat_id,
        )
        return

    if cmd == "/tutupall":
        if not _is_allowed(chat_id):
            return
        with positions_lock:
            snap = dict(open_positions)
        if not snap:
            send_telegram_message("📭 Tidak ada posisi terbuka\\.", topic_id=thread_id, chat_id=chat_id)
            return
        send_telegram_message(
            f"🔄 Menutup *{len(snap)}* posisi terbuka\\.\\.\\.",
            topic_id=thread_id, chat_id=chat_id,
        )
        for sym, pos in snap.items():
            threading.Thread(
                target=emergency_close_position,
                args=(sym, pos, "manual /tutupall dari Telegram"),
                daemon=True,
            ).start()
            time.sleep(0.5)
        return

    if cmd == "/tutup":
        if not _is_allowed(chat_id):
            return
        parts = text.split()
        if len(parts) < 2:
            send_telegram_message("⚠️ Format: `/tutup SYMBOL` \\— contoh: `/tutup BTCUSDT`", topic_id=thread_id, chat_id=chat_id)
            return
        target_sym = parts[1].upper()
        with positions_lock:
            pos = open_positions.get(target_sym)
        if not pos:
            send_telegram_message(
                f"❌ Tidak ada posisi terbuka untuk `{target_sym}`\\.",
                topic_id=thread_id, chat_id=chat_id,
            )
            return
        send_telegram_message(
            f"🔄 Menutup posisi `{target_sym}` secara manual\\.\\.\\.",
            topic_id=thread_id, chat_id=chat_id,
        )
        threading.Thread(
            target=emergency_close_position,
            args=(target_sym, pos, "manual /tutup dari Telegram"),
            daemon=True,
        ).start()
        return

    if cmd in ("/chart", "/grafik"):
        parts  = text.split()
        symbol = parts[1].upper() if len(parts) >= 2 else "BTCUSDT"
        if not symbol.endswith("USDT"):
            symbol += "USDT"
        interval = "1h"
        if len(parts) >= 3 and parts[2] in ("1m","5m","15m","1h","4h","1d"):
            interval = parts[2]
        send_telegram_message(
            f"📊 _Membuat chart `{symbol}` interval `{interval}`\\.\\.\\._",
            topic_id=thread_id, chat_id=chat_id,
        )
        img_path = generate_price_chart(symbol, interval=interval, limit=80)
        if img_path:
            send_telegram_photo(
                img_path,
                caption=(
                    f"📊 *{symbol}* — interval `{interval}`\n"
                    f"_Data Binance · {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}_"
                ),
                topic_id=thread_id, chat_id=chat_id,
            )
        else:
            send_telegram_message(
                f"⚠️ Gagal buat chart `{symbol}`\\. Cek nama pair, contoh: `/chart BTCUSDT 1h`",
                topic_id=thread_id, chat_id=chat_id,
            )
        return

    if cmd == "/monitor":
        with bot_paused_lock:
            paused = bot_paused
        with positions_lock:
            snap = dict(open_positions)
        with pairs_lock:
            n_pairs = len(active_pairs)
        mode_icon = "🟡" if BINANCE_TESTNET else ("🔴" if LIVE_MODE else "🔵")
        status_str = "⏸ DIPAUSE" if paused else "✅ Aktif"
        n_ai_models = 1 + sum(bool(k) for k in [AI_VALIDATOR_MODEL, AI_VALIDATOR_MODEL2, AI_VALIDATOR_MODEL3])
        lines_pos = []
        for sym, p in snap.items():
            entry  = p.get("entry_price", 0)
            tp     = p.get("tp_price", 0)
            sl     = p.get("sl_price", 0)
            trail  = " 📈trail" if p.get("trailing_sl_active") else ""
            lines_pos.append(f"  • `{sym}`{trail}: entry=`{entry}` TP=`{tp}` SL=`{sl}`")
        pos_block = ("\n" + "\n".join(lines_pos)) if lines_pos else " _tidak ada_"
        saldo_txt = ""
        if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY):
            eq = get_exchange_equity()
            saldo_txt = f"\n💰 Saldo USDT   : `{eq:.4f}`"
        send_telegram_message(
            f"📡 *Status Bot — Real\\-time*\n\n"
            f"Status   : {status_str}\n"
            f"Mode     : {mode_icon} {'TESTNET' if BINANCE_TESTNET else ('LIVE' if LIVE_MODE else 'Simulasi')}\n"
            f"AI aktif : `{n_ai_models}` model via 9Router \\(Primary \\+ Validator\\)\n"
            f"Pair     : memindai `{n_pairs}` pair"
            f"{saldo_txt}\n\n"
            f"📂 *Posisi terbuka \\({len(snap)}\\):*{pos_block}\n\n"
            f"_Gunakan `/chart SYMBOL` untuk lihat grafik harga_",
            topic_id=thread_id, chat_id=chat_id,
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
    """Handle chat — deteksi request chart dan kirim gambar, atau balas teks biasa."""
    # ── Deteksi permintaan chart ──────────────────────────────────────────────
    _CHART_KEYWORDS = ("chart", "grafik", "gambar", "candlestick", "candle",
                       "lihat harga", "tampilkan harga", "harga sekarang")
    lower_text = text.lower()
    is_chart_request = any(kw in lower_text for kw in _CHART_KEYWORDS)

    if is_chart_request:
        # Coba ekstrak symbol dari teks (kata kapital berakhiran USDT, BTC, ETH, dll)
        import re as _re
        sym_match = _re.search(r'\b([A-Z]{2,10}USDT|[A-Z]{2,10}BTC|[A-Z]{2,10}ETH)\b', text.upper())
        # Atau cari kata sembarang setelah keyword chart
        if not sym_match:
            # Coba cari pair apapun setelah kata kunci
            after_kw = _re.search(
                r'(?:chart|grafik|gambar|candle)\s+([a-zA-Z]{2,10})', lower_text
            )
            if after_kw:
                raw_sym = after_kw.group(1).upper()
                if not raw_sym.endswith("USDT"):
                    raw_sym += "USDT"
                sym_match = type("M", (), {"group": lambda s, n=1: raw_sym})()

        if sym_match:
            symbol = sym_match.group(1) if callable(sym_match.group) else sym_match.group(1)
            # Tentukan interval — default 1h
            interval = "1h"
            if any(k in lower_text for k in ("15m", "15 menit")):
                interval = "15m"
            elif any(k in lower_text for k in ("4h", "4 jam")):
                interval = "4h"
            elif any(k in lower_text for k in ("1d", "harian", "daily")):
                interval = "1d"

            send_telegram_message(
                f"📊 _Membuat chart {symbol} interval {interval}\\.\\.\\._",
                chat_id=chat_id, topic_id=thread_id,
            )
            img_path = generate_price_chart(symbol, interval=interval, limit=80)
            if img_path:
                send_telegram_photo(
                    img_path,
                    caption=f"📊 *{symbol}* — interval `{interval}`\n_Data dari Binance Public API_",
                    topic_id=thread_id, chat_id=chat_id,
                )
                return
            else:
                send_telegram_message(
                    f"⚠️ Gagal buat chart untuk `{symbol}`\\. Coba lagi atau cek nama pair\\.",
                    chat_id=chat_id, topic_id=thread_id,
                )
                return
        else:
            send_telegram_message(
                "📊 Mau lihat chart pair apa? Contoh: _\"chart BTCUSDT\"_ atau _\"grafik ETHUSDT 4h\"_",
                chat_id=chat_id, topic_id=thread_id,
            )
            return

    # ── Balas teks biasa via AI ───────────────────────────────────────────────
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
                # FIX 2: 409 Conflict — instance bot lain masih aktif.
                # Coba force-delete webhook lagi lalu backoff exponential.
                _conflict_wait = min(60, 15 * (2 ** getattr(update_poller, '_conflict_count', 0)))
                update_poller._conflict_count = getattr(update_poller, '_conflict_count', 0) + 1
                logger.warning(
                    f"⚠️ 409 Conflict: ada instance bot lain (#{update_poller._conflict_count}). "
                    f"Coba force-delete webhook & tunggu {_conflict_wait}s..."
                )
                try:
                    requests.post(
                        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/deleteWebhook",
                        json={"drop_pending_updates": True},
                        timeout=10,
                    )
                except Exception:
                    pass
                time.sleep(_conflict_wait)
                continue
            update_poller._conflict_count = 0  # reset counter kalau sukses
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

def make_binance_client():
    """Buat Binance Client — otomatis arahkan ke testnet kalau BINANCE_TESTNET=true."""
    from binance.client import Client
    if BINANCE_TESTNET:
        return Client(BINANCE_API_KEY, BINANCE_API_SECRET, testnet=True)
    return Client(BINANCE_API_KEY, BINANCE_API_SECRET)


def get_binance_equity() -> float:
    """Ambil saldo USDT (free + locked). Dipakai untuk kalkulasi qty order."""
    try:
        client = make_binance_client()
        account = client.get_account()
        for b in account.get("balances", []):
            if b["asset"] == "USDT":
                return float(b["free"]) + float(b["locked"])
    except Exception as e:
        logger.warning(f"Tidak bisa ambil equity Binance: {e}")
    return 0.0


def get_binance_portfolio() -> dict:
    """
    Ambil semua aset non-nol dari akun Binance (berguna di testnet yang
    punya BTC/ETH/BNB/USDT dari awal).
    Return: {
        "usdt_free": float,
        "usdt_locked": float,
        "total_usdt": float,          # USDT + estimasi nilai aset lain
        "assets": [{"asset", "free", "locked", "usdt_value"}],
        "error": str | None,
    }
    """
    try:
        client = make_binance_client()
        account = client.get_account()
        balances = account.get("balances", [])

        # Ambil harga ticker sekaligus untuk konversi ke USDT
        ticker_map: dict[str, float] = {}
        try:
            prices = client.get_all_tickers()
            ticker_map = {p["symbol"]: float(p["price"]) for p in prices}
        except Exception:
            pass  # kalau gagal, nilai non-USDT dihitung 0

        assets = []
        usdt_free = usdt_locked = 0.0
        total_usdt = 0.0

        for b in balances:
            asset = b["asset"]
            free   = float(b["free"])
            locked = float(b["locked"])
            total  = free + locked
            if total < 1e-9:
                continue

            if asset == "USDT":
                usdt_free   = free
                usdt_locked = locked
                usdt_val    = total
            else:
                # Coba konversi lewat pasangan xUSDT
                usdt_val = ticker_map.get(f"{asset}USDT", 0.0) * total

            total_usdt += usdt_val
            assets.append({
                "asset":      asset,
                "free":       free,
                "locked":     locked,
                "usdt_value": round(usdt_val, 4),
            })

        assets.sort(key=lambda x: x["usdt_value"], reverse=True)
        return {
            "usdt_free":   usdt_free,
            "usdt_locked": usdt_locked,
            "total_usdt":  round(total_usdt, 4),
            "assets":      assets,
            "error":       None,
        }
    except Exception as e:
        logger.warning(f"get_binance_portfolio error: {e}")
        return {"usdt_free": 0.0, "usdt_locked": 0.0, "total_usdt": 0.0,
                "assets": [], "error": str(e)}


def format_portfolio_text(portfolio: dict, max_assets: int = 8) -> str:
    """Format portfolio untuk dikirim ke Telegram (MarkdownV2-safe)."""
    if portfolio.get("error"):
        return f"⚠️ Tidak bisa ambil saldo: {portfolio['error']}"

    lines = [f"💰 *Saldo Akun {'TESTNET' if BINANCE_TESTNET else 'LIVE'}*\n"]
    for a in portfolio["assets"][:max_assets]:
        locked_str = f" \\(+{a['locked']:.4f} locked\\)" if a["locked"] > 0 else ""
        usdt_str   = f" ≈ `{a['usdt_value']:.2f} USDT`" if a["asset"] != "USDT" else ""
        lines.append(
            f"• `{a['asset']}`: `{a['free']:.6f}`{locked_str}{usdt_str}"
        )
    lines.append(f"\n📊 *Total estimasi*: `{portfolio['total_usdt']:.2f} USDT`")
    return "\n".join(lines)


def execute_binance(symbol: str, side: str, qty: float) -> dict:
    client = make_binance_client()
    for attempt in range(3):
        try:
            order = client.order_market(symbol=symbol, side=side, quantity=qty)
            logger.info(f"Binance order: {order}")
            return order
        except Exception as e:
            err_str = str(e)
            logger.error(f"Binance order error (attempt {attempt+1}): {e}")

            # FIX 3: Saldo tidak cukup (-2010) — tidak perlu retry, langsung notif Telegram
            if "-2010" in err_str or "insufficient balance" in err_str.lower():
                top_up_hint = (
                    "Testnet: top\\-up di testnet\\.binance\\.vision"
                    if BINANCE_TESTNET else
                    "Live: pastikan saldo USDT cukup di akun Binance"
                )
                send_telegram_message(
                    f"⚠️ *Saldo tidak cukup \\— order dibatalkan*\n\n"
                    f"Pair : `{symbol}` \\| Sisi : `{side}` \\| Qty : `{qty}`\n\n"
                    f"💡 {top_up_hint}"
                )
                raise RuntimeError(f"Saldo tidak cukup untuk {side} {symbol}: {e}")

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

    client = make_binance_client()
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
            "qty":                      qty,
            "entry_price":              entry_price,
            "tp_order_id":              oco.get("_tp_order_id"),
            "sl_order_id":              oco.get("_sl_order_id"),
            "tp_price":                 oco.get("_tp_price"),
            "sl_price":                 oco.get("_sl_price"),
            "original_sl_price":        oco.get("_sl_price"),   # untuk trailing SL
            "order_list_id":            oco.get("orderListId"),  # untuk cancel OCO sekaligus
            "opened_at":                datetime.now(timezone.utc).isoformat(),
            "reversal_exits_attempted": 0,                       # guard agar tidak loop
            "highest_price_seen":       entry_price,             # tracking untuk trailing SL
            "trailing_sl_active":       False,                   # apakah trailing sudah aktif
            "asset_group":              _get_asset_group(symbol),
        }
    save_state()


def cancel_oco_orders(symbol: str, pos: dict) -> bool:
    """Cancel OCO order list posisi terbuka. Return True kalau berhasil atau sudah tidak ada."""
    client = make_binance_client()
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


# ---------------------------------------------------------------------------
# ─── 5b. MEXC EXCHANGE FUNCTIONS ─────────────────────────────────────────────
# ---------------------------------------------------------------------------

_MEXC_BASE = "https://api.mexc.com"

def _mexc_sign(params: dict) -> dict:
    """Tambahkan timestamp + signature HMAC-SHA256 ke params MEXC."""
    params["timestamp"] = int(time.time() * 1000)
    query = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    sig = hmac.new(MEXC_API_SECRET.encode(), query.encode(), hashlib.sha256).hexdigest()
    params["signature"] = sig
    return params

def _mexc_headers() -> dict:
    return {"X-MEXC-APIKEY": MEXC_API_KEY, "Content-Type": "application/json"}


def fetch_mexc_pairs() -> list[str]:
    """Ambil semua pair spot USDT yang TRADING di MEXC."""
    try:
        r = requests.get(f"{_MEXC_BASE}/api/v3/exchangeInfo", timeout=15)
        r.raise_for_status()
        data = r.json()
        pairs = []
        for s in data.get("symbols", []):
            if s.get("status") != "ENABLED":
                continue
            if s.get("quoteAsset") != "USDT":
                continue
            symbol = s["symbol"]
            base = s.get("baseAsset", "")
            if any(symbol.endswith(suf) for suf in _EXCLUDED_SUFFIXES):
                continue
            if base in _EXCLUDED_BASES:
                continue
            pairs.append(symbol)
        return sorted(pairs)
    except Exception as e:
        logger.error(f"Gagal ambil daftar pair MEXC: {e}")
        return []


def fetch_mexc_market(symbol: str, interval: str = CANDLE_INTERVAL,
                      limit: int = CANDLE_LIMIT) -> Optional[pd.DataFrame]:
    """Ambil klines dari MEXC (format sama dengan Binance)."""
    url = f"{_MEXC_BASE}/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=10)
            if r.status_code == 429:
                time.sleep(30)
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
            logger.warning(f"MEXC fetch error {symbol} (attempt {attempt+1}): {e}")
            time.sleep(1)
    return None


def get_mexc_equity() -> float:
    """Ambil saldo USDT dari akun MEXC."""
    try:
        params = _mexc_sign({})
        r = requests.get(f"{_MEXC_BASE}/api/v3/account",
                         params=params, headers=_mexc_headers(), timeout=10)
        r.raise_for_status()
        data = r.json()
        for b in data.get("balances", []):
            if b["asset"] == "USDT":
                return float(b["free"]) + float(b["locked"])
    except Exception as e:
        logger.warning(f"Tidak bisa ambil equity MEXC: {e}")
    return 0.0


def execute_mexc(symbol: str, side: str, qty: float) -> dict:
    """Eksekusi market order di MEXC."""
    params = _mexc_sign({
        "symbol": symbol,
        "side": side.upper(),
        "type": "MARKET",
        "quantity": str(qty),
    })
    for attempt in range(3):
        try:
            r = requests.post(f"{_MEXC_BASE}/api/v3/order",
                              params=params, headers=_mexc_headers(), timeout=10)
            r.raise_for_status()
            order = r.json()
            logger.info(f"MEXC order: {order}")
            return order
        except Exception as e:
            logger.error(f"MEXC order error (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)
    raise RuntimeError("MEXC order gagal setelah 3 kali coba")


def place_mexc_tp_sl(symbol: str, qty: float, entry_price: float,
                     atr: float = 0.0) -> Optional[dict]:
    """MEXC tidak support OCO identik Binance — pasang LIMIT sell (TP) saja.
    SL ditangani position monitor + emergency_close."""
    try:
        if atr > 0:
            tp_price = round(entry_price + TP_ATR_MULT * atr, 8)
        else:
            tp_price = round(entry_price * (1 + TP_PCT / 100), 8)
        sl_price = round(
            entry_price - SL_ATR_MULT * atr if atr > 0 else entry_price * (1 - SL_PCT / 100),
            8,
        )
        params = _mexc_sign({
            "symbol": symbol,
            "side": "SELL",
            "type": "LIMIT",
            "quantity": str(qty),
            "price": str(tp_price),
            "timeInForce": "GTC",
        })
        r = requests.post(f"{_MEXC_BASE}/api/v3/order",
                          params=params, headers=_mexc_headers(), timeout=10)
        r.raise_for_status()
        order = r.json()
        order["_tp_price"] = tp_price
        order["_sl_price"] = sl_price
        order["_tp_order_id"] = order.get("orderId")
        order["_sl_order_id"] = None
        order["orderListId"] = None
        logger.info(f"🎯 MEXC LIMIT sell (TP) terpasang {symbol}: TP={tp_price} | SL (monitor)={sl_price}")
        return order
    except Exception as e:
        logger.error(f"MEXC TP order error {symbol}: {e}")
        return None


def cancel_mexc_orders(symbol: str, pos: dict) -> bool:
    """Cancel LIMIT sell (TP) di MEXC jika masih aktif."""
    tp_id = pos.get("tp_order_id")
    if not tp_id:
        return True
    try:
        params = _mexc_sign({"symbol": symbol, "orderId": str(tp_id)})
        r = requests.delete(f"{_MEXC_BASE}/api/v3/order",
                            params=params, headers=_mexc_headers(), timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Gagal cancel MEXC order {tp_id} {symbol}: {e}")
        return False


# ---------------------------------------------------------------------------
# ─── 5c. BYBIT EXCHANGE FUNCTIONS ────────────────────────────────────────────
# ---------------------------------------------------------------------------

_BYBIT_BASE = "https://api.bybit.com"

def _bybit_sign(params: dict) -> tuple[dict, dict]:
    """Buat signature HMAC-SHA256 untuk Bybit V5 API.
    Return: (params, headers)
    """
    timestamp = str(int(time.time() * 1000))
    recv_window = "5000"
    query = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    sign_str = timestamp + BYBIT_API_KEY + recv_window + query
    sig = hmac.new(BYBIT_API_SECRET.encode(), sign_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     BYBIT_API_KEY,
        "X-BAPI-TIMESTAMP":   timestamp,
        "X-BAPI-RECV-WINDOW": recv_window,
        "X-BAPI-SIGN":        sig,
        "Content-Type":       "application/json",
    }
    return params, headers


def _bybit_sign_body(body: dict) -> tuple[str, dict]:
    """Buat signature HMAC-SHA256 untuk Bybit V5 API (POST body JSON)."""
    timestamp = str(int(time.time() * 1000))
    recv_window = "5000"
    body_str = json.dumps(body, separators=(",", ":"))
    sign_str = timestamp + BYBIT_API_KEY + recv_window + body_str
    sig = hmac.new(BYBIT_API_SECRET.encode(), sign_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     BYBIT_API_KEY,
        "X-BAPI-TIMESTAMP":   timestamp,
        "X-BAPI-RECV-WINDOW": recv_window,
        "X-BAPI-SIGN":        sig,
        "Content-Type":       "application/json",
    }
    return body_str, headers


def fetch_bybit_pairs() -> list[str]:
    """Ambil semua spot pair USDT yang aktif di Bybit."""
    try:
        r = requests.get(
            f"{_BYBIT_BASE}/v5/market/instruments-info",
            params={"category": "spot", "status": "Trading"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        pairs = []
        for item in data.get("result", {}).get("list", []):
            sym = item.get("symbol", "")
            if sym.endswith("USDT") and item.get("status") == "Trading":
                base = sym[:-4]
                if any(sym.endswith(suf) for suf in _EXCLUDED_SUFFIXES):
                    continue
                if base in _EXCLUDED_BASES:
                    continue
                pairs.append(sym)
        return sorted(pairs)
    except Exception as e:
        logger.error(f"Gagal ambil daftar pair Bybit: {e}")
        return []


def fetch_bybit_market(symbol: str, interval: str = CANDLE_INTERVAL,
                       limit: int = CANDLE_LIMIT) -> Optional[pd.DataFrame]:
    """Ambil klines dari Bybit V5 spot (konversi ke format Binance-compatible)."""
    # Bybit interval mapping: "1m" → "1", "5m" → "5", "15m" → "15", dll.
    interval_map = {
        "1m": "1", "3m": "3", "5m": "5", "15m": "15",
        "30m": "30", "1h": "60", "2h": "120", "4h": "240",
        "6h": "360", "12h": "720", "1d": "D", "1w": "W",
    }
    bybit_interval = interval_map.get(interval, interval.replace("m", "").replace("h", ""))
    url = f"{_BYBIT_BASE}/v5/market/kline"
    params = {"category": "spot", "symbol": symbol, "interval": bybit_interval, "limit": str(limit)}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=10)
            if r.status_code == 429:
                time.sleep(30)
                continue
            r.raise_for_status()
            data = r.json()
            raw = data.get("result", {}).get("list", [])
            if not raw:
                return None
            # Bybit returns newest first → reverse untuk index time ascending
            raw = list(reversed(raw))
            rows = []
            for candle in raw:
                # [startTime, open, high, low, close, volume, turnover]
                rows.append({
                    "open_time": int(candle[0]),
                    "open":      float(candle[1]),
                    "high":      float(candle[2]),
                    "low":       float(candle[3]),
                    "close":     float(candle[4]),
                    "volume":    float(candle[5]),
                })
            df = pd.DataFrame(rows)
            df["open_time"] = pd.to_datetime(df["open_time"], unit="ms")
            df.set_index("open_time", inplace=True)
            return df[["open", "high", "low", "close", "volume"]]
        except Exception as e:
            logger.warning(f"Bybit fetch error {symbol} (attempt {attempt+1}): {e}")
            time.sleep(1)
    return None


def get_bybit_equity() -> float:
    """Ambil saldo USDT dari akun Bybit Spot."""
    try:
        params = {"accountType": "UNIFIED", "coin": "USDT"}
        _, headers = _bybit_sign(params)
        r = requests.get(
            f"{_BYBIT_BASE}/v5/account/wallet-balance",
            params=params, headers=headers, timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        for acc in data.get("result", {}).get("list", []):
            for coin in acc.get("coin", []):
                if coin.get("coin") == "USDT":
                    return float(coin.get("walletBalance", 0))
    except Exception as e:
        logger.warning(f"Tidak bisa ambil equity Bybit: {e}")
    return 0.0


def execute_bybit(symbol: str, side: str, qty: float) -> dict:
    """Eksekusi market order di Bybit Spot."""
    body = {
        "category": "spot",
        "symbol":   symbol,
        "side":     side.capitalize(),  # "Buy" atau "Sell"
        "orderType": "Market",
        "qty":      str(qty),
    }
    for attempt in range(3):
        try:
            body_str, headers = _bybit_sign_body(body)
            r = requests.post(
                f"{_BYBIT_BASE}/v5/order/create",
                data=body_str, headers=headers, timeout=10,
            )
            r.raise_for_status()
            resp = r.json()
            if resp.get("retCode", -1) != 0:
                raise RuntimeError(f"Bybit error: {resp.get('retMsg')}")
            logger.info(f"Bybit order: {resp}")
            return resp.get("result", {})
        except Exception as e:
            logger.error(f"Bybit order error (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)
    raise RuntimeError("Bybit order gagal setelah 3 kali coba")


def place_bybit_tp_sl(symbol: str, qty: float, entry_price: float,
                      atr: float = 0.0,
                      tp_price_override: Optional[float] = None,
                      sl_price_override: Optional[float] = None) -> Optional[dict]:
    """Pasang LIMIT sell (TP) di Bybit Spot. SL dijaga position monitor.

    Jika tp_price_override / sl_price_override diberikan, nilai itu dipakai langsung
    (untuk trailing SL, breakeven, dan partial TP yang sudah menghitung harga sendiri).
    """
    try:
        if tp_price_override is not None and sl_price_override is not None:
            tp_price = tp_price_override
            sl_price = sl_price_override
        elif atr > 0:
            tp_price = round(entry_price + TP_ATR_MULT * atr, 8)
            sl_price = round(entry_price - SL_ATR_MULT * atr, 8)
        else:
            tp_price = round(entry_price * (1 + TP_PCT / 100), 8)
            sl_price = round(entry_price * (1 - SL_PCT / 100), 8)
        body = {
            "category":  "spot",
            "symbol":    symbol,
            "side":      "Sell",
            "orderType": "Limit",
            "qty":       str(qty),
            "price":     str(tp_price),
            "timeInForce": "GTC",
        }
        body_str, headers = _bybit_sign_body(body)
        r = requests.post(
            f"{_BYBIT_BASE}/v5/order/create",
            data=body_str, headers=headers, timeout=10,
        )
        r.raise_for_status()
        resp = r.json()
        if resp.get("retCode", -1) != 0:
            raise RuntimeError(f"Bybit TP error: {resp.get('retMsg')}")
        order = resp.get("result", {})
        order["_tp_price"]    = tp_price
        order["_sl_price"]    = sl_price
        order["_tp_order_id"] = order.get("orderId")
        order["_sl_order_id"] = None
        order["orderListId"]  = None
        logger.info(f"🎯 Bybit LIMIT sell (TP) terpasang {symbol}: TP={tp_price} | SL (monitor)={sl_price}")
        return order
    except Exception as e:
        logger.error(f"Bybit TP order error {symbol}: {e}")
        return None


def cancel_bybit_orders(symbol: str, pos: dict) -> bool:
    """Cancel LIMIT sell (TP) di Bybit Spot jika masih aktif."""
    tp_id = pos.get("tp_order_id")
    if not tp_id:
        return True
    try:
        body = {"category": "spot", "symbol": symbol, "orderId": str(tp_id)}
        body_str, headers = _bybit_sign_body(body)
        r = requests.post(
            f"{_BYBIT_BASE}/v5/order/cancel",
            data=body_str, headers=headers, timeout=10,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Gagal cancel Bybit order {tp_id} {symbol}: {e}")
        return False


# ---------------------------------------------------------------------------
# ─── 5d. EXCHANGE-AWARE WRAPPERS ─────────────────────────────────────────────
# ---------------------------------------------------------------------------

def get_exchange_equity() -> float:
    """Ambil equity USDT dari exchange yang sedang aktif."""
    if ACTIVE_EXCHANGE == "mexc":
        return get_mexc_equity()
    if ACTIVE_EXCHANGE == "bybit":
        return get_bybit_equity()
    return get_binance_equity()


def execute_exchange(symbol: str, side: str, qty: float) -> dict:
    """Eksekusi market order di exchange yang sedang aktif."""
    if ACTIVE_EXCHANGE == "mexc":
        return execute_mexc(symbol, side, qty)
    if ACTIVE_EXCHANGE == "bybit":
        return execute_bybit(symbol, side, qty)
    return execute_binance(symbol, side, qty)


def place_exchange_tp_sl(symbol: str, qty: float, entry_price: float,
                         atr: float = 0.0) -> Optional[dict]:
    """Pasang TP/SL di exchange yang sedang aktif."""
    if ACTIVE_EXCHANGE == "mexc":
        return place_mexc_tp_sl(symbol, qty, entry_price, atr)
    if ACTIVE_EXCHANGE == "bybit":
        return place_bybit_tp_sl(symbol, qty, entry_price, atr)
    return place_oco_sell(symbol, qty, entry_price, atr)


def cancel_exchange_orders(symbol: str, pos: dict) -> bool:
    """Cancel order TP/SL di exchange yang sedang aktif."""
    if ACTIVE_EXCHANGE == "mexc":
        return cancel_mexc_orders(symbol, pos)
    if ACTIVE_EXCHANGE == "bybit":
        return cancel_bybit_orders(symbol, pos)
    return cancel_oco_orders(symbol, pos)


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

    # Step 1: cancel TP/SL order
    cancel_exchange_orders(symbol, pos)
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
        fill_info = execute_exchange(symbol, "SELL", sell_qty)
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

    # Durasi posisi
    opened_at_str = pos.get("opened_at", "")
    try:
        opened_dt = datetime.fromisoformat(opened_at_str)
        duration_sec = (datetime.now(timezone.utc) - opened_dt).total_seconds()
        duration_str = (f"{int(duration_sec//60)}m {int(duration_sec%60)}s"
                        if duration_sec < 3600
                        else f"{int(duration_sec//3600)}j {int((duration_sec%3600)//60)}m")
    except Exception:
        duration_str = "?"

    today_str  = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily_r    = compute_daily_report(today_str)
    cum_pnl    = daily_r["total_pnl"]  # trade sudah di-log sebelum compute, tidak perlu ditambah lagi
    saldo_after = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 0.0

    icon = "🟡" if pnl >= 0 else "🟠"
    send_telegram_message(
        f"{icon} *Early Exit — `{symbol}`*\n\n"
        f"Sebab     : _reversal terdeteksi sebelum SL kena_\n"
        f"Sinyal    : {reason}\n\n"
        f"Entry     : `{entry_price}`\n"
        f"Exit      : `{exit_price:.8f}`\n"
        f"Durasi    : `{duration_str}`\n\n"
        f"PnL trade   : `{pnl:+.4f} USDT` \\(`{pnl_pct:+.2f}%`\\)\n"
        f"PnL hari ini: `{cum_pnl:+.4f} USDT`\n"
        f"Saldo USDT  : `{saldo_after:.4f}`\n\n"
        f"💡 _Keluar lebih awal — jaga modal dari kerugian lebih besar_",
        topic_id=TELEGRAM_REPORT_TOPIC_ID,
    )

    with positions_lock:
        open_positions.pop(symbol, None)
    save_state()


def _get_order_status(symbol: str, order_id) -> dict:
    """Ambil status order dari exchange yang aktif. Return dict kosong jika error."""
    try:
        if ACTIVE_EXCHANGE == "mexc":
            params = _mexc_sign({"symbol": symbol, "orderId": str(order_id)})
            r = requests.get(f"{_MEXC_BASE}/api/v3/order",
                             params=params, headers=_mexc_headers(), timeout=10)
            r.raise_for_status()
            return r.json()  # MEXC Binance-compatible: status field = "FILLED"
        if ACTIVE_EXCHANGE == "bybit":
            params = {"category": "spot", "orderId": str(order_id)}
            _, headers = _bybit_sign(params)
            r = requests.get(f"{_BYBIT_BASE}/v5/order/history",
                             params=params, headers=headers, timeout=10)
            r.raise_for_status()
            data = r.json()
            orders = data.get("result", {}).get("list", [])
            if orders:
                raw = orders[0]
                # Normalise ke format Binance-compatible untuk logika berikutnya
                return {
                    "status":              "FILLED" if raw.get("orderStatus") == "Filled" else raw.get("orderStatus", ""),
                    "executedQty":         raw.get("cumExecQty", "0"),
                    "cummulativeQuoteQty": raw.get("cumExecValue", "0"),
                    "price":               raw.get("avgPrice", "0"),
                }
            return {}
        # Default: Binance
        client = make_binance_client()
        return client.get_order(symbol=symbol, orderId=order_id)
    except Exception as e:
        logger.warning(f"Gagal cek status order {symbol} #{order_id}: {e}")
        return {}


def _check_position_close(symbol: str, pos: dict) -> None:
    """Cek apakah TP/SL order sudah FILLED. Kalau ya, catat pnl & kirim notifikasi."""
    entry_price = pos["entry_price"]
    qty = pos["qty"]

    for leg, order_id, label in (
        ("tp", pos.get("tp_order_id"), "TP"),
        ("sl", pos.get("sl_order_id"), "SL"),
    ):
        if not order_id:
            continue
        order = _get_order_status(symbol, order_id)
        if not order:
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

        # Hitung durasi posisi terbuka
        opened_at_str = pos.get("opened_at", "")
        try:
            opened_dt = datetime.fromisoformat(opened_at_str)
            duration_sec = (datetime.now(timezone.utc) - opened_dt).total_seconds()
            if duration_sec < 3600:
                duration_str = f"{int(duration_sec//60)}m {int(duration_sec%60)}s"
            else:
                duration_str = f"{int(duration_sec//3600)}j {int((duration_sec%3600)//60)}m"
        except Exception:
            duration_str = "?"

        # Cumulative P&L hari ini dari trades.log
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        daily_r  = compute_daily_report(today_str)
        cum_pnl  = daily_r["total_pnl"]  # trade sudah di-log sebelum compute, tidak perlu ditambah lagi

        # Saldo setelah close
        saldo_after = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 0.0

        icon = "✅" if pnl >= 0 else "🔴"
        result_label = "Take Profit 🎯" if label == "TP" else "Stop Loss 🛡"
        send_telegram_message(
            f"{icon} *Posisi ditutup — `{symbol}`*\n\n"
            f"Hasil     : *{result_label}*\n"
            f"Entry     : `{entry_price}`\n"
            f"Exit      : `{exit_price}`\n"
            f"Qty       : `{exec_qty}`\n"
            f"Durasi    : `{duration_str}`\n\n"
            f"PnL trade : `{pnl:+.4f} USDT` \\(`{pnl_pct:+.2f}%`\\)\n"
            f"PnL hari ini: `{cum_pnl:+.4f} USDT`\n"
            f"Saldo USDT  : `{saldo_after:.4f}`\n\n"
            f"✅ Win: `{daily_r['wins']}` \\| ❌ Loss: `{daily_r['losses']}` \\| WR: `{daily_r['win_rate']}%`",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )

        with positions_lock:
            open_positions.pop(symbol, None)
        save_state()
        return


# ---------------------------------------------------------------------------
# ─── TRAILING STOP LOSS ──────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _update_trailing_sl(symbol: str, pos: dict, current_price: float) -> None:
    """Cek dan perbarui trailing SL kalau harga sudah naik cukup dari entry.

    Logika:
    1. Catat harga tertinggi yang pernah dicapai sejak posisi dibuka
    2. Kalau profit sudah ≥ TRAILING_SL_ACTIVATE_PCT → trailing mulai aktif
    3. Trailing SL = highest_price × (1 - TRAILING_SL_TRAIL_PCT/100)
    4. Kalau SL baru > SL lama → cancel OCO lama, pasang OCO baru dengan SL lebih tinggi
    """
    if not TRAILING_SL_ENABLED:
        return
    if not LIVE_MODE:
        return  # trailing hanya di live mode

    entry_price = pos.get("entry_price", 0)
    if entry_price <= 0 or current_price <= 0:
        return

    profit_pct = (current_price / entry_price - 1) * 100

    # Update highest price seen
    highest = pos.get("highest_price_seen", entry_price)
    if current_price > highest:
        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["highest_price_seen"] = current_price
        highest = current_price

    # Trailing belum aktif kalau profit masih di bawah threshold
    if profit_pct < TRAILING_SL_ACTIVATE_PCT:
        return

    # Hitung trailing SL baru
    new_sl = highest * (1 - TRAILING_SL_TRAIL_PCT / 100)
    old_sl = pos.get("sl_price", 0)

    # Hanya geser SL ke atas — tidak pernah turun
    if new_sl <= old_sl + 0.0000001:
        return

    # Tandai trailing aktif (pertama kali)
    first_activation = not pos.get("trailing_sl_active", False)

    logger.info(
        f"📈 Trailing SL {symbol}: SL lama={old_sl:.8f} → baru={new_sl:.8f} "
        f"(highest={highest:.8f}, profit={profit_pct:.2f}%)"
    )

    try:
        qty = pos.get("qty", 0)
        tp_price = pos.get("tp_price", 0)
        if not qty or not tp_price:
            return

        # Cancel TP/SL order lama
        cancel_exchange_orders(symbol, pos)
        time.sleep(0.3)

        # Pasang OCO/TP baru dengan SL yang sudah di-trail
        f_info = get_symbol_filters(symbol)
        tick = f_info.get("tickSize", 0.00000001)
        step = f_info.get("stepSize", 0.00001)
        rounded_qty = _round_step(qty, step)
        rounded_sl  = _round_price(new_sl, tick)
        rounded_sl_limit = _round_price(new_sl * 0.999, tick)
        rounded_tp  = _round_price(tp_price, tick)

        new_tp_id = new_sl_id = None
        oco: dict = {}
        if ACTIVE_EXCHANGE == "mexc":
            mexc_ord = place_mexc_tp_sl(symbol, rounded_qty, pos.get("entry_price", 0), atr=0)
            if mexc_ord:
                new_tp_id = mexc_ord.get("_tp_order_id")
            oco = mexc_ord or {}
        elif ACTIVE_EXCHANGE == "bybit":
            bybit_ord = place_bybit_tp_sl(
                symbol, rounded_qty, pos.get("entry_price", 0),
                tp_price_override=rounded_tp, sl_price_override=rounded_sl,
            )
            if bybit_ord:
                new_tp_id = bybit_ord.get("_tp_order_id")
            oco = bybit_ord or {}
        else:
            client = make_binance_client()
            oco = client.create_oco_order(
                symbol=symbol,
                side="SELL",
                quantity=rounded_qty,
                price=str(rounded_tp),
                stopPrice=str(rounded_sl),
                stopLimitPrice=str(rounded_sl_limit),
                stopLimitTimeInForce="GTC",
            )
            reports = oco.get("orderReports", [])
            new_tp_id = next((r["orderId"] for r in reports if r.get("type") == "LIMIT_MAKER"), None)
            new_sl_id = next((r["orderId"] for r in reports if r.get("type") == "STOP_LOSS_LIMIT"), None)

        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["sl_price"]       = rounded_sl
                open_positions[symbol]["tp_order_id"]    = new_tp_id
                open_positions[symbol]["sl_order_id"]    = new_sl_id
                open_positions[symbol]["order_list_id"]  = oco.get("orderListId")
                open_positions[symbol]["trailing_sl_active"] = True
        save_state()

        sl_moved_pct = (rounded_sl / entry_price - 1) * 100
        msg_prefix = "🔒 *Trailing SL AKTIF" if first_activation else "📈 *Trailing SL diperbarui"
        send_telegram_message(
            f"{msg_prefix} — `{symbol}`*\n\n"
            f"Profit saat ini : `{profit_pct:+.2f}%`\n"
            f"Harga tertinggi : `{highest:.8f}`\n"
            f"SL lama         : `{old_sl:.8f}`\n"
            f"SL baru         : `{rounded_sl:.8f}` \\(`{sl_moved_pct:+.2f}%` dari entry\\)\n"
            f"TP tetap        : `{rounded_tp:.8f}`\n\n"
            f"_SL otomatis naik mengikuti profit — modal lebih terlindungi\\._",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )
        logger.info(f"✅ Trailing SL berhasil diperbarui untuk {symbol}")

    except Exception as e:
        logger.warning(f"Trailing SL gagal untuk {symbol}: {e}")


# ---------------------------------------------------------------------------
# ─── BREAKEVEN STOP LOSS ─────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _check_breakeven_sl(symbol: str, pos: dict, current_price: float) -> None:
    """Pindahkan SL ke entry price saat profit ≥ BREAKEVEN_ACTIVATE_PCT (default 0.5%).

    Efek: setelah breakeven aktif, posisi ini tidak akan pernah rugi dari SL.
    Hanya dilakukan sekali per posisi (ditandai 'breakeven_done').
    Tidak dilakukan kalau trailing SL sudah aktif (SL sudah di atas entry).
    """
    if not BREAKEVEN_ENABLED:
        return
    if not LIVE_MODE:
        return
    if pos.get("breakeven_done"):
        return

    entry_price = pos.get("entry_price", 0)
    if entry_price <= 0 or current_price <= 0:
        return

    profit_pct = (current_price / entry_price - 1) * 100
    if profit_pct < BREAKEVEN_ACTIVATE_PCT:
        return

    current_sl = pos.get("sl_price", 0)
    # Kalau SL sudah >= entry (dari trailing), tandai breakeven done dan keluar
    if current_sl >= entry_price * 0.9999:
        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["breakeven_done"] = True
        return

    logger.info(
        f"🛡️ Breakeven SL {symbol}: pindah SL {current_sl:.8f} → entry {entry_price:.8f} "
        f"(profit={profit_pct:.2f}%)"
    )

    try:
        qty = pos.get("qty", 0)
        tp_price = pos.get("tp_price", 0)
        if not qty or not tp_price:
            return

        f_info = get_symbol_filters(symbol)
        tick = f_info.get("tickSize", 0.00000001)
        step = f_info.get("stepSize", 0.00001)
        rounded_qty = _round_step(qty, step)
        rounded_sl = _round_price(entry_price, tick)
        # SL limit sedikit di bawah stop price supaya order bisa terisi
        rounded_sl_limit = _round_price(entry_price * 0.999, tick)
        rounded_tp = _round_price(tp_price, tick)

        # Cancel TP/SL order lama, pasang baru dengan SL di entry
        cancel_exchange_orders(symbol, pos)
        time.sleep(0.3)

        new_tp_id = new_sl_id = None
        new_order_list_id_be = None
        if ACTIVE_EXCHANGE == "mexc":
            mexc_ord = place_mexc_tp_sl(symbol, rounded_qty, entry_price, atr=0)
            if mexc_ord:
                new_tp_id = mexc_ord.get("_tp_order_id")
        elif ACTIVE_EXCHANGE == "bybit":
            bybit_ord = place_bybit_tp_sl(
                symbol, rounded_qty, entry_price,
                tp_price_override=rounded_tp, sl_price_override=rounded_sl,
            )
            if bybit_ord:
                new_tp_id = bybit_ord.get("_tp_order_id")
        else:
            client = make_binance_client()
            oco = client.create_oco_order(
                symbol=symbol,
                side="SELL",
                quantity=rounded_qty,
                price=str(rounded_tp),
                stopPrice=str(rounded_sl),
                stopLimitPrice=str(rounded_sl_limit),
                stopLimitTimeInForce="GTC",
            )
            reports = oco.get("orderReports", [])
            new_tp_id = next(
                (r["orderId"] for r in reports if r.get("type") == "LIMIT_MAKER"), None
            )
            new_sl_id = next(
                (r["orderId"] for r in reports if r.get("type") == "STOP_LOSS_LIMIT"), None
            )
            new_order_list_id_be = oco.get("orderListId")

        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["sl_price"]       = rounded_sl
                open_positions[symbol]["tp_order_id"]    = new_tp_id
                open_positions[symbol]["sl_order_id"]    = new_sl_id
                open_positions[symbol]["order_list_id"]  = new_order_list_id_be
                open_positions[symbol]["breakeven_done"] = True
        save_state()

        send_telegram_message(
            f"🛡️ *Breakeven SL aktif — `{symbol}`*\n\n"
            f"Profit saat ini : `{profit_pct:+.2f}%`\n"
            f"SL dipindah ke  : `{rounded_sl:.8f}` \\(= entry price\\)\n"
            f"TP tetap        : `{rounded_tp:.8f}`\n\n"
            f"_Posisi ini tidak akan rugi dari SL sekarang\\._",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )
        logger.info(f"✅ Breakeven SL aktif untuk {symbol}")

    except Exception as e:
        logger.warning(f"Breakeven SL gagal untuk {symbol}: {e}")


# ---------------------------------------------------------------------------
# ─── PARTIAL TAKE PROFIT ─────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _check_partial_tp(symbol: str, pos: dict, current_price: float) -> None:
    """Tutup 50% posisi saat profit mencapai 50% jarak ke TP (configurable).

    Contoh: entry=100, TP=104, trigger saat harga ≥ 102 (50% dari 4 USDT gap).
    → Jual 50% via market sell, update OCO untuk sisa 50%.
    Sisa posisi dibiarkan dengan trailing SL ke TP penuh.
    """
    if not PARTIAL_TP_ENABLED:
        return
    if not LIVE_MODE:
        return
    if pos.get("partial_tp_done"):
        return

    entry_price = pos.get("entry_price", 0)
    tp_price    = pos.get("tp_price", 0)
    if entry_price <= 0 or tp_price <= 0:
        return

    tp_distance   = tp_price - entry_price
    trigger_price = entry_price + tp_distance * PARTIAL_TP_TRIGGER_RATIO

    if current_price < trigger_price:
        return

    qty = pos.get("qty", 0)
    if not qty:
        return

    f_info         = get_symbol_filters(symbol)
    step           = f_info.get("stepSize", 0.00001)
    tick           = f_info.get("tickSize", 0.00000001)
    min_notional   = f_info.get("minNotional", 0) or 0
    min_qty        = f_info.get("minQty", 0)

    sell_qty      = _round_step(qty * PARTIAL_TP_RATIO, step)
    sell_qty      = max(sell_qty, min_qty)
    remaining_qty = _round_step(qty - sell_qty, step)

    # Cek sisa qty masih memenuhi MIN_NOTIONAL
    if remaining_qty <= 0 or (remaining_qty * current_price) < min_notional:
        logger.debug(f"Partial TP {symbol}: sisa qty terlalu kecil, skip")
        return

    profit_pct = (current_price / entry_price - 1) * 100
    logger.info(
        f"🎯 Partial TP {symbol}: profit={profit_pct:.2f}%, jual {sell_qty} dari {qty}, "
        f"sisa {remaining_qty}"
    )

    try:
        # Tandai dulu supaya tidak double-trigger dari thread lain
        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["partial_tp_done"] = True
            else:
                return  # posisi sudah tutup

        # Step 1: Cancel TP/SL order lama supaya tidak konflik dengan partial sell
        cancel_exchange_orders(symbol, pos)
        time.sleep(0.3)

        # Step 2: Market sell sebagian
        fill_info = execute_exchange(symbol, "SELL", sell_qty)
        fills = fill_info.get("fills", [])
        if fills:
            total_quote = sum(float(f["price"]) * float(f["qty"]) for f in fills)
            total_qty_f = sum(float(f["qty"]) for f in fills)
            exit_price  = total_quote / total_qty_f if total_qty_f else current_price
        else:
            exit_price = float(fill_info.get("price", current_price) or current_price)

        pnl_partial = (exit_price - entry_price) * sell_qty
        pnl_pct     = (exit_price / entry_price - 1) * 100

        log_trade(symbol, "SELL", sell_qty, exit_price, 0,
                  f"Partial TP {PARTIAL_TP_RATIO*100:.0f}% dari posisi",
                  "PARTIAL_TP", str(fill_info.get("orderId", "")),
                  extra={"pnl": round(pnl_partial, 4), "pnl_pct": round(pnl_pct, 3)})

        # Step 3: Pasang TP/SL baru untuk sisa qty
        current_sl    = pos.get("sl_price", entry_price * 0.99)
        rounded_sl    = _round_price(current_sl, tick)
        rounded_sl_l  = _round_price(current_sl * 0.999, tick)
        rounded_tp    = _round_price(tp_price, tick)
        rounded_rem   = _round_step(remaining_qty, step)

        new_tp_id = new_sl_id = None
        new_order_list_id = None
        if ACTIVE_EXCHANGE == "mexc":
            mexc_ord = place_mexc_tp_sl(symbol, rounded_rem, entry_price, atr=0)
            if mexc_ord:
                new_tp_id = mexc_ord.get("_tp_order_id")
        elif ACTIVE_EXCHANGE == "bybit":
            bybit_ord = place_bybit_tp_sl(
                symbol, rounded_rem, entry_price,
                tp_price_override=rounded_tp, sl_price_override=rounded_sl,
            )
            if bybit_ord:
                new_tp_id = bybit_ord.get("_tp_order_id")
        else:
            client = make_binance_client()
            oco = client.create_oco_order(
                symbol=symbol,
                side="SELL",
                quantity=rounded_rem,
                price=str(rounded_tp),
                stopPrice=str(rounded_sl),
                stopLimitPrice=str(rounded_sl_l),
                stopLimitTimeInForce="GTC",
            )
            reports    = oco.get("orderReports", [])
            new_tp_id  = next((r["orderId"] for r in reports if r.get("type") == "LIMIT_MAKER"), None)
            new_sl_id  = next((r["orderId"] for r in reports if r.get("type") == "STOP_LOSS_LIMIT"), None)
            new_order_list_id = oco.get("orderListId")

        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["qty"]            = remaining_qty
                open_positions[symbol]["tp_order_id"]    = new_tp_id
                open_positions[symbol]["sl_order_id"]    = new_sl_id
                open_positions[symbol]["order_list_id"]  = new_order_list_id
        save_state()

        saldo_after = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 0.0
        send_telegram_message(
            f"🎯 *Partial TP — `{symbol}`*\n\n"
            f"Profit saat ini  : `{profit_pct:+.2f}%`\n"
            f"Qty dijual       : `{sell_qty}` \\({PARTIAL_TP_RATIO*100:.0f}% posisi\\)\n"
            f"Harga exit       : `{exit_price:.8f}`\n"
            f"PnL partial      : `{pnl_partial:+.4f} USDT`\n"
            f"Saldo USDT       : `{saldo_after:.4f}`\n\n"
            f"Sisa `{remaining_qty}` qty masih terbuka menuju TP = `{tp_price}`\n"
            f"_Profit sebagian sudah dikunci\\!_",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )
        logger.info(f"✅ Partial TP berhasil {symbol}: jual {sell_qty}, sisa {remaining_qty}")

    except Exception as e:
        # Rollback flag kalau gagal supaya bisa dicoba lagi cycle berikutnya
        with positions_lock:
            if symbol in open_positions:
                open_positions[symbol]["partial_tp_done"] = False
        logger.warning(f"Partial TP gagal untuk {symbol}: {e}")


def position_monitor_loop() -> None:
    """Cek berkala apakah ada posisi yang ditutup lewat TP/SL, dan:
    - Breakeven SL: pindahkan SL ke entry saat profit ≥ 0.5%
    - Partial TP: tutup 50% posisi saat profit mencapai 50% jarak ke TP
    - Trailing SL: geser SL naik seiring harga naik
    - Deteksi sinyal reversal → early exit sebelum SL kena
    - Laporan harian otomatis 23:55 WIB + reset equity di tengah malam
    """
    global daily_report_sent_date, daily_start_equity
    while True:
        try:
            with positions_lock:
                snapshot = dict(open_positions)

            for symbol, pos in snapshot.items():
                # ── 1. Cek apakah OCO (TP/SL) sudah FILLED ──────────────────
                _check_position_close(symbol, pos)

                # Kalau posisi sudah tutup oleh TP/SL di atas, skip sisa
                with positions_lock:
                    if symbol not in open_positions:
                        continue
                    pos = dict(open_positions[symbol])  # refresh snapshot

                # ── 2. Ambil harga terkini (sekali, dipakai oleh step 2-4) ──
                current_price = None
                if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY):
                    try:
                        df_live = fetch_market(symbol, "1m", 2)
                        if df_live is not None and len(df_live) >= 1:
                            current_price = float(df_live.iloc[-1]["close"])
                    except Exception as e:
                        logger.debug(f"Fetch harga live {symbol}: {e}")

                if current_price is None:
                    continue  # skip semua monitoring kalau tidak bisa ambil harga

                if not pos.get("reversal_exits_attempted", 0):
                    # ── 2a. Breakeven SL ─────────────────────────────────────
                    try:
                        _check_breakeven_sl(symbol, pos, current_price)
                        with positions_lock:
                            if symbol not in open_positions:
                                continue
                            pos = dict(open_positions[symbol])
                    except Exception as e:
                        logger.debug(f"Breakeven SL check error {symbol}: {e}")

                    # ── 2b. Partial Take Profit ──────────────────────────────
                    try:
                        _check_partial_tp(symbol, pos, current_price)
                        with positions_lock:
                            if symbol not in open_positions:
                                continue
                            pos = dict(open_positions[symbol])
                    except Exception as e:
                        logger.debug(f"Partial TP check error {symbol}: {e}")

                    # ── 2c. Trailing Stop Loss ───────────────────────────────
                    try:
                        _update_trailing_sl(symbol, pos, current_price)
                        with positions_lock:
                            if symbol not in open_positions:
                                continue
                            pos = dict(open_positions[symbol])
                    except Exception as e:
                        logger.debug(f"Trailing SL check error {symbol}: {e}")

                # ── 3. Guard: jangan coba early exit lebih dari 1 kali ──────
                if pos.get("reversal_exits_attempted", 0) >= 1:
                    continue

                # ── 4. Cek reversal untuk early exit ─────────────────────────
                if not (LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY)):
                    continue

                try:
                    df_fresh = fetch_market(symbol, "1m", 30)
                    if df_fresh is None or len(df_fresh) < 10:
                        continue
                    df_fresh = compute_indicators(df_fresh)

                    is_rev, rev_reason = detect_reversal(df_fresh)
                    if is_rev:
                        with positions_lock:
                            if symbol in open_positions:
                                open_positions[symbol]["reversal_exits_attempted"] = 1
                            else:
                                continue
                        logger.warning(
                            f"🔄 Reversal terdeteksi {symbol}: {rev_reason}"
                        )
                        emergency_close_position(symbol, pos, rev_reason)

                except Exception as e:
                    logger.warning(f"Reversal check error {symbol}: {e}")

            # ── 5. Laporan harian: 23:55 WIB (= 16:55 UTC) ───────────────────
            now = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")
            if (now.hour == DAILY_REPORT_HOUR_UTC and now.minute >= 55
                    and daily_report_sent_date != today_str):
                send_daily_report(today_str)
                daily_report_sent_date = today_str

            # ── 6. Reset equity awal hari di tengah malam WIB (17:00 UTC) ───
            if now.hour == 17 and now.minute < 1 and daily_report_sent_date == today_str:
                if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY):
                    new_equity = get_exchange_equity()
                    if new_equity > 0:
                        daily_start_equity = new_equity
                        logger.info(f"🔄 Equity awal hari baru: {daily_start_equity:.4f} USDT")
                        db_save_equity_snapshot(new_equity)

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
                # Semua jalur penutupan posisi: TP, SL, dan early exit
                if result in ("CLOSED_TP", "CLOSED_SL", "EARLY_EXIT"):
                    pnl_val = float(rec.get("pnl", 0))
                    total_pnl += pnl_val
                    if result == "CLOSED_TP" or (result == "EARLY_EXIT" and pnl_val >= 0):
                        wins += 1
                    else:
                        losses += 1
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

    # Ambil saldo sekarang untuk bandingkan dengan modal awal hari ini
    saldo_now = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 0.0
    net_change = round(saldo_now - daily_start_equity, 4) if daily_start_equity > 0 else 0.0
    net_pct    = round((net_change / daily_start_equity * 100), 2) if daily_start_equity > 0 else 0.0

    icon = "📈" if r["total_pnl"] >= 0 else "📉"
    saldo_icon = "🟢" if net_change >= 0 else "🔴"

    text = (
        f"{icon} *Laporan Harian — {r['date']}*\n\n"
        f"💰 *Pergerakan Saldo*\n"
        f"Awal hari  : `{daily_start_equity:.4f} USDT`\n"
        f"Sekarang   : `{saldo_now:.4f} USDT`\n"
        f"Perubahan  : {saldo_icon} `{net_change:+.4f} USDT` \\(`{net_pct:+.2f}%`\\)\n\n"
        f"📊 *Ringkasan Trading*\n"
        f"Total PnL closed : `{r['total_pnl']:+.4f} USDT`\n"
        f"Profit \\(TP kena\\): `{r['wins']}` trade ✅\n"
        f"Rugi \\(SL kena\\)  : `{r['losses']}` trade ❌\n"
        f"Win rate         : `{r['win_rate']}%`\n\n"
        f"📋 *Detail*\n"
        f"Order eksekusi   : `{r['trades_opened']}`\n"
        f"Sinyal dilewati  : `{r['skipped_too_small']}` \\(saldo kurang\\)\n"
        f"Posisi terbuka   : `{n_open}`"
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
    # Tulis ke trades.log (backward compat)
    with trades_log_lock:
        with open(TRADES_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    # Tulis ke SQLite (analisis historis + chart)
    db_insert_trade(record)
    logger.info(f"Log: {result} | {side} {symbol} @ {price} | conf={confidence}%")

# ---------------------------------------------------------------------------
# ─── 7. MANAJEMEN RISIKO ────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def get_recent_win_rate(lookback: int = 20) -> float:
    """Hitung win rate dari N trade closed terakhir di SQLite.
    Return 0.5 (netral) kalau data tidak cukup (< 5 trade)."""
    trades = db_get_recent_trades(lookback)
    if len(trades) < 5:
        return 0.5  # netral — tidak cukup data
    wins = sum(1 for t in trades if t.get("result") == "CLOSED_TP"
               or (t.get("result") == "EARLY_EXIT" and (t.get("pnl") or 0) >= 0))
    return wins / len(trades)


def _kelly_multiplier() -> float:
    """Kelly Criterion lite: skala qty antara 0.5× – 1.5× berdasarkan win rate terkini.
    Hanya aktif kalau KELLY_SIZING_ENABLED=true dan ada cukup data historis."""
    if not KELLY_SIZING_ENABLED:
        return 1.0
    wr = get_recent_win_rate(KELLY_LOOKBACK)
    # Scale: WR ≥ 70% → 1.5×, WR 55-70% → 1.0×, WR 40-55% → 0.75×, WR < 40% → 0.5×
    if wr >= 0.70:
        mult = 1.5
    elif wr >= 0.55:
        mult = 1.0
    elif wr >= 0.40:
        mult = 0.75
    else:
        mult = 0.5
    logger.debug(f"Kelly mult={mult:.2f}× (WR terkini={wr*100:.0f}% dari {KELLY_LOOKBACK} trade)")
    return mult


def calc_quantity(current_price: float, atr: float,
                  equity: float = 10_000.0, symbol: str = "") -> float:
    max_loss  = equity * MAX_EXPOSURE_PCT
    stop_dist = atr if atr > 0 else current_price * 0.01
    raw_qty   = max(max_loss / stop_dist, 0.0)

    # CAP: total biaya tidak boleh melebihi seluruh equity yang dialokasikan.
    # ATR kecil (harga ketat) bisa membuat qty sangat besar → biaya > saldo → -2010.
    if current_price > 0:
        max_affordable_qty = equity / current_price
        if raw_qty > max_affordable_qty:
            logger.debug(
                f"calc_quantity: qty {raw_qty:.4f} dicap ke {max_affordable_qty:.4f} "
                f"(biaya {raw_qty*current_price:.2f} USDT > equity {equity:.2f} USDT)"
            )
            raw_qty = max_affordable_qty

    # Terapkan Kelly multiplier (skala berdasarkan win rate terkini)
    raw_qty *= _kelly_multiplier()

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
    """Cek dua level perlindungan equity:
    1. HARD STOP (HARD_STOP_LOSS_PCT, default 3%) → pause bot, masih bisa resume manual
    2. DAILY LIMIT (DAILY_LOSS_LIMIT_PCT, default 5%) → matikan LIVE_MODE, perlu restart
    Return False berarti jangan eksekusi order baru."""
    global LIVE_MODE, bot_paused
    if daily_start_equity <= 0 or equity_now <= 0:
        return True

    loss_pct = (1 - equity_now / daily_start_equity) * 100

    # Level 1: Hard stop — pause bot, bisa resume manual
    if loss_pct >= HARD_STOP_LOSS_PCT and not bot_paused:
        logger.warning(
            f"🚨 Hard stop daily loss {loss_pct:.2f}% (threshold {HARD_STOP_LOSS_PCT}%) — bot di-PAUSE"
        )
        with bot_paused_lock:
            bot_paused = True
        send_telegram_message(
            f"🚨 *HARD STOP — Daily Loss {loss_pct:.2f}%\\!*\n\n"
            f"Equity sekarang : `{equity_now:.4f} USDT`\n"
            f"Equity awal     : `{daily_start_equity:.4f} USDT`\n"
            f"Penurunan       : `{loss_pct:.2f}%` \\(threshold `{HARD_STOP_LOSS_PCT}%`\\)\n\n"
            f"⏸ *Bot otomatis di\\-pause\\.*\n"
            f"Posisi terbuka masih dipantau \\(trailing/TP/SL tetap jalan\\)\\.\n"
            f"Ketik `/resume` untuk lanjutkan trading setelah situasi membaik\\.",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )

    # Level 2: Daily limit — matikan LIVE_MODE (perlu restart bot)
    if loss_pct >= DAILY_LOSS_LIMIT_PCT * 100:
        logger.warning(
            f"⛔ Daily loss limit {DAILY_LOSS_LIMIT_PCT*100:.0f}% tercapai — LIVE_MODE dimatikan"
        )
        LIVE_MODE = False
        send_telegram_message(
            f"⛔ *Bot ditangguhkan total — daily loss limit {DAILY_LOSS_LIMIT_PCT*100:.0f}% tercapai\\.*\n"
            f"LIVE\\_MODE dimatikan\\. Perlu restart manual\\.",
            topic_id=TELEGRAM_REPORT_TOPIC_ID,
        )
        return False

    return not bot_paused  # kalau paused (hard stop), jangan eksekusi order baru


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
    Auto-trading dengan multi-AI consensus (Primary + Validators via 9Router).
    Menggunakan ATR-based dynamic TP/SL (R:R 1:4) dan data multi-TF + Futures.

    Alur:
    1. AI Primary sudah analisis (parameter signal)
    2. Validator AI (Claude, OpenAI, Gemini) memverifikasi secara independen via 9Router
    3. Kalau mayoritas sepakat arah (BUY/SELL) → eksekusi OTOMATIS tanpa tombol
    4. Kalau tidak ada mayoritas → skip, kirim info ke Telegram
    5. Setelah eksekusi → pasang OCO ATR-based TP/SL, kirim notifikasi
    """
    decision   = signal["decision"]
    confidence = signal["confidence"]
    reason     = signal["reason"]

    # ── Guard: bot sedang di-pause ───────────────────────────────────────────
    with bot_paused_lock:
        paused = bot_paused
    if paused:
        logger.debug(f"⏸ Bot di-pause — sinyal {symbol} {decision} diabaikan")
        return

    # ── Guard: limit posisi terbuka & korelasi ───────────────────────────────
    if decision == "BUY":
        allowed, reason_denied = _is_position_allowed(symbol)
        if not allowed:
            logger.info(f"⏭️ {symbol} dilewati — {reason_denied}")
            return

    # ATR untuk sizing + OCO levels
    atr_sl = atr * SL_ATR_MULT  # jarak Stop Loss dari entry
    atr_tp = atr * TP_ATR_MULT  # jarak Take Profit dari entry

    raw_equity    = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 10_000.0
    equity        = raw_equity * CAPITAL_ALLOCATION_PCT   # hanya pakai sebagian saldo
    qty           = calc_quantity(current_price, atr_sl if atr_sl > 0 else atr, equity, symbol=symbol)

    if LIVE_MODE and not qty_is_tradable(symbol, qty, current_price):
        f = get_symbol_filters(symbol)
        logger.warning(f"⏭️ Lewati sinyal {symbol}: saldo kekecilan")
        log_trade(symbol, decision, qty, current_price, confidence, reason, "SKIPPED_TOO_SMALL")
        send_telegram_message(
            f"⏭️ *Sinyal {symbol} dilewati*\n\n"
            f"AI bilang {decision} \\({confidence}%\\) tapi saldo USDT kekecilan "
            f"\\(butuh min notional ~{f['minNotional']}\\)\\.",
            topic_id=_signal_topic(decision),
        )
        return

    # Hitung TP/SL levels untuk preview di Telegram
    sl_preview = round(current_price - atr_sl, 8) if atr > 0 else round(current_price * (1 - SL_PCT / 100), 8)
    tp_preview = round(current_price + atr_tp, 8) if atr > 0 else round(current_price * (1 + TP_PCT / 100), 8)
    atr_pct    = (atr / current_price * 100) if current_price else 0

    # Hitung estimasi biaya & potensi profit/loss dalam USDT
    estimated_cost    = round(qty * current_price, 4)
    potential_profit  = round(qty * (tp_preview - current_price), 4) if decision == "BUY" else 0.0
    potential_loss    = round(qty * (current_price - sl_preview), 4) if decision == "BUY" else 0.0

    from datetime import timedelta
    now_wib = (datetime.now(timezone.utc) + timedelta(hours=7)).strftime("%H:%M WIB")

    # ── Step 2: Jalankan semua validator AI secara paralel ──────────────────
    n_validators = sum(bool(m) for m in [AI_VALIDATOR_MODEL, AI_VALIDATOR_MODEL2, AI_VALIDATOR_MODEL3])
    send_telegram_message(
        f"🔍 *Sinyal {decision} terdeteksi — {symbol}*\n\n"
        f"⏰ `{now_wib}` \\| Harga: `{current_price}`\n\n"
        f"🤖 *AI Primary*: *{decision}* \\({confidence}%\\)\n"
        f"💬 _{reason}_\n\n"
        f"📐 ATR14: `{atr:.6f}` \\({atr_pct:.3f}%\\)\n"
        f"🎯 TP: `{tp_preview}` \\(+`{potential_profit:.4f}` USDT\\)\n"
        f"🛡 SL: `{sl_preview}` \\(-`{potential_loss:.4f}` USDT\\)\n"
        f"💵 Est\\. modal: `{estimated_cost:.4f}` USDT\n"
        f"📊 Saldo terpakai: `{int(CAPITAL_ALLOCATION_PCT*100)}%` dari akun\n\n"
        f"⏳ _Meminta validasi {n_validators} AI validator via 9Router\\.\\.\\._",
        topic_id=_signal_topic(decision),
    )

    consensus = run_multi_ai_consensus(
        symbol, df_1m, signal,
        df_5m=df_5m, df_15m=df_15m,
        funding=funding, oi_change=oi_change,
    )
    final_decision = consensus["decision"]
    avg_confidence = consensus["confidence"]
    votes          = consensus["votes"]
    models_result  = consensus["models"]
    n_total        = consensus["total_responding"]

    # Baris voting per model
    model_lines = ""
    _icons = {"BUY": "🟢", "SELL": "🔴", "HOLD": "⏸"}
    for mname, mres in models_result.items():
        mdec = mres.get("decision", "HOLD")
        mconf = mres.get("confidence", 0)
        model_lines += f"\n{_icons.get(mdec,'⚪')} *{mname}*: {mdec} \\({mconf}%\\)"

    # ── Step 3: Evaluasi majority vote ──────────────────────────────────────
    if not consensus["passed"]:
        log_trade(symbol, decision, 0, current_price, confidence, reason, "CONSENSUS_FAIL")
        vote_summary = f"BUY={votes['BUY']} SELL={votes['SELL']} HOLD={votes['HOLD']} dari {n_total} AI"
        send_telegram_message(
            f"🤔 *AI tidak sepakat — {symbol} dilewati*\n\n"
            f"*Voting \\({n_total} AI\\):*{model_lines}\n\n"
            f"📊 `{vote_summary}`\n"
            f"⏸ _Majority belum tercapai — tunggu sinyal lebih jelas_",
            topic_id=_signal_topic(decision),
        )
        return

    # ── Step 4: Majority sepakat → eksekusi ─────────────────────────────────
    vote_summary = f"BUY={votes['BUY']} SELL={votes['SELL']} HOLD={votes['HOLD']} dari {n_total} AI"

    if not LIVE_MODE:
        logger.info(f"[SIM] MULTI-AI CONSENSUS {final_decision} {qty} {symbol} @ ~{current_price}")
        log_trade(symbol, final_decision, qty, current_price, avg_confidence, reason, "SIMULATED")
        send_telegram_message(
            f"🔵 *\\[SIMULASI\\] Konsensus {n_total} AI — {final_decision}\\!*\n\n"
            f"Koin    : `{symbol}`\n"
            f"Aksi    : *{'Beli' if final_decision=='BUY' else 'Jual'}*\n"
            f"Volume  : `{qty}`\n"
            f"Harga   : `~{current_price}`\n\n"
            f"*Voting AI:*{model_lines}\n\n"
            f"📊 `{vote_summary}` → rata\\-rata yakin `{avg_confidence}%`\n"
            f"🎯 *R:R 1:{int(TP_ATR_MULT/SL_ATR_MULT)} \\(ATR\\-based\\)*\n"
            f"TP preview : `{tp_preview}`\n"
            f"SL preview : `{sl_preview}`",
            topic_id=_signal_topic(decision),
        )
        return

    if not check_daily_loss(raw_equity):
        return

    # Kirim notif "sedang eksekusi" sebelum order masuk
    arah_label = "BELI 🟢" if final_decision == "BUY" else "JUAL 🔴"
    send_telegram_message(
        f"⚡ *Konsensus {n_total} AI — Eksekusi {symbol}\\!*\n\n"
        f"Arah        : *{arah_label}*\n"
        f"Harga masuk : `~{current_price}`\n"
        f"Qty         : `{qty}`\n"
        f"Est\\. biaya : `{estimated_cost:.4f} USDT`\n"
        f"Keyakinan   : rata\\-rata `{avg_confidence}%`\n\n"
        f"*Voting:*{model_lines}\n\n"
        f"🔄 _Mengirim order ke Binance\\.\\.\\._",
        topic_id=_signal_topic(decision),
    )

    exchange_result, errors = {}, []
    try:
        exchange_result = execute_exchange(symbol, final_decision, qty)
    except Exception as e:
        errors.append(f"{ACTIVE_EXCHANGE.upper()}: {e}")

    fill_price = float(
        exchange_result.get("fills", [{}])[0].get("price", current_price)
    ) if exchange_result.get("fills") else float(exchange_result.get("price", current_price) or current_price)
    filled_qty = float(exchange_result.get("executedQty", qty)) if exchange_result else qty
    order_id   = str(exchange_result.get("orderId", "ERR"))
    status_str = "EXECUTED" if not errors else f"ERROR: {'; '.join(errors)}"

    # Ringkasan alasan dari semua model
    reasons_summary = " | ".join(
        f"[{mn}] {mr.get('reason','')[:60]}"
        for mn, mr in models_result.items()
    )
    log_trade(symbol, final_decision, qty, fill_price, avg_confidence,
              reasons_summary, status_str, order_id)

    total_spent    = round(filled_qty * fill_price, 4)
    saldo_sekarang = get_exchange_equity() if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) else 0.0
    icon = "✅" if not errors else "⚠️"
    send_telegram_message(
        f"{icon} *Order {'masuk' if not errors else 'GAGAL'} — `{symbol}`*\n\n"
        f"Aksi         : *{'🟢 BELI' if final_decision=='BUY' else '🔴 JUAL'}*\n"
        f"Harga fill   : `{fill_price}`\n"
        f"Qty          : `{filled_qty}`\n"
        f"Total biaya  : `{total_spent:.4f} USDT`\n"
        f"Saldo USDT   : `{saldo_sekarang:.4f}`\n"
        f"ID Order     : `{order_id}`\n\n"
        f"*Voting {n_total} AI:*{model_lines}\n\n"
        f"{'✅ Tereksekusi otomatis' if not errors else '⚠️ Error: ' + '; '.join(errors)}",
        topic_id=_signal_topic(final_decision),
    )

    # Pasang TP/SL otomatis setelah BUY tereksekusi
    if not errors and final_decision == "BUY" and filled_qty > 0:
        oco = place_exchange_tp_sl(symbol, filled_qty, fill_price, atr=atr)
        if oco:
            tp_price = oco.get("_tp_price", fill_price + atr_tp)
            sl_price = oco.get("_sl_price", fill_price - atr_sl)
            tp_pct_actual = ((tp_price / fill_price) - 1) * 100
            sl_pct_actual = (1 - (sl_price / fill_price)) * 100
            register_open_position(symbol, filled_qty, fill_price, oco)
            log_trade(symbol, "OCO_TP_SL", filled_qty, fill_price, avg_confidence,
                      f"ATR={atr:.6f} TP={tp_price} SL={sl_price} R:R=1:{int(TP_ATR_MULT/SL_ATR_MULT)}",
                      "PLACED", str(oco.get("orderListId", "")))
            usdt_tp_gain = round(filled_qty * (tp_price - fill_price), 4)
            usdt_sl_loss = round(filled_qty * (fill_price - sl_price), 4)
            saldo_if_tp = round(saldo_sekarang + usdt_tp_gain, 4)
            saldo_if_sl = round(saldo_sekarang - usdt_sl_loss, 4)
            send_telegram_message(
                f"🎯 *TP/SL terpasang — `{symbol}`*\n\n"
                f"Entry      : `{fill_price}`\n"
                f"Take Profit: `{tp_price}` \\(\\+{tp_pct_actual:.2f}%\\)\n"
                f"Stop Loss  : `{sl_price}` \\(\\-{sl_pct_actual:.2f}%\\)\n"
                f"R:R        : `1:{int(TP_ATR_MULT/SL_ATR_MULT)}` \\(ATR14={atr:.6f}\\)\n"
                f"Qty        : `{filled_qty}` \\| Modal: `{total_spent:.4f}` USDT\n\n"
                f"💰 *Proyeksi saldo:*\n"
                f"✅ TP kena → saldo \\+`{usdt_tp_gain:.4f}` USDT → jadi `{saldo_if_tp:.4f}` USDT\n"
                f"❌ SL kena → saldo \\-`{usdt_sl_loss:.4f}` USDT → jadi `{saldo_if_sl:.4f}` USDT\n\n"
                f"⏳ _Menunggu harga menyentuh TP atau SL\\.\\.\\._",
                topic_id=_signal_topic(final_decision),
            )
        else:
            send_telegram_message(
                f"⚠️ *TP/SL gagal dipasang* untuk `{symbol}`\\. "
                f"Posisi terbuka — pantau manual\\.",
                topic_id=_signal_topic(final_decision),
            )

# ---------------------------------------------------------------------------
# ─── HEALTH MONITOR ──────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def health_monitor_loop() -> None:
    """Monitor kesehatan bot setiap 5 menit:
    1. Alert Telegram kalau tidak ada sinyal AI > HEALTH_NO_SIGNAL_HOURS jam
    2. Alert Telegram kalau equity drop > HEALTH_EQUITY_DROP_PCT% dari awal hari
    3. Simpan equity snapshot ke SQLite setiap jam (untuk equity curve chart)
    """
    global _last_equity_snapshot_time
    last_no_signal_alert = 0.0
    last_equity_alert    = 0.0

    while True:
        try:
            now = time.time()

            # ── 1. Alert kalau bot diam terlalu lama ──────────────────────────
            with _last_signal_lock:
                last_sig = _last_signal_time
            since_hours = (now - last_sig) / 3600

            with bot_paused_lock:
                paused = bot_paused

            # Alert max 1x per jam, dan hanya kalau bot tidak sedang di-pause
            if (since_hours >= HEALTH_NO_SIGNAL_HOURS
                    and not paused
                    and (now - last_no_signal_alert) >= 3600):
                with pairs_lock:
                    n_pairs = len(active_pairs)
                send_telegram_message(
                    f"⚠️ *Alert: Bot sudah `{since_hours:.1f}` jam tanpa sinyal AI\\!*\n\n"
                    f"Kemungkinan penyebab:\n"
                    f"• Semua pair tidak lolos pre\\-filter \\(pasar sangat sideways\\)\n"
                    f"• Confidence AI selalu di bawah `{CONFIDENCE_THRESHOLD}%`\n"
                    f"• Rate limit AI atau Claude \\(cek log\\)\n\n"
                    f"_Bot masih aktif memindai `{n_pairs}` pair\\._",
                    topic_id=TELEGRAM_ALERTS_TOPIC_ID or TELEGRAM_REPORT_TOPIC_ID,
                )
                last_no_signal_alert = now
                logger.warning(f"⚠️ Health alert: {since_hours:.1f}j tanpa sinyal")

            # ── 2. Alert equity drop + simpan snapshot ───────────────────────
            if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY) and daily_start_equity > 0:
                try:
                    equity = get_exchange_equity()
                    if equity > 0:
                        drop_pct = (daily_start_equity - equity) / daily_start_equity * 100

                        if drop_pct >= HEALTH_EQUITY_DROP_PCT and (now - last_equity_alert) >= 3600:
                            with bot_paused_lock:
                                is_paused = bot_paused
                            send_telegram_message(
                                f"🚨 *Alert: Equity turun `{drop_pct:.2f}%` hari ini\\!*\n\n"
                                f"Equity awal    : `{daily_start_equity:.4f} USDT`\n"
                                f"Equity sekarang: `{equity:.4f} USDT`\n"
                                f"Penurunan      : `{drop_pct:.2f}%`\n\n"
                                f"Hard stop di `{HARD_STOP_LOSS_PCT}%` — "
                                f"{'⏸ bot sudah di\\-pause' if is_paused else f'⚠️ belum tercapai \\(masih {HARD_STOP_LOSS_PCT - drop_pct:.1f}% lagi\\)'}\\.",
                                topic_id=TELEGRAM_ALERTS_TOPIC_ID or TELEGRAM_REPORT_TOPIC_ID,
                            )
                            last_equity_alert = now
                            logger.warning(f"🚨 Health alert: equity turun {drop_pct:.2f}%")

                        # Simpan equity snapshot ke SQLite setiap jam
                        if (now - _last_equity_snapshot_time) >= 3600:
                            db_save_equity_snapshot(equity)
                            _last_equity_snapshot_time = now
                            logger.debug(f"💾 Equity snapshot: {equity:.4f} USDT")

                except Exception as e:
                    logger.debug(f"Health equity check error: {e}")

        except Exception as e:
            logger.warning(f"health_monitor_loop error: {e}")

        time.sleep(300)  # cek setiap 5 menit

# ---------------------------------------------------------------------------
# ─── DCA MONITOR LOOP ────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def dca_monitor_loop() -> None:
    """Execute DCA buys when due (checks every 5 min)."""
    logger.info("✅ DCA monitor aktif")
    while True:
        try:
            if DCA_ENABLED and not get_vacation_mode():
                with bot_paused_lock:
                    paused = bot_paused
                if not paused:
                    now_str = datetime.now(timezone.utc).isoformat()
                    for pos in db_get_dca_positions():
                        if not pos.get("enabled"):
                            continue
                        next_buy = pos.get("next_buy_at", "")
                        if next_buy and now_str >= next_buy:
                            sym    = pos["symbol"]
                            amount = float(pos.get("amount_usdt", DCA_DEFAULT_AMOUNT_USDT))
                            logger.info(f"📈 DCA: {sym} {amount} USDT")
                            result = execute_dca_buy(sym, amount)
                            if result.get("ok"):
                                send_telegram_message(
                                    f"📈 *DCA Buy: {sym}*\n"
                                    f"Qty  : `{result['qty']:.6f}`\n"
                                    f"Price: `{result['price']:.4f} USDT`\n"
                                    f"Spent: `{result['spent']:.2f} USDT`",
                                    topic_id=TELEGRAM_REPORT_TOPIC_ID,
                                )
        except Exception as e:
            logger.warning(f"DCA monitor: {e}")
        time.sleep(300)


# ---------------------------------------------------------------------------
# ─── SCHEDULED PAUSE CHECKER ─────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def scheduled_pause_checker_loop() -> None:
    """Auto-pause/resume bot based on trading hours schedule."""
    global bot_paused
    logger.info("✅ Schedule checker aktif")
    _paused_by_schedule = False
    while True:
        try:
            cfg = get_schedule_config()
            if cfg.get("enabled"):
                now  = datetime.now(timezone.utc)
                hour = now.hour
                wday = now.weekday()
                trading_days = [
                    int(d) for d in str(cfg.get("trading_days", "0,1,2,3,4,5,6")).split(",")
                    if d.strip().isdigit()
                ]
                s_h = int(cfg.get("trading_start_hour", 0))
                e_h = int(cfg.get("trading_end_hour", 24))
                in_hours = wday in trading_days and s_h <= hour < e_h
                with bot_paused_lock:
                    cur_paused = bot_paused
                if not in_hours and not cur_paused:
                    with bot_paused_lock:
                        bot_paused = True
                    _paused_by_schedule = True
                    log_audit("SCHED_PAUSE", f"hour={hour} UTC")
                elif in_hours and _paused_by_schedule and cur_paused:
                    with bot_paused_lock:
                        bot_paused = False
                    _paused_by_schedule = False
                    log_audit("SCHED_RESUME", f"hour={hour} UTC")
        except Exception as e:
            logger.debug(f"Schedule checker: {e}")
        time.sleep(60)


# ---------------------------------------------------------------------------
# ─── ECONOMIC CALENDAR LOOP ──────────────────────────────────────────────────
# ---------------------------------------------------------------------------

_CALENDAR_IMPACT_EMOJI = {"High": "🔴", "Medium": "🟡", "Low": "🟢"}
_calendar_posted_ids: set = set()   # track event ID yang sudah diposting

def _fetch_ff_calendar() -> list[dict]:
    """Fetch ForexFactory calendar JSON (gratis, no API key).
    Return list event minggu ini, diurutkan by datetime."""
    url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    events = resp.json()
    # parse datetime string → datetime object
    for ev in events:
        try:
            ev["_dt"] = datetime.strptime(ev["date"], "%Y-%m-%dT%H:%M:%S%z")
        except Exception:
            ev["_dt"] = None
    return sorted(events, key=lambda x: x.get("_dt") or datetime.max.replace(tzinfo=timezone.utc))


def _format_calendar_event(ev: dict) -> str:
    """Format satu event kalender jadi teks Telegram Markdown."""
    impact  = ev.get("impact", "")
    emoji   = _CALENDAR_IMPACT_EMOJI.get(impact, "⚪")
    country = ev.get("country", "").upper()
    title   = ev.get("title", "").strip()
    forecast = ev.get("forecast", "") or "—"
    previous = ev.get("previous", "") or "—"
    dt = ev.get("_dt")
    time_str = dt.strftime("%H:%M UTC") if dt else "?"
    return (
        f"{emoji} `{time_str}` \\| *{country}* — {title}\n"
        f"   ┗ Forecast: `{forecast}` \\| Prev: `{previous}`"
    )


def calendar_loop() -> None:
    """Kirim briefing kalender ekonomi harian ke topic Kalender Ekonomi.
    Jadwal:
    • Jam 00:01 UTC — briefing event HIGH impact hari ini
    • Real-time     — alert 15 menit sebelum event HIGH/MEDIUM impact
    Loop setiap 5 menit untuk cek jadwal & upcoming events.
    """
    if not TELEGRAM_CALENDAR_TOPIC_ID:
        logger.info("⏭ Calendar loop: TELEGRAM_CALENDAR_TOPIC_ID tidak di-set, skip")
        return
    logger.info("✅ Economic calendar loop aktif")

    _last_daily_date: Optional[str] = None
    _alerted_ids:     set           = set()

    while True:
        try:
            now = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")

            events = _fetch_ff_calendar()

            # ── 1. Daily briefing jam 00:01–00:30 UTC ────────────────────────
            if now.hour == 0 and now.minute < 30 and _last_daily_date != today_str:
                today_events = [
                    ev for ev in events
                    if ev.get("_dt") and ev["_dt"].strftime("%Y-%m-%d") == today_str
                    and ev.get("impact") in ("High", "Medium")
                ]
                if today_events:
                    lines = [_format_calendar_event(ev) for ev in today_events[:15]]
                    header = (
                        f"📅 *Kalender Ekonomi — {now.strftime('%A, %d %b %Y')} \\(UTC\\)*\n"
                        f"_Event High & Medium Impact hari ini:_\n\n"
                    )
                    msg = header + "\n\n".join(lines)
                    send_telegram_message(msg, topic_id=TELEGRAM_CALENDAR_TOPIC_ID)
                    _last_daily_date = today_str
                    logger.info(f"📅 Calendar briefing: {len(today_events)} event dikirim")

            # ── 2. Alert 15 menit sebelum event High/Medium ──────────────────
            for ev in events:
                ev_dt = ev.get("_dt")
                if not ev_dt:
                    continue
                if ev.get("impact") not in ("High", "Medium"):
                    continue
                ev_id = f"{ev_dt.isoformat()}_{ev.get('title','')}"
                if ev_id in _alerted_ids:
                    continue
                mins_away = (ev_dt - now).total_seconds() / 60
                if 0 <= mins_away <= 15:
                    impact  = ev.get("impact", "")
                    emoji   = _CALENDAR_IMPACT_EMOJI.get(impact, "⚪")
                    country = ev.get("country", "").upper()
                    title   = ev.get("title", "").strip()
                    forecast = ev.get("forecast", "") or "—"
                    previous = ev.get("previous", "") or "—"
                    alert = (
                        f"⏰ *Alert: Event Ekonomi 15 Menit Lagi\\!*\n\n"
                        f"{emoji} *{country}* — {title}\n"
                        f"Waktu    : `{ev_dt.strftime('%H:%M UTC')}`\n"
                        f"Impact   : `{impact}`\n"
                        f"Forecast : `{forecast}` \\| Prev: `{previous}`\n\n"
                        f"_Waspadai volatilitas tinggi di pasangan {country}\\._"
                    )
                    send_telegram_message(alert, topic_id=TELEGRAM_CALENDAR_TOPIC_ID)
                    _alerted_ids.add(ev_id)
                    logger.info(f"⏰ Calendar alert: {country} {title} in {mins_away:.0f}m")

        except Exception as e:
            logger.warning(f"calendar_loop error: {e}")

        time.sleep(300)  # cek tiap 5 menit


# ---------------------------------------------------------------------------
# ─── STRATEGI TRADING LOOP ───────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def strategy_loop() -> None:
    """Post analisis strategi trading AI harian ke topic Strategi Trading.
    Jadwal:
    • Jam 01:00 UTC (08:00 WIB) — rangkuman strategi pagi
    • Jam 13:00 UTC (20:00 WIB) — update strategi malam
    Berisi: kondisi market regime, pair prioritas, tips risk management.
    """
    if not TELEGRAM_STRATEGY_TOPIC_ID:
        logger.info("⏭ Strategy loop: TELEGRAM_STRATEGY_TOPIC_ID tidak di-set, skip")
        return
    logger.info("✅ Strategy loop aktif")

    _posted_hours: set = set()

    while True:
        try:
            now  = datetime.now(timezone.utc)
            hour = now.hour
            key  = f"{now.strftime('%Y-%m-%d')}-{hour}"

            if hour in (1, 13) and key not in _posted_hours:
                session = "🌅 Pagi" if hour == 1 else "🌙 Malam"
                wib_h   = (hour + 7) % 24

                # Ambil context: berita terbaru + top pairs
                with news_lock:
                    news_ctx = latest_news[:3]
                with pairs_lock:
                    top_pairs = list(active_pairs)[:5]

                news_summary = "\n".join(
                    f"- {n['title'][:80]}" for n in news_ctx
                ) if news_ctx else "Tidak ada berita terbaru."

                prompt = (
                    f"Kamu adalah analis crypto profesional. Buat rangkuman strategi trading "
                    f"singkat untuk sesi {session} (jam {wib_h}:00 WIB).\n\n"
                    f"Berita terbaru:\n{news_summary}\n\n"
                    f"Top pair aktif: {', '.join(top_pairs) if top_pairs else 'BTCUSDT, ETHUSDT'}\n\n"
                    f"Tulis dalam Bahasa Indonesia, maksimal 250 kata. Fokus pada:\n"
                    f"1. Kondisi market global hari ini (bullish/bearish/sideways)\n"
                    f"2. Strategi utama yang disarankan (breakout/pullback/range)\n"
                    f"3. Risk management tips praktis\n"
                    f"4. Pair yang perlu diperhatikan\n"
                    f"Gunakan gaya casual tapi informatif. Jangan gunakan markdown symbol."
                )
                try:
                    ai_resp = _call_9router(
                        messages=[{"role": "user", "content": prompt}],
                        model=AI_MODEL,
                        max_tokens=400,
                        temperature=0.7,
                    )
                    # Escape karakter spesial Telegram MarkdownV2
                    safe_resp = (ai_resp
                        .replace(".", "\\.").replace("!", "\\!").replace("-", "\\-")
                        .replace("(", "\\(").replace(")", "\\)").replace("#", "\\#")
                        .replace("+", "\\+").replace("=", "\\=").replace(">", "\\>")
                        .replace("|", "\\|").replace("{", "\\{").replace("}", "\\}")
                    )
                    msg = (
                        f"📈 *Strategi Trading {session} — {now.strftime('%d %b %Y')}*\n\n"
                        f"{safe_resp}\n\n"
                        f"_\\— RFSANZ AI Trading Bot_"
                    )
                    send_telegram_message(msg, topic_id=TELEGRAM_STRATEGY_TOPIC_ID)
                    _posted_hours.add(key)
                    logger.info(f"📈 Strategy post dikirim: sesi {session}")
                except Exception as e:
                    logger.warning(f"Strategy AI error: {e}")

        except Exception as e:
            logger.warning(f"strategy_loop error: {e}")

        time.sleep(300)  # cek tiap 5 menit


# ---------------------------------------------------------------------------
# ─── SEKOLAH TRADING LOOP ────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

_SCHOOL_TIPS: list[dict] = [
    {"title": "Apa itu Support & Resistance?",
     "body": "Support adalah level harga di mana banyak pembeli masuk sehingga harga cenderung naik. Resistance adalah sebaliknya — area jual.\n\n*Tips:* Masuk BUY saat harga menyentuh support + ada konfirmasi candle bullish. Exit sebelum resistance."},
    {"title": "Risk/Reward Ratio (RRR)",
     "body": "Selalu pastikan potensi profit minimal 2× lebih besar dari potensi rugi.\n\n*Contoh:* SL 1% → TP minimal 2%. Dengan win rate 50% saja, akun kamu tetap profit dalam jangka panjang."},
    {"title": "Apa itu Candlestick?",
     "body": "Setiap candlestick menggambarkan 4 harga: Open, High, Low, Close (OHLC).\n\n*Candle penting:*\n• Doji = ragu-ragu pasar\n• Hammer = potensi reversal naik\n• Shooting Star = potensi reversal turun\n• Engulfing = sinyal kuat pembalikan arah"},
    {"title": "Dollar Cost Averaging (DCA)",
     "body": "DCA adalah strategi beli aset secara berkala dengan jumlah tetap, tanpa peduli harga saat itu.\n\n*Keuntungan:* Mengurangi risiko beli di puncak. Cocok untuk investasi jangka panjang BTC, ETH, atau gold (XAUT)."},
    {"title": "Mengenal Timeframe Trading",
     "body": "• *1m–5m:* Scalping — cepat, risiko tinggi, butuh fokus penuh\n• *15m–1h:* Day trading — buka tutup posisi dalam 1 hari\n• *4h–1D:* Swing trading — tahan 1–7 hari, cocok untuk pemula\n• *1W+:* Position trading — investasi jangka panjang"},
    {"title": "Apa itu FOMO?",
     "body": "FOMO (Fear Of Missing Out) = masuk pasar karena takut ketinggalan, bukan karena analisis.\n\n*Dampak:* Beli di puncak, panik saat turun, jual rugi.\n\n*Solusi:* Buat rencana trading sebelum pasar buka. Stick to the plan."},
    {"title": "Pentingnya Stop Loss",
     "body": "Stop Loss (SL) adalah perintah jual otomatis saat harga turun ke level tertentu.\n\n*Aturan emas:* Selalu pasang SL sebelum entry. Jangan pernah trade tanpa SL.\n\n*Tips:* Pasang SL di bawah support (untuk BUY) atau di atas resistance (untuk SELL)."},
    {"title": "Volume dalam Trading",
     "body": "Volume = jumlah aset yang diperdagangkan dalam periode tertentu.\n\n*Interpretasi:*\n• Harga naik + volume naik = tren kuat (BULLISH)\n• Harga naik + volume turun = tren lemah, waspadai reversal\n• Breakout dengan volume tinggi = sinyal lebih valid"},
    {"title": "Mengenal RSI (Relative Strength Index)",
     "body": "RSI adalah indikator momentum (0–100).\n\n• RSI > 70 = overbought (potensi turun)\n• RSI < 30 = oversold (potensi naik)\n• RSI 50 = netral\n\n*Tips:* Jangan langsung jual saat RSI > 70 — tren kuat bisa tetap naik. Tunggu konfirmasi."},
    {"title": "Market Order vs Limit Order",
     "body": "• *Market Order:* Beli/jual langsung di harga pasar sekarang. Cepat tapi slippage bisa terjadi.\n• *Limit Order:* Beli/jual hanya di harga yang kamu tentukan. Lebih aman, tapi mungkin tidak tereksekusi.\n\n*Tips:* Gunakan limit order untuk entry, market order hanya untuk exit darurat."},
    {"title": "Psikologi Trading",
     "body": "80% sukses trading berasal dari mental, bukan teknikal.\n\n*Musuh terbesar trader:*\n1. Greed (keserakahan) — overleveraging\n2. Fear (ketakutan) — cut loss terlalu cepat\n3. Hope (harapan) — menahan posisi loss terlalu lama\n\n*Solusi:* Trading plan yang tertulis + disiplin eksekusi."},
    {"title": "Apa itu Leverage?",
     "body": "Leverage = meminjam modal dari exchange untuk trading lebih besar.\n\n• 10× leverage: modal 100 USDT, bisa trade 1000 USDT\n• Profit 10% = +100 USDT\n• Rugi 10% = -100 USDT (modal habis!)\n\n*Tips untuk pemula:* Mulai dengan leverage 1–3× maksimum."},
]

def school_loop() -> None:
    """Kirim tips edukasi trading ke topic Sekolah Trading.
    Jadwal: sekali per hari jam 02:00 UTC (09:00 WIB), tips berganti setiap hari.
    """
    if not TELEGRAM_SCHOOL_TOPIC_ID:
        logger.info("⏭ School loop: TELEGRAM_SCHOOL_TOPIC_ID tidak di-set, skip")
        return
    logger.info("✅ Sekolah Trading loop aktif")

    _last_post_date: Optional[str] = None

    while True:
        try:
            now       = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")

            if now.hour == 2 and now.minute < 10 and _last_post_date != today_str:
                # Pilih tips berdasarkan hari ke-N (berputar)
                day_num  = (now - datetime(2025, 1, 1, tzinfo=timezone.utc)).days
                tip      = _SCHOOL_TIPS[day_num % len(_SCHOOL_TIPS)]
                tip_num  = (day_num % len(_SCHOOL_TIPS)) + 1

                # Escape untuk MarkdownV2
                def _esc(s: str) -> str:
                    for c in r".-!()#+=>|{}":
                        s = s.replace(c, f"\\{c}")
                    return s

                title_esc = _esc(tip["title"])
                body_esc  = tip["body"].replace("!", "\\!").replace(".", "\\.").replace(
                    "(", "\\(").replace(")", "\\)").replace("-", "\\-").replace(
                    "+", "\\+").replace("=", "\\=").replace(">", "\\>").replace(
                    "|", "\\|")

                msg = (
                    f"🎓 *Sekolah Trading — Tip #{tip_num}*\n\n"
                    f"📖 *{title_esc}*\n\n"
                    f"{body_esc}\n\n"
                    f"_Belajar satu tips setiap hari \\= trader yang lebih baik\\._"
                )
                send_telegram_message(msg, topic_id=TELEGRAM_SCHOOL_TOPIC_ID)
                _last_post_date = today_str
                logger.info(f"🎓 School tip #{tip_num} dikirim: {tip['title']}")

        except Exception as e:
            logger.warning(f"school_loop error: {e}")

        time.sleep(300)  # cek tiap 5 menit


# ---------------------------------------------------------------------------
# ─── DATABASE BACKUP LOOP ────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def db_backup_loop() -> None:
    """Periodic database backup (runs only if DB_BACKUP_ENABLED=true)."""
    if not DB_BACKUP_ENABLED:
        return
    logger.info(f"✅ DB backup loop aktif (interval {DB_BACKUP_INTERVAL_HOURS}h)")
    while True:
        time.sleep(DB_BACKUP_INTERVAL_HOURS * 3600)
        try:
            res = backup_database()
            if res["ok"]:
                logger.info(f"💾 Backup: {res['file']}")
            # Prune to keep latest 10
            for b in list_backups()[10:]:
                try:
                    os.remove(os.path.join(DB_BACKUP_DIR, b["file"]))
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Backup loop: {e}")


# ---------------------------------------------------------------------------
# ─── 9. MAIN LOOP ───────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def main_loop():
    global daily_start_equity, _last_signal_time
    # Load posisi tersimpan sebelum mulai loop
    load_state()

    if LIVE_MODE and (BINANCE_API_KEY or MEXC_API_KEY or BYBIT_API_KEY):
        daily_start_equity = get_exchange_equity()
        logger.info(f"💰 Equity awal {ACTIVE_EXCHANGE.upper()}: {daily_start_equity} USDT")

    with pairs_lock:
        n_pairs = len(active_pairs)
    logger.info(f"🤖 Bot mulai | LIVE_MODE={LIVE_MODE} | memindai {n_pairs} pair | {CANDLE_INTERVAL}")

    topic_info = (
        f"\n\n📌 *Topics:*\n"
        f"Buy        : `{TELEGRAM_BUY_TOPIC_ID    or 'general'}`\n"
        f"Sell       : `{TELEGRAM_SELL_TOPIC_ID   or 'general'}`\n"
        f"Hold/update: `{TELEGRAM_HOLD_TOPIC_ID   or 'general'}`\n"
        f"Tren naik  : `{TELEGRAM_BULL_TOPIC_ID   or 'general'}`\n"
        f"Tren turun : `{TELEGRAM_BEAR_TOPIC_ID   or 'general'}`\n"
        f"Laporan    : `{TELEGRAM_REPORT_TOPIC_ID or 'general'}`\n"
        f"Berita     : `{TELEGRAM_NEWS_TOPIC_ID   or 'general'}`\n"
        f"Chat AI    : `{TELEGRAM_CHAT_TOPIC_ID   or 'general'}`"
    )
    # Ambil portfolio untuk ditampilkan di startup (hanya informasional)
    # daily_start_equity sudah di-set dari get_binance_equity() (USDT-only) di atas
    portfolio = get_binance_portfolio() if LIVE_MODE and BINANCE_API_KEY else {}
    if portfolio and not portfolio.get("error"):
        portfolio_text = "\n\n" + format_portfolio_text(portfolio)
    elif portfolio.get("error"):
        portfolio_text = f"\n\n⚠️ Gagal ambil saldo: {portfolio['error']}"
    else:
        portfolio_text = ""

    mode_label = (
        "🟡 TESTNET \\(uang virtual\\)" if BINANCE_TESTNET
        else ("🔴 LIVE \\(uang beneran\\)" if LIVE_MODE else "🔵 Simulasi")
    )
    with positions_lock:
        n_recovered = len(open_positions)
    recovery_note = f"\n♻️ *{n_recovered} posisi dipulihkan dari restart*" if n_recovered else ""
    send_telegram_message(
        f"👋 *Bot trading udah nyala nih\\!*{recovery_note}\n\n"
        f"Exchange : {ACTIVE_EXCHANGE.upper()} Spot\n"
        f"Mode     : {mode_label}\n"
        f"Pair     : memindai `{n_pairs}` pair USDT setiap `{CANDLE_INTERVAL}`\n"
        f"AI       : Multi\\-model via 9Router \\(Primary \\+ Validators\\)\n"
        f"Filter   : Multi\\-TF 1m\\+5m\\+15m \\+ Funding Rate \\+ Open Interest\n"
        f"TP/SL    : ATR\\-based dynamic \\(R:R 1:{int(TP_ATR_MULT/SL_ATR_MULT)}\\)\n"
        f"Trailing : {'✅ aktif' if TRAILING_SL_ENABLED else '❌ nonaktif'} "
        f"\\(aktif di \\+{TRAILING_SL_ACTIVATE_PCT}%, trail {TRAILING_SL_TRAIL_PCT}%\\)\n"
        f"Modal    : `{int(CAPITAL_ALLOCATION_PCT*100)}%` saldo \\| max `{MAX_CONCURRENT_POSITIONS}` posisi\n"
        f"Min yakin: `{CONFIDENCE_THRESHOLD}%`\n\n"
        f"📊 *Perintah:* `/start` `/stop` `/pause` `/resume` `/saldo` `/posisi` `/laporan` `/tutup SYMBOL`"
        + portfolio_text
        + topic_info,
        topic_id=None,
    )

    while True:
        try:
            # ── Pause guard: kalau bot di-pause, skip cycle tapi tetap jaga posisi
            with bot_paused_lock:
                paused = bot_paused
            if paused:
                time.sleep(10)
                continue

            with pairs_lock:
                pairs_snapshot = list(active_pairs)

            ai_calls_this_cycle = 0
            cycle_start = time.time()

            for symbol in pairs_snapshot:
                # Cek pause di tengah loop juga
                with bot_paused_lock:
                    if bot_paused:
                        break

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

                    # ── 🧠 Smart analysis: Regime + Confluence + Feedback ──
                    regime     = detect_market_regime(df_1m, df_5m, df_15m)
                    confluence = calc_confluence_score(df_1m, df_5m, df_15m)
                    feedback   = get_pair_feedback(symbol)

                    logger.debug(
                        f"Smart {symbol}: {regime['regime']}({regime['strength']}) "
                        f"confluence={confluence['score']*100:.0f}%({confluence['direction']}) "
                        f"feedback={feedback['label']}(WR={feedback['win_rate']*100:.0f}%)"
                    )

                    last = df_1m.iloc[-1]
                    current_price = float(last["close"])
                    atr = float(last["atr14"]) if not pd.isna(last["atr14"]) else 0.0

                    signal = ask_ai(
                        symbol, df_1m,
                        df_5m=df_5m, df_15m=df_15m,
                        funding=funding, oi_change=oi_change,
                        regime=regime, confluence=confluence, feedback=feedback,
                    )
                    ai_calls_this_cycle += 1
                    # Perbarui timestamp sinyal terakhir (untuk health monitor)
                    with _last_signal_lock:
                        _last_signal_time = time.time()
                    decision   = signal["decision"]
                    confidence = signal["confidence"]
                    reason     = signal["reason"]

                    # ── Hitung effective threshold dinamis ────────────────
                    # conf_adjust dari regime  : positif = lebih ketat
                    # boost dari confluence    : positif = lebih longgar
                    # adj dari feedback        : positif = lebih longgar
                    effective_threshold = int(
                        CONFIDENCE_THRESHOLD
                        + regime["conf_adjust"]
                        - confluence["boost"]
                        - feedback["adj"]
                    )
                    # Clamp 50–90 supaya tidak ekstrem
                    effective_threshold = max(50, min(90, effective_threshold))

                    # Ringkasan untuk log
                    fr_str = f" FR={funding['funding_rate_pct']:+.4f}%" if funding else ""
                    oi_str = f" OI={oi_change['trend']}" if oi_change else ""
                    logger.info(
                        f"AI → {symbol} {decision} ({confidence}% / threshold={effective_threshold}%)"
                        f"{fr_str}{oi_str} | regime={regime['regime']} | {reason}"
                    )

                    if confidence < effective_threshold:
                        log_trade(symbol, decision, 0, current_price, confidence, reason, "HOLD")
                        send_trend_message(
                            f"📊 *Update {symbol}*\n\n"
                            f"Sinyal    : *{decision}*\n"
                            f"Yakin     : `{confidence}%` — threshold `{effective_threshold}%`\n"
                            f"Regime    : `{regime['regime']}` ({regime['strength']})\n"
                            f"Konfluensi: `{confluence['score']*100:.0f}%` {confluence['direction']}\n\n"
                            f"💬 _{reason}_\n\n"
                            f"⏸ _Nunggu dulu, belum cukup yakin_",
                            decision=decision,
                            symbol=symbol,
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
            # Tunggu sampai timer habis ATAU /start dipanggil dari Telegram
            force_scan_event.wait(timeout=remaining)
            force_scan_event.clear()

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
    # ── Cek config kosong — beri tahu user untuk isi via /config ─────────────
    missing = [k for k, v in {
        "AI_BASE_URL":        AI_BASE_URL,
        "TELEGRAM_BOT_TOKEN": TELEGRAM_BOT_TOKEN,
        "TELEGRAM_CHAT_ID":   str(TELEGRAM_CHAT_ID),
    }.items() if not v or v == "0"]

    if missing:
        logger.warning(
            f"⚠️ Config belum lengkap: {', '.join(missing)}\n"
            f"   → Buka /config di dashboard bot untuk mengisi API key."
        )
        # Jalankan Flask saja supaya user bisa akses /config untuk isi key
        port = int(os.getenv("PORT", 3000))
        logger.info(f"🌐 Dashboard config tersedia di port {port} → /config")
        flask_app.run(host="0.0.0.0", port=port, use_reloader=False)
        raise SystemExit(0)

    if LIVE_MODE and ACTIVE_EXCHANGE == "binance" and not (BINANCE_API_KEY and BINANCE_API_SECRET):
        logger.warning("⚠️ BINANCE_API_KEY/SECRET belum diisi → buka /config")
        port = int(os.getenv("PORT", 3000))
        flask_app.run(host="0.0.0.0", port=port, use_reloader=False)
        raise SystemExit(0)

    if LIVE_MODE and ACTIVE_EXCHANGE == "mexc" and not (MEXC_API_KEY and MEXC_API_SECRET):
        logger.warning("⚠️ MEXC_API_KEY/SECRET belum diisi → buka /config")
        port = int(os.getenv("PORT", 3000))
        flask_app.run(host="0.0.0.0", port=port, use_reloader=False)
        raise SystemExit(0)

    if LIVE_MODE and ACTIVE_EXCHANGE == "bybit" and not (BYBIT_API_KEY and BYBIT_API_SECRET):
        logger.warning("⚠️ BYBIT_API_KEY/SECRET belum diisi → buka /config")
        port = int(os.getenv("PORT", 3000))
        flask_app.run(host="0.0.0.0", port=port, use_reloader=False)
        raise SystemExit(0)

    # Inisialisasi SQLite database (buat tabel trades + equity_snapshots)
    init_db()

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

    # Monitor kesehatan bot (no-signal alert, equity drop alert, equity snapshot)
    threading.Thread(target=health_monitor_loop, daemon=True).start()

    # DCA automation (beli otomatis sesuai jadwal per-symbol)
    threading.Thread(target=dca_monitor_loop, daemon=True).start()

    # Scheduled trading hours (auto pause/resume berdasarkan jam trading)
    threading.Thread(target=scheduled_pause_checker_loop, daemon=True).start()

    # Backup database berkala (hanya aktif kalau DB_BACKUP_ENABLED=true)
    threading.Thread(target=db_backup_loop, daemon=True).start()

    # Kalender Ekonomi — briefing harian + alert 15 menit sebelum event High/Medium
    threading.Thread(target=calendar_loop, daemon=True).start()

    # Strategi Trading — analisis AI 2× sehari (pagi & malam WIB)
    threading.Thread(target=strategy_loop, daemon=True).start()

    # Sekolah Trading — tips edukasi harian bergilir
    threading.Thread(target=school_loop, daemon=True).start()

    # Main trading loop
    main_loop()
