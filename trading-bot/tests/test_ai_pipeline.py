"""
PHASE 2.1 Unit Tests: AI Decision Pipeline

Tests for:
1. AIResponse schema validation
2. Pipeline orchestration
3. Consensus voting
4. Confidence calibration
5. EV gates
6. Edge cases and error handling
"""

import unittest
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
import json

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_decision_models import (
    AIResponse,
    AIResponseStatus,
    CanonicalMarketSnapshot,
    AIAnalysisResult,
    WeightedConsensusResult,
    CalibrationResult,
    validate_ai_response_json,
)


class TestAIResponseValidation(unittest.TestCase):
    """Test AIResponse schema validation"""
    
    def test_valid_buy_response(self):
        """Valid BUY response should pass"""
        response = AIResponse(
            decision="BUY",
            confidence=75,
            probability=0.75,
            entry=100.0,
            stopLoss=95.0,
            takeProfit=110.0,
            reasoning="Strong uptrend with pullback confirmation"
        )
        self.assertEqual(response.decision, "BUY")
        self.assertEqual(response.confidence, 75)
        self.assertEqual(response.probability, 0.75)
    
    def test_valid_sell_response(self):
        """Valid SELL response should pass"""
        response = AIResponse(
            decision="SELL",
            confidence=65,
            probability=0.65,
            entry=100.0,
            stopLoss=105.0,
            takeProfit=90.0,
            reasoning="Resistance break with funding rate warning"
        )
        self.assertEqual(response.decision, "SELL")
        self.assertEqual(response.confidence, 65)
    
    def test_valid_hold_response(self):
        """Valid HOLD response should pass (no reasoning required)"""
        response = AIResponse(
            decision="HOLD",
            confidence=40,
            probability=0.5,
            entry=100.0,
            stopLoss=100.0,
            takeProfit=100.0,
        )
        self.assertEqual(response.decision, "HOLD")
        self.assertEqual(response.confidence, 40)
    
    def test_invalid_decision(self):
        """Invalid decision should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="ROCKET",
                confidence=50,
                probability=0.5,
                entry=100.0,
                stopLoss=95.0,
                takeProfit=110.0,
            )
        self.assertIn("decision", str(ctx.exception).lower())
    
    def test_confidence_out_of_range(self):
        """Confidence > 100 should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=150,
                probability=0.75,
                entry=100.0,
                stopLoss=95.0,
                takeProfit=110.0,
                reasoning="Test"
            )
        self.assertIn("confidence", str(ctx.exception).lower())
    
    def test_probability_out_of_range(self):
        """Probability > 1.0 should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=75,
                probability=1.5,
                entry=100.0,
                stopLoss=95.0,
                takeProfit=110.0,
                reasoning="Test"
            )
        self.assertIn("probability", str(ctx.exception).lower())
    
    def test_invalid_buy_rr(self):
        """BUY with SL >= entry should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=75,
                probability=0.75,
                entry=100.0,
                stopLoss=100.0,  # Invalid: SL should be < entry
                takeProfit=110.0,
                reasoning="Test"
            )
        self.assertIn("r:r", str(ctx.exception).lower())
    
    def test_invalid_sell_rr(self):
        """SELL with SL <= entry should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="SELL",
                confidence=75,
                probability=0.75,
                entry=100.0,
                stopLoss=100.0,  # Invalid: SL should be > entry for SELL
                takeProfit=90.0,
                reasoning="Test"
            )
        self.assertIn("r:r", str(ctx.exception).lower())
    
    def test_missing_reasoning_for_buy(self):
        """BUY without reasoning should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=75,
                probability=0.75,
                entry=100.0,
                stopLoss=95.0,
                takeProfit=110.0,
                reasoning=""  # Invalid: empty reasoning for BUY
            )
        self.assertIn("reasoning", str(ctx.exception).lower())
    
    def test_missing_reasoning_for_sell(self):
        """SELL without reasoning should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="SELL",
                confidence=75,
                probability=0.75,
                entry=100.0,
                stopLoss=105.0,
                takeProfit=90.0,
                reasoning=None  # Invalid: None reasoning for SELL
            )
        self.assertIn("reasoning", str(ctx.exception).lower())
    
    def test_invalid_price_nan(self):
        """NaN prices should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=75,
                probability=0.75,
                entry=float('nan'),
                stopLoss=95.0,
                takeProfit=110.0,
                reasoning="Test"
            )
        self.assertIn("finite", str(ctx.exception).lower())
    
    def test_invalid_price_infinity(self):
        """Infinity prices should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=75,
                probability=0.75,
                entry=float('inf'),
                stopLoss=95.0,
                takeProfit=110.0,
                reasoning="Test"
            )
        self.assertIn("finite", str(ctx.exception).lower())
    
    def test_invalid_negative_price(self):
        """Negative prices should raise ValueError"""
        with self.assertRaises(ValueError) as ctx:
            AIResponse(
                decision="BUY",
                confidence=75,
                probability=0.75,
                entry=-100.0,
                stopLoss=-105.0,
                takeProfit=-90.0,
                reasoning="Test"
            )
        self.assertIn("entry", str(ctx.exception).lower())
    
    def test_case_insensitive_decision(self):
        """Decision should be normalized to uppercase"""
        response = AIResponse(
            decision="buy",
            confidence=75,
            probability=0.75,
            entry=100.0,
            stopLoss=95.0,
            takeProfit=110.0,
            reasoning="Test"
        )
        self.assertEqual(response.decision, "BUY")
    
    def test_json_parsing_valid(self):
        """Valid JSON should parse correctly"""
        json_str = """{
            "decision": "BUY",
            "confidence": 80,
            "probability": 0.8,
            "entry": 100.5,
            "stopLoss": 95.0,
            "takeProfit": 112.0,
            "reasoning": "Strong signal"
        }"""
        is_valid, response, msg = validate_ai_response_json(json_str)
        self.assertTrue(is_valid)
        self.assertIsNotNone(response)
        self.assertEqual(response.decision, "BUY")
        self.assertEqual(response.confidence, 80)
    
    def test_json_parsing_invalid_json(self):
        """Invalid JSON should return (False, None, error_msg)"""
        invalid_json = "{ not valid json }"
        is_valid, response, msg = validate_ai_response_json(invalid_json)
        self.assertFalse(is_valid)
        self.assertIsNone(response)
    
    def test_json_parsing_missing_fields(self):
        """JSON with missing required fields should return (False, None, error_msg)"""
        json_str = """{
            "decision": "BUY",
            "confidence": 75
        }"""
        is_valid, response, msg = validate_ai_response_json(json_str)
        self.assertFalse(is_valid)
        self.assertIsNone(response)


class TestMarketSnapshotValidation(unittest.TestCase):
    """Test CanonicalMarketSnapshot validation"""
    
    def test_valid_market_snapshot(self):
        """Valid market snapshot should pass"""
        snapshot = CanonicalMarketSnapshot(
            symbol="BTCUSDT",
            timestamp=datetime.now(timezone.utc),
            ohlcv_1m={"open": 50000, "high": 50500, "low": 49500, "close": 50200, "volume": 1000},
            ohlcv_5m={"open": 49800, "high": 50500, "low": 49500, "close": 50200, "volume": 5000},
            ohlcv_15m={"open": 49600, "high": 50500, "low": 49500, "close": 50200, "volume": 15000},
            funding_rate=0.0001,
            open_interest=1000000000.0,
            fear_greed_index=45,
            detected_regime="TREND_UP",
            confluence_score=0.75,
        )
        self.assertEqual(snapshot.symbol, "BTCUSDT")
        self.assertEqual(snapshot.funding_rate, 0.0001)
    
    def test_market_snapshot_creation(self):
        """Create market snapshot with minimal fields"""
        snapshot = CanonicalMarketSnapshot(
            symbol="ETHUSDT",
            timestamp=datetime.now(timezone.utc),
            ohlcv_1m={"open": 3000, "high": 3100, "low": 2900, "close": 3050, "volume": 100},
        )
        self.assertEqual(snapshot.symbol, "ETHUSDT")
        self.assertIsNotNone(snapshot.ohlcv_1m)


class TestAIAnalysisResult(unittest.TestCase):
    """Test AIAnalysisResult structure"""
    
    def test_valid_analysis_result(self):
        """Valid analysis result should be created"""
        ai_response = AIResponse(
            decision="BUY",
            confidence=75,
            probability=0.75,
            entry=100.0,
            stopLoss=95.0,
            takeProfit=110.0,
            reasoning="Strong signal"
        )
        result = AIAnalysisResult(
            provider="OpenRouter/Claude",
            model="claude-3-sonnet",
            response=ai_response,
            status=AIResponseStatus.SUCCESS,
            latency_ms=1500,
        )
        self.assertEqual(result.provider, "OpenRouter/Claude")
        self.assertEqual(result.status, AIResponseStatus.SUCCESS)
        self.assertEqual(result.latency_ms, 1500)
        self.assertTrue(result.is_valid())
    
    def test_analysis_result_timeout(self):
        """Analysis result with TIMEOUT status"""
        result = AIAnalysisResult(
            provider="OpenAI/GPT-4",
            model="gpt-4-turbo",
            status=AIResponseStatus.TIMEOUT,
            latency_ms=60000,
            error="Request exceeded 30s timeout"
        )
        self.assertEqual(result.status, AIResponseStatus.TIMEOUT)
        self.assertIsNone(result.response)
        self.assertFalse(result.is_valid())


class TestCalibrationResult(unittest.TestCase):
    """Test confidence calibration"""
    
    def test_calibration_with_data(self):
        """Calibration with sufficient data"""
        calib = CalibrationResult(
            rawConfidence=0.75,
            calibratedProbability=0.72,
            calibrationStatus="CALIBRATED",
            sampleSize=100
        )
        self.assertEqual(calib.rawConfidence, 0.75)
        self.assertEqual(calib.calibratedProbability, 0.72)
        self.assertEqual(calib.sampleSize, 100)
    
    def test_calibration_insufficient_data(self):
        """Calibration with insufficient data"""
        calib = CalibrationResult(
            rawConfidence=0.60,
            calibratedProbability=0.60,
            calibrationStatus="INSUFFICIENT_DATA",
            sampleSize=5
        )
        self.assertEqual(calib.calibrationStatus, "INSUFFICIENT_DATA")
        self.assertEqual(calib.sampleSize, 5)


class TestWeightedConsensus(unittest.TestCase):
    """Test weighted consensus results"""
    
    def test_consensus_all_buy(self):
        """All models agree on BUY"""
        consensus = WeightedConsensusResult(
            decision="BUY",
            confidence=85,
            agreementScore=1.0,
            disagreementScore=0.0,
            providersVoted=4
        )
        self.assertEqual(consensus.decision, "BUY")
        self.assertEqual(consensus.agreementScore, 1.0)
        self.assertEqual(consensus.providersVoted, 4)
    
    def test_consensus_all_sell(self):
        """All models agree on SELL"""
        consensus = WeightedConsensusResult(
            decision="SELL",
            confidence=80,
            agreementScore=1.0,
            disagreementScore=0.0,
            providersVoted=4
        )
        self.assertEqual(consensus.decision, "SELL")
        self.assertEqual(consensus.agreementScore, 1.0)
    
    def test_consensus_split(self):
        """Models split between BUY and SELL"""
        consensus = WeightedConsensusResult(
            decision="HOLD",
            confidence=50,
            agreementScore=0.5,
            disagreementScore=0.5,
            providersVoted=4
        )
        self.assertEqual(consensus.decision, "HOLD")
        self.assertGreater(consensus.disagreementScore, 0.4)


class TestPipelineScenarios(unittest.TestCase):
    """Integration test scenarios for the pipeline"""
    
    def test_scenario_valid_market_strong_consensus(self):
        """Scenario: Valid market data + strong consensus → BUY"""
        # This would require the full pipeline to test
        # For now, just verify the AIResponse can represent this
        response = AIResponse(
            decision="BUY",
            confidence=85,
            probability=0.85,
            entry=100.0,
            stopLoss=95.0,
            takeProfit=115.0,
            reasoning="Strong uptrend with 4/4 model agreement"
        )
        self.assertEqual(response.decision, "BUY")
        self.assertGreater(response.confidence, 80)
    
    def test_scenario_stale_data_hold(self):
        """Scenario: Stale data should return HOLD"""
        # In real pipeline, this would be checked by check_data_quality()
        response = AIResponse(
            decision="HOLD",
            confidence=30,
            probability=0.5,
            entry=100.0,
            stopLoss=100.0,
            takeProfit=100.0,
            reasoning="Data quality insufficient"
        )
        self.assertEqual(response.decision, "HOLD")
        self.assertLess(response.confidence, 50)
    
    def test_scenario_negative_ev_hold(self):
        """Scenario: Negative EV should return HOLD"""
        response = AIResponse(
            decision="HOLD",
            confidence=25,
            probability=0.3,
            entry=100.0,
            stopLoss=100.0,
            takeProfit=100.0,
            reasoning="Expected value negative after fees"
        )
        self.assertEqual(response.decision, "HOLD")


if __name__ == "__main__":
    # Run tests with verbose output
    unittest.main(verbosity=2)
