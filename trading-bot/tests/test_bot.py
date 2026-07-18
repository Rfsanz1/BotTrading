"""
Unit tests for trading bot core logic.
Run: python3 -m pytest trading-bot/tests/ -v
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
os.environ.setdefault("GROQ_API_KEY", "stub")
os.environ.setdefault("PORT", "19999")

# Patch blocking calls before import
_requests_patcher = patch("requests.get", return_value=MagicMock(status_code=200, json=lambda: []))
_requests_patcher.start()


class TestRiskManagement(unittest.TestCase):
    """Tests for position sizing and risk limits."""

    def test_round_step_exact_multiple(self):
        """_round_step should floor to the step size."""
        import main as bot
        self.assertAlmostEqual(bot._round_step(0.123456, 0.001), 0.123)

    def test_round_step_zero_step(self):
        """_round_step with step=0 returns value unchanged."""
        import main as bot
        self.assertAlmostEqual(bot._round_step(1.5, 0.0), 1.5)

    def test_kelly_multiplier_neutral_winrate(self):
        """Kelly multiplier at 50% WR should be 0.75x."""
        with patch("main.get_recent_win_rate", return_value=0.5):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertAlmostEqual(mult, 0.75)

    def test_kelly_multiplier_high_winrate(self):
        """Kelly multiplier at 75% WR should be 1.5x."""
        with patch("main.get_recent_win_rate", return_value=0.75):
            with patch("main.KELLY_SIZING_ENABLED", True):
                import main as bot
                mult = bot._kelly_multiplier()
                self.assertAlmostEqual(mult, 1.5)

    def test_kelly_disabled(self):
        """Kelly multiplier should be 1.0 when disabled."""
        with patch("main.KELLY_SIZING_ENABLED", False):
            import main as bot
            self.assertAlmostEqual(bot._kelly_multiplier(), 1.0)


class TestAnalyticsEngine(unittest.TestCase):
    """Tests for the analytics computation engine."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name

    def tearDown(self):
        os.unlink(self.db_path)

    def _create_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    id INTEGER PRIMARY KEY, timestamp TEXT, symbol TEXT,
                    pnl REAL, result TEXT
                )
            """)
            conn.executemany(
                "INSERT INTO trades (timestamp, symbol, pnl, result) VALUES (?,?,?,?)",
                [
                    ("2026-07-15T10:00:00+00:00", "BTCUSDT", 5.0,  "CLOSED_TP"),
                    ("2026-07-15T11:00:00+00:00", "BTCUSDT", -2.0, "CLOSED_SL"),
                    ("2026-07-16T10:00:00+00:00", "ETHUSDT", 3.0,  "CLOSED_TP"),
                    ("2026-07-16T11:00:00+00:00", "ETHUSDT", -1.0, "CLOSED_SL"),
                    ("2026-07-17T10:00:00+00:00", "BTCUSDT", 4.0,  "CLOSED_TP"),
                ]
            )
            conn.commit()

    def test_compute_analytics_basic(self):
        """compute_analytics returns correct win_rate and total_pnl."""
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertEqual(result["trades_count"], 5)
        self.assertAlmostEqual(result["total_pnl"], 9.0)
        self.assertAlmostEqual(result["win_rate"], 60.0)

    def test_compute_analytics_empty(self):
        """compute_analytics with no data returns zero metrics."""
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertEqual(result["trades_count"], 0)
        self.assertEqual(result["sharpe_ratio"], 0)

    def test_sharpe_ratio_positive_for_positive_trades(self):
        """Sharpe ratio is positive when mean PnL > 0."""
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertGreater(result["sharpe_ratio"], 0)

    def test_max_drawdown_nonnegative(self):
        """Max drawdown should always be >= 0."""
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertGreaterEqual(result["max_drawdown_usdt"], 0)

    def test_profit_factor_positive(self):
        """Profit factor > 1 when profits exceed losses."""
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        self.assertGreater(result["profit_factor"], 1.0)

    def test_by_symbol_sorted_by_pnl(self):
        """by_symbol should be sorted descending by PnL."""
        self._create_db()
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.compute_analytics(days=30)
        pnls = [s["pnl"] for s in result["by_symbol"]]
        self.assertEqual(pnls, sorted(pnls, reverse=True))


class TestBacktestEngine(unittest.TestCase):
    """Tests for the backtesting engine."""

    def _make_kline(self, price, rsi_low=False):
        """Helper: create a Binance-format kline row."""
        p = str(price)
        low = str(price * 0.998) if not rsi_low else str(price * 0.95)
        return [0, p, str(price * 1.002), low, p, "100", 0, "0", 0, "0", "0", "0"]

    def test_backtest_returns_required_keys(self):
        """run_backtest result has all expected top-level keys."""
        import main as bot
        mock_klines = [self._make_kline(50000 + i) for i in range(100)]
        mock_resp = MagicMock(status_code=200, json=lambda: mock_klines)
        with patch("requests.get", return_value=mock_resp):
            result = bot.run_backtest("BTCUSDT", days=7, initial_capital=1000)
        for key in ["symbol", "candles", "initial_capital", "final_capital",
                    "total_pnl", "win_rate", "trades_count", "params"]:
            self.assertIn(key, result)

    def test_backtest_no_data_returns_error(self):
        """run_backtest returns error dict when data insufficient."""
        import main as bot
        mock_resp = MagicMock(status_code=200, json=lambda: [])
        with patch("requests.get", return_value=mock_resp):
            result = bot.run_backtest("BTCUSDT")
        self.assertIn("error", result)

    def test_backtest_api_error(self):
        """run_backtest returns error on non-200 response."""
        import main as bot
        mock_resp = MagicMock(status_code=503, json=lambda: {})
        with patch("requests.get", return_value=mock_resp):
            result = bot.run_backtest("BTCUSDT")
        self.assertIn("error", result)


class TestIndicators(unittest.TestCase):
    """Tests for technical indicator computations."""

    def _make_df(self, prices):
        import pandas as pd
        import main as bot
        data = {
            "open":  prices, "high":  [p * 1.002 for p in prices],
            "low":   [p * 0.998 for p in prices], "close": prices,
            "volume": [1000.0] * len(prices),
        }
        df = pd.DataFrame(data)
        return bot.compute_indicators(df)

    def test_rsi_range(self):
        """RSI values (rsi14) should always be between 0 and 100."""
        prices = [100 + i for i in range(50)]
        df = self._make_df(prices)
        self.assertIn("rsi14", df.columns)
        valid = df["rsi14"].dropna()
        self.assertTrue((valid >= 0).all() and (valid <= 100).all())

    def test_macd_line_exists(self):
        """compute_indicators should produce a macd column."""
        prices = [100 + i for i in range(50)]
        df = self._make_df(prices)
        self.assertIn("macd", df.columns)

    def test_atr_nonnegative(self):
        """ATR (atr14) should be >= 0."""
        prices = [100 + i % 5 for i in range(50)]
        df = self._make_df(prices)
        self.assertIn("atr14", df.columns)
        valid = df["atr14"].dropna()
        self.assertTrue((valid >= 0).all())


class TestSystemResources(unittest.TestCase):
    """Tests for system resource monitoring."""

    def test_get_system_resources_keys(self):
        """get_system_resources returns all expected keys."""
        import main as bot
        res = bot.get_system_resources()
        for key in ["cpu_pct", "mem_pct", "disk_pct", "bot_uptime_sec"]:
            self.assertIn(key, res)

    def test_get_system_resources_ranges(self):
        """CPU and memory percentages should be 0-100."""
        import main as bot
        res = bot.get_system_resources()
        if "error" not in res:
            self.assertGreaterEqual(res["cpu_pct"], 0)
            self.assertLessEqual(res["cpu_pct"], 100)
            self.assertGreaterEqual(res["mem_pct"], 0)
            self.assertLessEqual(res["mem_pct"], 100)


class TestConfigLoader(unittest.TestCase):
    """Tests for the config.json loader."""

    def test_cfg_falls_back_to_env(self):
        """_cfg should return env var when key not in config.json."""
        import main as bot
        with patch("main._BOT_CONFIG", {}):
            with patch.dict(os.environ, {"TEST_KEY_XYZ": "hello"}):
                val = bot._cfg("TEST_KEY_XYZ", "default")
        self.assertEqual(val, "hello")

    def test_cfg_config_json_priority(self):
        """_cfg should prefer config.json over env var."""
        import main as bot
        with patch("main._BOT_CONFIG", {"TEST_KEY_XYZ": "from_config"}):
            with patch.dict(os.environ, {"TEST_KEY_XYZ": "from_env"}):
                val = bot._cfg("TEST_KEY_XYZ", "default")
        self.assertEqual(val, "from_config")

    def test_cfg_default_when_missing(self):
        """_cfg should return default when key not in config or env."""
        import main as bot
        with patch("main._BOT_CONFIG", {}):
            val = bot._cfg("NONEXISTENT_KEY_12345", "mydefault")
        self.assertEqual(val, "mydefault")


class TestDailyReport(unittest.TestCase):
    """Tests for daily report computation."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            suffix=".log", mode="w", delete=False
        )
        self.log_path = self.tmp.name

    def tearDown(self):
        os.unlink(self.log_path)

    def _write_log(self, records):
        with open(self.log_path, "w") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")

    def test_daily_report_counts_wins_losses(self):
        """compute_daily_report counts TP as win, SL as loss."""
        import main as bot
        date_str = "2026-07-17"
        records = [
            {"timestamp": f"{date_str}T10:00:00", "result": "CLOSED_TP", "pnl": 5.0},
            {"timestamp": f"{date_str}T11:00:00", "result": "CLOSED_TP", "pnl": 3.0},
            {"timestamp": f"{date_str}T12:00:00", "result": "CLOSED_SL", "pnl": -2.0},
        ]
        self._write_log(records)
        with patch("main.TRADES_LOG", self.log_path):
            result = bot.compute_daily_report(date_str)
        self.assertEqual(result["wins"], 2)
        self.assertEqual(result["losses"], 1)
        self.assertAlmostEqual(result["total_pnl"], 6.0)
        self.assertAlmostEqual(result["win_rate"], 66.7, places=1)

    def test_daily_report_empty(self):
        """compute_daily_report returns zeros when no trades."""
        import main as bot
        self._write_log([])
        with patch("main.TRADES_LOG", self.log_path):
            result = bot.compute_daily_report("2026-07-17")
        self.assertEqual(result["trades_opened"], 0)
        self.assertEqual(result["wins"], 0)
        self.assertEqual(result["total_pnl"], 0)


class TestCorrelationFilter(unittest.TestCase):
    """Tests for the position correlation / asset-group filter."""

    def test_get_asset_group_btc(self):
        """BTC-related symbols should map to a BTC group."""
        import main as bot
        grp = bot._get_asset_group("BTCUSDT")
        self.assertIn("btc", grp.lower())

    def test_get_asset_group_eth(self):
        """ETH-related symbols should map to an ETH group."""
        import main as bot
        grp = bot._get_asset_group("ETHUSDT")
        self.assertIn("eth", grp.lower())

    def test_get_asset_group_other(self):
        """Unknown symbols should return a non-empty group string."""
        import main as bot
        grp = bot._get_asset_group("DOGEUSDT")
        self.assertIsInstance(grp, str)
        self.assertTrue(len(grp) > 0)


class TestEmailNotification(unittest.TestCase):
    """Tests for email notification helper."""

    def test_send_email_disabled_returns_false(self):
        """send_email_notification returns False when EMAIL_ENABLED=False."""
        import main as bot
        with patch("main.EMAIL_ENABLED", False):
            result = bot.send_email_notification("Test", "<b>body</b>")
        self.assertFalse(result)

    def test_send_email_missing_creds_returns_false(self):
        """send_email_notification returns False when credentials not set."""
        import main as bot
        with patch("main.EMAIL_ENABLED", True), \
             patch("main.EMAIL_FROM", ""), \
             patch("main.EMAIL_TO", ""), \
             patch("main.EMAIL_PASSWORD", ""):
            result = bot.send_email_notification("Test", "<b>body</b>")
        self.assertFalse(result)


class TestAuditLog(unittest.TestCase):
    """Tests for the audit log."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT, action TEXT, user TEXT, details TEXT
                )
            """)
            conn.commit()

    def tearDown(self):
        os.unlink(self.db_path)

    def test_log_audit_writes_entry(self):
        """log_audit should persist an entry to audit_log table."""
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            bot.log_audit("TEST_ACTION", "test details", "pytest")
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT action, user, details FROM audit_log").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "TEST_ACTION")
        self.assertEqual(rows[0][1], "pytest")

    def test_db_get_audit_log_returns_list(self):
        """db_get_audit_log should return a list."""
        import main as bot
        with patch("main.DB_FILE", self.db_path):
            result = bot.db_get_audit_log(50)
        self.assertIsInstance(result, list)


class TestVacationMode(unittest.TestCase):
    """Tests for vacation mode toggle."""

    def test_get_vacation_mode_default(self):
        """get_vacation_mode returns a bool."""
        import main as bot
        result = bot.get_vacation_mode()
        self.assertIsInstance(result, bool)

    def test_set_vacation_mode_state_change(self):
        """set_vacation_mode changes internal state."""
        import main as bot
        with patch("main.send_telegram_message"):
            with patch("main.log_audit"):
                bot.set_vacation_mode(True)
                self.assertTrue(bot.get_vacation_mode())
                bot.set_vacation_mode(False)
                self.assertFalse(bot.get_vacation_mode())


class TestMathHelpers(unittest.TestCase):
    """Pure math helper tests."""

    def test_sharpe_calculation(self):
        """Sharpe ratio: positive mean, zero std → 0 (not division error)."""
        pnls = [1.0] * 10  # all same → std = 0
        if len(pnls) > 1:
            mu = sum(pnls) / len(pnls)
            variance = sum((p - mu) ** 2 for p in pnls) / (len(pnls) - 1)
            std = math.sqrt(variance) if variance > 0 else 0
            sharpe = (mu / std * math.sqrt(252)) if std > 0 else 0
        self.assertEqual(sharpe, 0)

    def test_consecutive_wins_counter(self):
        """Consecutive win/loss counter logic works correctly."""
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
        """_round_price should floor price to the given tick size."""
        import main as bot
        # 0.12345 floored to 0.0001 tick → 0.1234
        result = bot._round_price(0.12345, 0.0001)
        self.assertAlmostEqual(result, 0.1234, places=4)
        # Result should not exceed the input
        self.assertLessEqual(result, 0.12345 + 1e-9)


if __name__ == "__main__":
    unittest.main(verbosity=2)
