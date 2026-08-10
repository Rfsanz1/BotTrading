"""
Unit tests for trading bot core logic.
Run: cd trading-bot && python3 -m pytest tests/ -v
"""

import json
import math
import os
import sys
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, MagicMock

# Add bot directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ─── Minimal stubs so main.py can be imported in test env ───────────────────
os.environ.setdefault("TELEGRAM_CHAT_ID", "0")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "stub")
os.environ.setdefault("GROQ_API_KEY", "stub")  # legacy key still read by _cfg() at import
os.environ.setdefault("PORT", "19999")

_requests_patcher = patch(
    "requests.get", return_value=MagicMock(status_code=200, json=lambda: [])
)
_requests_patcher.start()


# ═══════════════════════════════════════════════════════════════════════════
# 1. RISK MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════

class TestRiskManagement(unittest.TestCase):
    """Tests for position sizing and risk limits."""

    def test_round_step_exact_multiple(self):
        import main as bot
        self.assertAlmostEqual(bot._round_step(0.123456, 0.001), 0.123)

    def test_round_step_zero_step(self):
        import main as bot
        self.assertAlmostEqual(bot._round_step(1.5, 0.0), 1.5)

    def test_round_step_large_value(self):
        import main as bot
        self.assertAlmostEqual(bot._round_step(12345.6789, 1.0), 12345.0)

    def test_kelly_multiplier_neutral_winrate(self):
        with patch("main.get_recent_win_rate", return_value=0.5):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertAlmostEqual(mult, 0.75)

    def test_kelly_multiplier_high_winrate(self):
        with patch("main.get_recent_win_rate", return_value=0.75):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertAlmostEqual(mult, 1.5)

    def test_kelly_multiplier_low_winrate(self):
        with patch("main.get_recent_win_rate", return_value=0.25):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertAlmostEqual(mult, 0.5)

    def test_kelly_disabled(self):
        with patch("main.KELLY_SIZING_ENABLED", False):
            import main as bot
            self.assertAlmostEqual(bot._kelly_multiplier(), 1.0)

    def test_kelly_clamps_at_minimum(self):
        """Kelly multiplier should never go below 0.5."""
        with patch("main.get_recent_win_rate", return_value=0.0):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertGreaterEqual(mult, 0.5)

    def test_kelly_clamps_at_maximum(self):
        """Kelly multiplier should never exceed 1.5."""
        with patch("main.get_recent_win_rate", return_value=1.0):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertLessEqual(mult, 1.5)


# ═══════════════════════════════════════════════════════════════════════════
# 2. ANALYTICS ENGINE
# ═══════════════════════════════════════════════════════════════════════════

class TestAnalyticsEngine(unittest.TestCase):
    """Tests for the analytics computation engine."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name

    def tearDown(self):
        os.unlink(self.db_path)

    def _create_db(self, rows=None):
        if rows is None:
            rows = [
                ("2026-07-15T10:00:00+00:00", "BTCUSDT",  5.0, "CLOSED_TP"),
                ("2026-07-15T11:00:00+00:00", "BTCUSDT", -2.0, "CLOSED_SL"),
                ("2026-07-16T10:00:00+00:00", "ETHUSDT",  3.0, "CLOSED_TP"),
                ("2026-07-16T11:00:00+00:00", "ETHUSDT", -1.0, "CLOSED_SL"),
                ("2026-07-17T10:00:00+00:00", "BTCUSDT",  4.0, "CLOSED_TP"),
            ]
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    id INTEGER PRIMARY KEY, timestamp TEXT, symbol TEXT,
                    pnl REAL, result TEXT
                )
            """)
            conn.executemany(
                "INSERT INTO trades (timestamp, symbol, pnl, result) VALUES (?,?,?,?)",
                rows,
            )
            conn.commit()

    def test_compute_analytics_basic(self):
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertEqual(result["trades_count"], 5)
        self.assertAlmostEqual(result["total_pnl"], 9.0)

    def test_compute_analytics_win_rate(self):
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        # 3 wins, 2 losses → 60 %
        self.assertAlmostEqual(result["win_rate"], 60.0)

    def test_compute_analytics_empty_db(self):
        self._create_db(rows=[])
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertEqual(result["trades_count"], 0)
        self.assertAlmostEqual(result["total_pnl"], 0.0)

    def test_compute_analytics_all_wins(self):
        rows = [
            ("2026-07-17T10:00:00+00:00", "BTCUSDT", 3.0, "CLOSED_TP"),
            ("2026-07-17T11:00:00+00:00", "ETHUSDT", 2.0, "CLOSED_TP"),
        ]
        self._create_db(rows=rows)
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertAlmostEqual(result["win_rate"], 100.0)
        self.assertGreater(result["gross_profit"], 0)
        self.assertAlmostEqual(result["gross_loss"], 0.0)

    def test_compute_analytics_by_symbol(self):
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        symbols = {s["symbol"] for s in result.get("by_symbol", [])}
        self.assertIn("BTCUSDT", symbols)
        self.assertIn("ETHUSDT", symbols)

    def test_daily_report_today(self):
        """compute_daily_report reads from TRADES_LOG (JSONL file)."""
        import json, tempfile, os
        from datetime import datetime, timezone
        import main as bot

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        records = [
            {"timestamp": f"{today}T10:00:00+00:00", "symbol": "BTCUSDT", "pnl": 5.0,  "result": "CLOSED_TP"},
            {"timestamp": f"{today}T11:00:00+00:00", "symbol": "ETHUSDT", "pnl": -1.5, "result": "CLOSED_SL"},
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            for r in records:
                f.write(json.dumps(r) + "\n")
            log_path = f.name
        try:
            with patch("main.TRADES_LOG", log_path):
                report = bot.compute_daily_report(today)
            self.assertAlmostEqual(report["total_pnl"], 3.5)
            self.assertEqual(report["wins"], 1)
            self.assertEqual(report["losses"], 1)
        finally:
            os.unlink(log_path)

    def test_daily_report_empty(self):
        """compute_daily_report returns zeroes when no log file exists."""
        import main as bot
        with patch("main.TRADES_LOG", "/tmp/nonexistent_trades_xyz.log"):
            report = bot.compute_daily_report("2026-07-17")
        self.assertAlmostEqual(report["total_pnl"], 0.0)
        self.assertAlmostEqual(report["win_rate"], 0.0)


# ═══════════════════════════════════════════════════════════════════════════
# 3. MATH HELPERS
# ═══════════════════════════════════════════════════════════════════════════

class TestMathHelpers(unittest.TestCase):

    def test_sharpe_zero_std(self):
        """Sharpe: constant PnL → std=0 → sharpe=0 (no division error)."""
        pnls = [1.0] * 10
        mu = sum(pnls) / len(pnls)
        variance = sum((p - mu) ** 2 for p in pnls) / (len(pnls) - 1)
        std = math.sqrt(variance) if variance > 0 else 0
        sharpe = (mu / std * math.sqrt(252)) if std > 0 else 0
        self.assertEqual(sharpe, 0)

    def test_consecutive_wins_counter(self):
        pnls = [1, -1, 1, 1, 1, -1]
        cw = cl = max_cw = max_cl = 0
        for p in pnls:
            if p > 0:
                cw += 1; cl = 0; max_cw = max(max_cw, cw)
            else:
                cl += 1; cw = 0; max_cl = max(max_cl, cl)
        self.assertEqual(max_cw, 3)
        self.assertEqual(max_cl, 1)

    def test_round_price_precision(self):
        import main as bot
        result = bot._round_price(0.12345, 0.0001)
        self.assertAlmostEqual(result, 0.1234, places=4)
        self.assertLessEqual(result, 0.12345 + 1e-9)

    def test_round_price_large_tick(self):
        """_round_price rounds to NEAREST step (not floor), per Binance PRICE_FILTER."""
        import main as bot
        result = bot._round_price(1234.56, 1.0)
        # 1234.56 / 1.0 → rounds to 1235; result = 1235.0
        self.assertAlmostEqual(result, 1235.0, places=4)

    def test_round_step_fractional(self):
        import main as bot
        result = bot._round_step(0.9876, 0.01)
        self.assertAlmostEqual(result, 0.98, places=6)


# ═══════════════════════════════════════════════════════════════════════════
# 4. VACATION MODE
# ═══════════════════════════════════════════════════════════════════════════

class TestVacationMode(unittest.TestCase):

    def test_get_vacation_mode_default(self):
        import main as bot
        result = bot.get_vacation_mode()
        self.assertIsInstance(result, bool)

    def test_set_vacation_mode_on(self):
        import main as bot
        with patch("main.send_telegram_message"):
            with patch("main.log_audit"):
                bot.set_vacation_mode(True)
                self.assertTrue(bot.get_vacation_mode())

    def test_set_vacation_mode_off(self):
        import main as bot
        with patch("main.send_telegram_message"):
            with patch("main.log_audit"):
                bot.set_vacation_mode(True)
                bot.set_vacation_mode(False)
                self.assertFalse(bot.get_vacation_mode())

    def test_vacation_mode_idempotent(self):
        import main as bot
        with patch("main.send_telegram_message"):
            with patch("main.log_audit"):
                bot.set_vacation_mode(False)
                bot.set_vacation_mode(False)
                self.assertFalse(bot.get_vacation_mode())


# ═══════════════════════════════════════════════════════════════════════════
# 5. TELEGRAM TOPIC ROUTING
# ═══════════════════════════════════════════════════════════════════════════

class TestTelegramTopicRouting(unittest.TestCase):
    """Trading signals must stay separate from portfolio/trend updates."""

    def test_buy_watchlist_update_uses_buy_topic(self):
        import main as bot
        with patch.object(bot, "TELEGRAM_BUY_TOPIC_ID", 5), \
             patch.object(bot, "TELEGRAM_BULL_TOPIC_ID", 4), \
             patch.object(bot, "send_telegram_message") as send:
            bot.send_trend_message("BUY belum cukup yakin", decision="BUY",
                                   symbol="BTCUSDT")
            send.assert_called_once_with("BUY belum cukup yakin", topic_id=5)

    def test_sell_watchlist_update_uses_sell_topic(self):
        import main as bot
        with patch.object(bot, "TELEGRAM_SELL_TOPIC_ID", 6), \
             patch.object(bot, "TELEGRAM_BEAR_TOPIC_ID", 3), \
             patch.object(bot, "send_telegram_message") as send:
            bot.send_trend_message("SELL belum cukup yakin", decision="SELL",
                                   symbol="BTCUSDT")
            send.assert_called_once_with("SELL belum cukup yakin", topic_id=6)


# ═══════════════════════════════════════════════════════════════════════════
# 6. SCHEDULE CONFIG
# ═══════════════════════════════════════════════════════════════════════════

class TestScheduleConfig(unittest.TestCase):

    def test_get_schedule_returns_dict(self):
        import main as bot
        cfg = bot.get_schedule_config()
        self.assertIsInstance(cfg, dict)

    def test_save_and_load_schedule(self):
        """save_schedule_config uses trading_start_hour / trading_end_hour keys."""
        import main as bot
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        try:
            # Create the required schema in the temp DB
            with sqlite3.connect(tmp.name) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS schedule_config (
                        id INTEGER PRIMARY KEY,
                        trading_start_hour INTEGER DEFAULT 0,
                        trading_end_hour   INTEGER DEFAULT 24,
                        trading_days       TEXT    DEFAULT '0,1,2,3,4,5,6',
                        enabled            INTEGER DEFAULT 0
                    )
                """)
                conn.commit()
            with patch("main.DB_FILE", tmp.name):
                bot.save_schedule_config({
                    "enabled": 1,
                    "trading_start_hour": 8,
                    "trading_end_hour": 20,
                    "trading_days": "0,1,2,3,4,5,6",
                })
                loaded = bot.get_schedule_config()
            self.assertEqual(loaded.get("trading_start_hour"), 8)
            self.assertEqual(loaded.get("trading_end_hour"), 20)
            self.assertEqual(loaded.get("enabled"), 1)
        finally:
            os.unlink(tmp.name)

    def test_schedule_enabled_flag(self):
        import main as bot
        original = bot.get_schedule_config()
        bot.save_schedule_config({**original, "enabled": False})
        loaded = bot.get_schedule_config()
        self.assertFalse(loaded.get("enabled"))
        bot.save_schedule_config(original)


# ═══════════════════════════════════════════════════════════════════════════
# 7. FLASK API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class TestFlaskAPI(unittest.TestCase):
    """Integration tests for Flask API routes using the test client."""

    @classmethod
    def setUpClass(cls):
        import main as bot
        cls.client = bot.flask_app.test_client()
        bot.flask_app.config["TESTING"] = True

    def test_status_endpoint_returns_200(self):
        resp = self.client.get("/api/status")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("paused", data)
        self.assertIn("open_positions", data)

    def test_positions_endpoint_returns_list(self):
        resp = self.client.get("/api/positions")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIsInstance(data, list)

    def test_daily_endpoint_returns_dict(self):
        resp = self.client.get("/api/daily")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("total_pnl", data)

    def test_analytics_endpoint_returns_dict(self):
        resp = self.client.get("/api/analytics")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("trades_count", data)

    def test_config_endpoint_masks_secrets(self):
        resp = self.client.get("/api/config")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        # Sensitive keys should not be returned in plaintext
        self.assertNotIn("BINANCE_API_KEY", data)
        self.assertNotIn("BINANCE_API_SECRET", data)

    def test_vacation_endpoint(self):
        resp = self.client.get("/api/vacation")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("vacation_mode", data)

    def test_schedule_endpoint(self):
        resp = self.client.get("/api/schedule")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIsInstance(data, dict)

    def test_system_endpoint(self):
        resp = self.client.get("/api/system")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("cpu_pct", data)

    def test_auth_required_endpoint(self):
        resp = self.client.get("/api/auth/required")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("required", data)
        self.assertIsInstance(data["required"], bool)

    def test_auth_verify_no_key_configured(self):
        """When DASHBOARD_API_KEY is empty, verify returns {valid: False}."""
        import main as bot
        with patch("main.DASHBOARD_API_KEY", ""):
            resp = self.client.post(
                "/api/auth/verify",
                data=json.dumps({"key": "anything"}),
                content_type="application/json",
            )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertFalse(data["valid"])

    def test_auth_verify_correct_key(self):
        import main as bot
        with patch("main.DASHBOARD_API_KEY", "secret123"):
            resp = self.client.post(
                "/api/auth/verify",
                data=json.dumps({"key": "secret123"}),
                content_type="application/json",
            )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertTrue(data["valid"])

    def test_auth_verify_wrong_key(self):
        import main as bot
        with patch("main.DASHBOARD_API_KEY", "secret123"):
            resp = self.client.post(
                "/api/auth/verify",
                data=json.dumps({"key": "wrongkey"}),
                content_type="application/json",
            )
        data = json.loads(resp.data)
        self.assertFalse(data["valid"])

    def test_write_endpoint_blocked_without_key(self):
        """POST /api/bot/pause requires X-Dashboard-Key when key is configured."""
        import main as bot
        with patch("main.DASHBOARD_API_KEY", "secret123"):
            resp = self.client.post("/api/bot/pause")
        self.assertIn(resp.status_code, (401, 503))

    def test_write_endpoint_allowed_with_key(self):
        import main as bot
        with patch("main.DASHBOARD_API_KEY", "secret123"):
            with patch("main.send_telegram_message"):
                with patch("main.log_audit"):
                    resp = self.client.post(
                        "/api/bot/pause",
                        headers={"X-Dashboard-Key": "secret123"},
                    )
        self.assertIn(resp.status_code, (200, 201))

    def test_history_endpoint(self):
        resp = self.client.get("/api/history")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("equity_history", data)

    def test_healthz_detail_endpoint(self):
        """Healthz returns a dict with a 'status' key (not 'ok')."""
        resp = self.client.get("/api/healthz/detail")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("status", data)
        self.assertIn("checks", data)
        self.assertIsInstance(data["checks"], dict)

    def test_dca_endpoint_returns_list(self):
        resp = self.client.get("/api/dca")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIsInstance(data, list)

    def test_events_sse_payload_shape(self):
        """GET /api/events returns text/event-stream with correct payload shape."""
        import main as bot

        # Inject a synthetic open position so we can check field mapping
        fake_pos = {
            "entry_price":        100.0,
            "qty":                1.0,
            "tp_price":           103.0,
            "sl_price":           99.0,
            "original_sl_price":  99.0,
            "highest_price_seen": 101.5,   # used for unrealized_pct
            "trailing_sl_active": True,    # the real key in open_positions dict
            "breakeven_done":     False,
            "partial_tp_done":    False,
            "opened_at":          "2026-07-18T00:00:00+00:00",
            "asset_group":        "BTC",
        }
        with bot.positions_lock:
            bot.open_positions["TESTUSDT"] = fake_pos

        try:
            # Stream just the first SSE frame
            resp = self.client.get("/api/events")
            self.assertIn("text/event-stream", resp.content_type)

            # Read first data: line from the streamed response
            raw = b""
            for chunk in resp.response:
                raw += chunk
                if b"\n\n" in raw:
                    break

            frame = raw.split(b"data: ", 1)[1].split(b"\n\n")[0]
            payload = json.loads(frame)

            # ── status sub-object ──────────────────────────────────────────
            self.assertIn("status", payload)
            self.assertIn("positions", payload)
            s = payload["status"]
            self.assertIn("paused", s)
            self.assertIn("open_positions", s)
            self.assertIn("daily_pnl", s)

            # ── positions sub-object ───────────────────────────────────────
            positions = payload["positions"]
            self.assertEqual(len(positions), 1)
            p = positions[0]

            # unrealized_pct must be computed from highest_price_seen, NOT 0
            expected_pct = round((101.5 / 100.0 - 1) * 100, 2)   # 1.5
            self.assertAlmostEqual(p["unrealized_pct"], expected_pct, places=4,
                msg="unrealized_pct must be computed from highest_price_seen")

            # trailing_active must read from trailing_sl_active key
            self.assertTrue(p["trailing_active"],
                msg="trailing_active must reflect trailing_sl_active from position dict")

            # other expected keys
            self.assertEqual(p["symbol"], "TESTUSDT")
            self.assertAlmostEqual(p["entry_price"], 100.0)
            self.assertAlmostEqual(p["tp_price"], 103.0)
            self.assertAlmostEqual(p["sl_price"], 99.0)
            self.assertEqual(p["asset_group"], "BTC")
        finally:
            with bot.positions_lock:
                bot.open_positions.pop("TESTUSDT", None)

    def test_backup_list_endpoint(self):
        resp = self.client.get("/api/backup/list")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIsInstance(data, list)

    def test_audit_endpoint(self):
        resp = self.client.get("/api/audit")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIsInstance(data, list)


# ═══════════════════════════════════════════════════════════════════════════
# 7. ASSET GROUP CLASSIFICATION
# ═══════════════════════════════════════════════════════════════════════════

class TestAssetGrouping(unittest.TestCase):

    def test_btc_group(self):
        import main as bot
        group = bot._get_asset_group("BTCUSDT")
        self.assertIsInstance(group, str)

    def test_eth_group(self):
        import main as bot
        group = bot._get_asset_group("ETHUSDT")
        self.assertIsInstance(group, str)

    def test_unknown_symbol_returns_string(self):
        import main as bot
        group = bot._get_asset_group("XYZUSDT")
        self.assertIsInstance(group, str)


# ═══════════════════════════════════════════════════════════════════════════
# 8. RECENT WIN RATE
# ═══════════════════════════════════════════════════════════════════════════

class TestWinRate(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()

    def tearDown(self):
        os.unlink(self.tmp.name)

    def _seed(self, rows):
        with sqlite3.connect(self.tmp.name) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    id INTEGER PRIMARY KEY, timestamp TEXT, symbol TEXT,
                    pnl REAL, result TEXT
                )
            """)
            conn.executemany(
                "INSERT INTO trades (timestamp, symbol, pnl, result) VALUES (?,?,?,?)",
                rows,
            )
            conn.commit()

    def test_win_rate_perfect(self):
        """Requires >= 5 trades to leave neutral; 5 TP rows → 1.0."""
        self._seed([
            ("2026-07-17T10:00:00+00:00", "BTCUSDT", 1.0, "CLOSED_TP"),
            ("2026-07-17T11:00:00+00:00", "ETHUSDT", 2.0, "CLOSED_TP"),
            ("2026-07-17T12:00:00+00:00", "BNBUSDT", 1.5, "CLOSED_TP"),
            ("2026-07-17T13:00:00+00:00", "SOLUSDT", 0.8, "CLOSED_TP"),
            ("2026-07-17T14:00:00+00:00", "ADAUSDT", 1.2, "CLOSED_TP"),
        ])
        import main as bot
        with patch("main.DB_FILE", self.tmp.name):
            wr = bot.get_recent_win_rate(lookback=20)
        self.assertAlmostEqual(wr, 1.0)

    def test_win_rate_zero(self):
        """5 SL rows → win rate 0.0."""
        self._seed([
            ("2026-07-17T10:00:00+00:00", "BTCUSDT", -1.0, "CLOSED_SL"),
            ("2026-07-17T11:00:00+00:00", "ETHUSDT", -2.0, "CLOSED_SL"),
            ("2026-07-17T12:00:00+00:00", "BNBUSDT", -0.5, "CLOSED_SL"),
            ("2026-07-17T13:00:00+00:00", "SOLUSDT", -1.5, "CLOSED_SL"),
            ("2026-07-17T14:00:00+00:00", "ADAUSDT", -0.8, "CLOSED_SL"),
        ])
        import main as bot
        with patch("main.DB_FILE", self.tmp.name):
            wr = bot.get_recent_win_rate(lookback=20)
        self.assertAlmostEqual(wr, 0.0)

    def test_win_rate_empty_returns_half(self):
        """< 5 trades → returns neutral 0.5 regardless of results."""
        self._seed([])
        import main as bot
        with patch("main.DB_FILE", self.tmp.name):
            wr = bot.get_recent_win_rate(lookback=20)
        self.assertAlmostEqual(wr, 0.5)

    def test_win_rate_insufficient_data_returns_half(self):
        """4 trades (< 5 threshold) → still returns 0.5."""
        self._seed([
            ("2026-07-17T10:00:00+00:00", "BTCUSDT", 1.0, "CLOSED_TP"),
            ("2026-07-17T11:00:00+00:00", "ETHUSDT", 2.0, "CLOSED_TP"),
            ("2026-07-17T12:00:00+00:00", "BNBUSDT", 1.5, "CLOSED_TP"),
            ("2026-07-17T13:00:00+00:00", "SOLUSDT", 0.8, "CLOSED_TP"),
        ])
        import main as bot
        with patch("main.DB_FILE", self.tmp.name):
            wr = bot.get_recent_win_rate(lookback=20)
        self.assertAlmostEqual(wr, 0.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
