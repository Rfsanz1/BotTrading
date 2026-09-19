"""
PHASE 2.1 — Canonical AI Decision & Response Models

This module defines the schemas for:
1. AIResponse — output from AI models with validation
2. CanonicalMarketSnapshot — standardized market data input to AI
3. AIAnalysisResult — result from one model with metadata
4. Request tracing for observability

Uses dataclasses (built-in) instead of Pydantic for broader compatibility.
"""

import uuid
import json
from dataclasses import dataclass, asdict, field, fields
from datetime import datetime, timezone
from typing import Any, Optional, Literal
from enum import Enum


class TradeAction(str, Enum):
    """Valid trade decision actions."""
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class AIResponseStatus(str, Enum):
    """Status of AI response processing."""
    SUCCESS = "SUCCESS"
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    INVALID_RESPONSE = "INVALID_RESPONSE"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass
class AIResponse:
    """Canonical AI response schema with strict validation.
    
    All AI models must produce responses that conform to this schema.
    Validation prevents invalid decisions from entering the pipeline.
    """
    
    # Core decision
    decision: str  # BUY, SELL, HOLD
    confidence: float  # 0-100
    probability: float = 0.5  # 0-1, win prob
    
    # Setup & regime
    setup: str = ""  # e.g., PULLBACK, BREAKOUT
    regime: str = ""  # e.g., TREND_UP, RANGE
    
    # Entry/SL/TP
    entry: float = 0.0
    stopLoss: float = 0.0
    takeProfit: float = 0.0
    
    # Risk classification
    riskLevel: str = "medium"  # low, medium, high
    
    # Reasoning & factors
    reasoning: str = ""
    keyFactors: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    invalidationConditions: list[str] = field(default_factory=list)
    
    # Metadata
    schemaVersion: str = "1.0"
    
    def __post_init__(self):
        """Validate all fields after initialization."""
        self._validate()
    
    def _validate(self):
        """Run all validations. Raises ValueError if invalid."""
        # Validate decision
        self.decision = str(self.decision).upper().strip()
        if self.decision not in ("BUY", "SELL", "HOLD"):
            raise ValueError(f"decision must be BUY/SELL/HOLD, got {self.decision}")
        
        # Validate confidence 0-100
        if not (0 <= self.confidence <= 100):
            raise ValueError(f"confidence must be 0-100, got {self.confidence}")
        
        # Validate probability 0-1
        if not (0 <= self.probability <= 1.0):
            raise ValueError(f"probability must be 0-1, got {self.probability}")
        
        # Validate prices are finite and > 0 (if set)
        for price_field in ("entry", "stopLoss", "takeProfit"):
            val = getattr(self, price_field)
            if val != 0:  # Allow 0 as "not set"
                try:
                    f = float(val)
                    if not (f > 0 and f != float('inf') and f != float('-inf')):
                        raise ValueError(f"{price_field} must be > 0 and finite, got {f}")
                except (ValueError, TypeError) as e:
                    raise ValueError(f"Invalid {price_field}: {e}")
        
        # Reasoning required for BUY/SELL
        if self.decision in ("BUY", "SELL") and (not self.reasoning or not self.reasoning.strip()):
            raise ValueError(f"reasoning required for {self.decision} decisions")
        
        # Validate R:R ratio
        if not self.validate_rr_ratio():
            raise ValueError(f"Invalid R:R ratio for {self.decision}")
        
        # Risk level valid
        if self.riskLevel not in ("low", "medium", "high"):
            raise ValueError(f"riskLevel must be low/medium/high, got {self.riskLevel}")
    
    def validate_rr_ratio(self) -> bool:
        """Validate risk-reward ratio constraints."""
        # If prices not set, skip R:R validation (might be added later)
        if self.entry == 0 or self.stopLoss == 0 or self.takeProfit == 0:
            return self.decision != "BUY" and self.decision != "SELL" or self.decision == "HOLD"
        
        if self.decision == "BUY":
            # BUY: SL < entry < TP
            return self.stopLoss < self.entry < self.takeProfit
        elif self.decision == "SELL":
            # SELL: TP < entry < SL
            return self.takeProfit < self.entry < self.stopLoss
        
        return True
    
    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict (JSON-safe)."""
        return asdict(self)




@dataclass
class CanonicalMarketSnapshot:
    """Standardized market data for independent AI analysis.
    
    All AI models receive the SAME snapshot data to ensure fair comparison.
    """
    
    symbol: str  # Trading pair
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    # OHLCV data (1m, 5m, 15m)
    ohlcv_1m: dict[str, Any] = field(default_factory=dict)
    ohlcv_5m: Optional[dict[str, Any]] = None
    ohlcv_15m: Optional[dict[str, Any]] = None
    
    # Futures data
    funding_rate: Optional[float] = None
    open_interest: Optional[float] = None
    oi_change_pct: Optional[float] = None
    
    # Market sentiment
    fear_greed_index: Optional[int] = None
    
    # Regime & confluence
    detected_regime: Optional[str] = None
    confluence_score: Optional[float] = None
    
    # News & sentiment
    news_items: list[dict[str, str]] = field(default_factory=list)
    news_sentiment_score: Optional[float] = None
    
    # Data quality
    data_quality_score: float = 1.0
    
    def is_data_critical(self) -> bool:
        """Check if data quality is critical (below usable threshold)."""
        return self.data_quality_score < 0.5


@dataclass
class AIAnalysisResult:
    """Result from a single AI model/provider."""
    
    provider: str
    model: str = "unknown"
    
    requestId: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Response data
    response: Optional[AIResponse] = None
    
    # Status & metadata
    status: AIResponseStatus = AIResponseStatus.SUCCESS
    error: Optional[str] = None
    latency_ms: float = 0.0
    rawOutput: Optional[str] = None
    
    def is_valid(self) -> bool:
        """Check if result contains valid decision."""
        return self.status == AIResponseStatus.SUCCESS and self.response is not None


@dataclass
class WeightedConsensusResult:
    """Result from weighted voting across multiple models."""
    
    decision: str  # BUY/SELL/HOLD
    confidence: float  # 0-100
    agreementScore: float  # 0-1
    disagreementScore: float  # 0-1
    providersVoted: int
    supportingModels: list[str] = field(default_factory=list)
    opposingModels: list[str] = field(default_factory=list)
    reliability: str = "medium"  # high/medium/low


@dataclass
class CalibrationResult:
    """Confidence calibration result."""
    
    rawConfidence: float  # 0-1
    calibratedProbability: float  # 0-1
    calibrationStatus: str  # CALIBRATED, ESTIMATED, INSUFFICIENT_DATA
    sampleSize: Optional[int] = None
    adjustmentFactors: dict[str, float] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Validation functions

def validate_ai_response_json(raw_json: str) -> tuple[bool, Optional[AIResponse], str]:
    """Parse and validate raw AI response JSON.
    
    Returns:
        (is_valid, response_obj, error_message)
    """
    try:
        data = json.loads(raw_json)
        
        # Extract required fields
        response = AIResponse(
            decision=data.get("decision", "HOLD"),
            confidence=float(data.get("confidence", 0)),
            probability=float(data.get("probability", 0.5)),
            setup=str(data.get("setup", "")),
            regime=str(data.get("regime", "")),
            entry=float(data.get("entry", 0.0)),
            stopLoss=float(data.get("stopLoss", 0.0)),
            takeProfit=float(data.get("takeProfit", 0.0)),
            riskLevel=str(data.get("riskLevel", "medium")),
            reasoning=str(data.get("reasoning", "")),
            keyFactors=data.get("keyFactors", []) if isinstance(data.get("keyFactors"), list) else [],
            risks=data.get("risks", []) if isinstance(data.get("risks"), list) else [],
            invalidationConditions=data.get("invalidationConditions", []) if isinstance(data.get("invalidationConditions"), list) else [],
        )
        
        return True, response, ""
    
    except json.JSONDecodeError as e:
        return False, None, f"Invalid JSON: {e}"
    except ValueError as e:
        return False, None, f"Validation error: {e}"
    except Exception as e:
        return False, None, f"Unexpected error: {e}"


def create_unavailable_response(provider: str, reason: str = "") -> AIAnalysisResult:
    """Create response indicating provider is unavailable."""
    return AIAnalysisResult(
        provider=provider,
        status=AIResponseStatus.UNAVAILABLE,
        error=reason or f"{provider} provider unavailable (no credentials)"
    )


if __name__ == "__main__":
    # Test schema validation
    import sys
    
    # Test 1: Valid BUY response
    valid_buy = AIResponse(
        decision="BUY",
        confidence=85,
        probability=0.72,
        setup="PULLBACK",
        regime="TREND_UP",
        entry=100.0,
        stopLoss=98.0,
        takeProfit=108.0,
        reasoning="SMA20 > SMA50, RSI pullback, MACD positive",
        keyFactors=["multi-TF confluence", "funding rate positive"],
        risks=["could retest lower", "low volume possible"]
    )
    print(f"✅ Valid BUY: {valid_buy.decision} @ {valid_buy.confidence}% conf")
    
    # Test 2: Invalid (entry >= TP for BUY)
    try:
        invalid_buy = AIResponse(
            decision="BUY",
            confidence=90,
            entry=100.0,
            stopLoss=99.0,
            takeProfit=95.0,  # BUY: TP must be > entry
            reasoning="test"
        )
        print(f"❌ Should have rejected invalid BUY")
        sys.exit(1)
    except ValueError as e:
        print(f"✅ R:R validation correctly rejected: {e}")
    
    # Test 3: HOLD requires no reasoning
    hold_resp = AIResponse(
        decision="HOLD",
        confidence=50,
        reasoning=""  # OK for HOLD
    )
    print(f"✅ HOLD without reasoning accepted")
    
    # Test 4: Missing reasoning for BUY should fail
    try:
        resp = AIResponse(
            decision="BUY",
            confidence=80,
            entry=100,
            stopLoss=98,
            takeProfit=108,
            reasoning=""  # Should fail
        )
        print(f"❌ Should have required reasoning for BUY")
        sys.exit(1)
    except ValueError:
        print(f"✅ Correctly required reasoning for BUY")
    
    # Test 5: JSON parsing
    valid_json = '{"decision": "SELL", "confidence": 75, "entry": 100, "stopLoss": 105, "takeProfit": 90, "reasoning": "trend reversal"}'
    is_valid, resp, err = validate_ai_response_json(valid_json)
    if is_valid:
        print(f"✅ JSON parsing: {resp.decision} valid")
    else:
        print(f"❌ JSON parsing failed: {err}")
        sys.exit(1)
    
    print("\n✅ All schema validation tests passed!")

