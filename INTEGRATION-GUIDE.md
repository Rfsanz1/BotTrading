# PHASE 2 INTEGRATION GUIDE

**Practical step-by-step instructions to wire new components into production flow**

---

## 1. STRUCTURED AI OUTPUT VALIDATION

### Current Issue
```python
# Current ask_ai() call returns string, parsed via regex
response = await ask_ai("...", confidence_threshold=60)
# response = "BUY Entry: 45000 SL: 44500 TP: 46000"  ← fragile!
```

### Solution: Add JSON Schema Validation

**File**: `/root/BotTrading/trading-bot/main.py`  
**Insert at**: Line ~34 (after imports)

```python
from dataclasses import dataclass, field
from typing import Any, Optional, Dict
import json

@dataclass
class AIResponse:
    """Validated AI response structure"""
    decision: str  # BUY, SELL, HOLD
    confidence: float  # 0-100 (will be converted to 0-1)
    probability: float  # 0-100 after calibration
    setup: str  # TREND_CONTINUATION, PULLBACK, etc
    regime: str  # TREND_UP, RANGE, BREAKOUT_UP, etc
    entry: float
    stop_loss: float
    take_profit: float
    risk_level: str  # CRITICAL, HIGH, MEDIUM, LOW
    reasoning: str
    key_factors: list = field(default_factory=list)
    risks: list = field(default_factory=list)
    invalidation_conditions: list = field(default_factory=list)
    
    @staticmethod
    def from_json_string(json_str: str) -> Optional['AIResponse']:
        """Parse and validate AI JSON response"""
        try:
            data = json.loads(json_str)
            
            # Validate required fields exist
            required = ['decision', 'confidence', 'entry', 'stop_loss', 'take_profit']
            for field in required:
                if field not in data:
                    return None
            
            # Validate bounds
            if not (0 <= data['confidence'] <= 100):
                return None
            if not (0 < data['entry']):
                return None
            if not (0 < data['stop_loss']):
                return None
            if not (0 < data['take_profit']):
                return None
            
            # Validate direction (SL < Entry < TP for BUY, opposite for SELL)
            decision = data.get('decision', '').upper()
            if decision == 'BUY':
                if not (data['stop_loss'] < data['entry'] < data['take_profit']):
                    return None  # Invalid SL/TP positioning
            elif decision == 'SELL':
                if not (data['take_profit'] < data['entry'] < data['stop_loss']):
                    return None  # Invalid SL/TP positioning
            
            # Validate no NaN/infinity
            for val in [data['confidence'], data['entry'], data['stop_loss'], data['take_profit']]:
                if val is None or (isinstance(val, float) and (val != val or val == float('inf') or val == float('-inf'))):
                    return None
            
            return AIResponse(
                decision=data.get('decision', 'HOLD').upper(),
                confidence=float(data.get('confidence', 50)),
                probability=float(data.get('probability', 0.5)),
                setup=data.get('setup', 'NO_VALID_SETUP'),
                regime=data.get('regime', 'UNKNOWN'),
                entry=float(data.get('entry', 0)),
                stop_loss=float(data.get('stop_loss', 0)),
                take_profit=float(data.get('take_profit', 0)),
                risk_level=data.get('risk_level', 'MEDIUM'),
                reasoning=data.get('reasoning', ''),
                key_factors=data.get('key_factors', []),
                risks=data.get('risks', []),
                invalidation_conditions=data.get('invalidation_conditions', [])
            )
        except (json.JSONDecodeError, ValueError, TypeError, KeyError):
            return None
```

**Usage in ask_ai()**:
```python
# OLD (line ~4100):
response_text = await _call_9router(prompt, model, temperature)
# Parse via regex...
confidence = extract_confidence(response_text)

# NEW:
response_text = await _call_9router(prompt, model, temperature)
ai_response = AIResponse.from_json_string(response_text)
if ai_response is None:
    # Malformed response - force HOLD
    return TradeDecision(
        action='HOLD',
        reasoning='AI response validation failed',
        raw_confidence=0,
        ...
    )
# Use ai_response.decision, ai_response.confidence, etc
```

---

## 2. INTEGRATE DECISION PIPELINE

### Current Issue
```python
# Functions exist but aren't called in sequence
response = await ask_ai(prompt, ...)
# Quality checks never happen
# EV never calculated
# Setup never validated
```

### Solution: Wire Components in main.py ask_ai()

**Location**: `/root/BotTrading/trading-bot/main.py` - `ask_ai()` function (around line 4090+)

**Current signature**:
```python
async def ask_ai(
    symbol: str,
    market_data: dict,
    timeframe: str = "5m",
    confidence_threshold: int = 60,
    feedback: Optional[dict] = None,
) -> TradeDecision:
```

**New implementation** (replace entire function):

```python
async def ask_ai(
    symbol: str,
    market_data: dict,
    timeframe: str = "5m",
    confidence_threshold: int = 60,
    feedback: Optional[dict] = None,
) -> TradeDecision:
    """
    Complete AI decision pipeline with all gates:
    1. Data quality check → HOLD if CRITICAL
    2. Regime detection → pass to AI
    3. Setup detection → pass to AI
    4. Multi-AI analysis (independent)
    5. Weighted consensus
    6. Expected value gate
    7. Confidence calibration
    """
    
    decision_id = f"d-{symbol}-{int(time.time()*1000)}"
    timestamp = int(time.time() * 1000)
    exchange = os.environ.get("EXCHANGE", "BYBIT")
    market = os.environ.get("MARKET", "USDT")
    
    try:
        # ─── STEP 1: DATA QUALITY CHECK ───────────────────────────────────
        df_1m = market_data.get("df_1m", pd.DataFrame())
        df_5m = market_data.get("df_5m", pd.DataFrame())
        df_15m = market_data.get("df_15m", pd.DataFrame())
        
        funding = market_data.get("funding_rate", None)
        oi_change = market_data.get("oi_change", 0)
        
        quality_score, quality_status = check_data_quality(
            symbol, df_5m, funding, oi_change
        )
        
        if quality_status == "CRITICAL":
            # Data is stale/invalid → HOLD no matter what
            return TradeDecision(
                decision_id=decision_id,
                timestamp=timestamp,
                symbol=symbol,
                exchange=exchange,
                market=market,
                timeframe=timeframe,
                action="HOLD",
                regime="UNKNOWN",
                setup="NO_VALID_SETUP",
                entry=0,
                stop_loss=0,
                take_profit=0,
                raw_confidence=0,
                calibrated_confidence=0,
                probability=0,
                expected_value=0,
                data_quality=quality_score,
                key_factors=["Data quality CRITICAL - stale/invalid"],
                reasoning="HOLD: Market data quality below threshold"
            )
        
        # ─── STEP 2: REGIME DETECTION ────────────────────────────────────
        regime, regime_score = detect_market_regime(df_1m, df_5m, df_15m)
        canonical_regime = _canonical_regime_name(regime)
        regime_confidence = min(1.0, regime_score / 100.0)
        
        # ─── STEP 3: SETUP DETECTION ────────────────────────────────────
        setup_score, setup_conf, setup_req, setup_inv = detect_setup(
            df_1m, df_5m, canonical_regime
        )
        setup_type = "TREND_CONTINUATION" if setup_score > 0.65 else "NO_VALID_SETUP"
        
        # ─── STEP 4: CONFLUENCE SCORING ──────────────────────────────────
        confluence_score = calc_confluence_score(df_1m, df_5m, df_15m, regime)
        
        # ─── STEP 5: BUILD CONTEXT FOR AI ────────────────────────────────
        market_context = {
            "regime": canonical_regime,
            "regime_confidence": regime_confidence,
            "regime_score": regime_score,
            "setup": setup_type,
            "setup_score": setup_score,
            "setup_required": setup_req,
            "confluence_score": confluence_score,
            "data_quality": quality_status,
            "quality_score": quality_score,
        }
        
        # ─── STEP 6: PROMPT CONSTRUCTION ────────────────────────────────
        prompt = f"""
        Market Analysis for {symbol}
        Regime: {canonical_regime} (confidence: {regime_confidence:.2f})
        Setup: {setup_type} (score: {setup_score:.2f})
        Confluence: {confluence_score}/100
        Data Quality: {quality_status}
        
        [Market data included...]
        
        RESPOND ONLY with valid JSON:
        {{
            "decision": "BUY|SELL|HOLD",
            "confidence": <0-100>,
            "probability": <0-100>,
            "setup": "{setup_type}",
            "regime": "{canonical_regime}",
            "entry": <price>,
            "stop_loss": <price>,
            "take_profit": <price>,
            "risk_level": "CRITICAL|HIGH|MEDIUM|LOW",
            "reasoning": "<brief explanation>",
            "key_factors": [<list>],
            "risks": [<list>],
            "invalidation_conditions": [<list>]
        }}
        """
        
        # ─── STEP 7: CALL PRIMARY AI ────────────────────────────────────
        model = os.environ.get("AI_MODEL", "google/gemini-2.5-pro")
        response_text = await _call_9router(prompt, model, temperature=0.1)
        
        # ─── STEP 8: VALIDATE AI RESPONSE ────────────────────────────────
        ai_response = AIResponse.from_json_string(response_text)
        if ai_response is None:
            return TradeDecision(
                decision_id=decision_id,
                timestamp=timestamp,
                symbol=symbol,
                exchange=exchange,
                market=market,
                timeframe=timeframe,
                action="HOLD",
                regime=canonical_regime,
                setup=setup_type,
                raw_confidence=0,
                calibrated_confidence=0,
                reasoning="AI response validation failed (malformed JSON)",
                key_factors=["Invalid AI response format"],
                data_quality=quality_score
            )
        
        # ─── STEP 9: GET VALIDATOR RESPONSES ────────────────────────────
        # All validators receive SAME market snapshot (independence requirement)
        validators = []
        for model_key in ["AI_VALIDATOR_MODEL", "AI_VALIDATOR_MODEL2", "AI_VALIDATOR_MODEL3"]:
            validator_model = os.environ.get(model_key, "")
            if validator_model:
                try:
                    validator_response = await _call_9router(prompt, validator_model, temperature=0.1)
                    val_response = AIResponse.from_json_string(validator_response)
                    if val_response:
                        validators.append(val_response)
                except Exception as e:
                    pass  # Validator timeout - skip
        
        # ─── STEP 10: WEIGHTED CONSENSUS ────────────────────────────────
        all_responses = [ai_response] + validators
        consensus_decision, agreement_score, disagreement_score, reliability = \
            build_weighted_consensus(ai_response, validators, symbol)
        
        # Use consensus decision if sufficient agreement
        final_decision = consensus_decision if agreement_score > 0.6 else ai_response.decision
        final_confidence = ai_response.confidence * (0.5 + 0.5 * agreement_score)
        
        # ─── STEP 11: EXPECTED VALUE GATE ───────────────────────────────
        win_probability = final_confidence / 100.0
        avg_win_r = 2.0  # Historical average R:R
        avg_loss_r = 1.0
        
        ev, ev_after_cost, rr_ratio = calculate_expected_value(
            entry=ai_response.entry,
            stop_loss=ai_response.stop_loss,
            take_profit=ai_response.take_profit,
            win_probability=win_probability,
            avg_win_r=avg_win_r,
            avg_loss_r=avg_loss_r,
            fee_pct=0.001,
            slippage=0.002
        )
        
        min_ev_pct = float(os.environ.get("MIN_EV_PCT", "0.003"))
        if ev_after_cost < min_ev_pct:
            # EV negative → HOLD
            final_decision = "HOLD"
        
        # ─── STEP 12: CALIBRATE CONFIDENCE ──────────────────────────────
        calibrated_prob, calibration_status = calibrate_confidence(
            raw_confidence=final_confidence / 100.0,
            setup_score=setup_score,
            regime_confidence=regime_confidence,
            data_quality=quality_score,
            agreement_score=agreement_score
        )
        
        # ─── STEP 13: BUILD TRADE DECISION ──────────────────────────────
        decision = TradeDecision(
            decision_id=decision_id,
            timestamp=timestamp,
            symbol=symbol,
            exchange=exchange,
            market=market,
            timeframe=timeframe,
            action=final_decision,
            regime=canonical_regime,
            regime_confidence=regime_confidence,
            setup=setup_type,
            setup_confidence=setup_score,
            entry=ai_response.entry,
            stop_loss=ai_response.stop_loss,
            take_profit=ai_response.take_profit,
            risk_reward=rr_ratio,
            raw_confidence=final_confidence / 100.0,
            calibrated_confidence=calibrated_prob,
            probability=calibrated_prob,
            calibrated_probability=calibrated_prob,
            expected_value=ev_after_cost,
            expected_value_after_cost=ev_after_cost,
            data_quality=quality_score,
            ai_consensus=final_decision,
            ai_agreement=agreement_score,
            ai_disagreement=disagreement_score,
            supporting_models=[],
            opposing_models=[],
            reasoning=ai_response.reasoning,
            key_factors=ai_response.key_factors,
            risk_factors=ai_response.risks,
            invalidation_conditions=ai_response.invalidation_conditions,
            strategy_version="1.0",
            feature_version="phase2-integrated",
            decision_version="v1.0"
        )
        
        # ─── STEP 14: LOG DECISION ──────────────────────────────────────
        # Store in ai_decisions table for weighted consensus learning
        # (if DB available)
        
        return decision
        
    except Exception as e:
        # Any error → HOLD with error details
        return TradeDecision(
            decision_id=decision_id,
            timestamp=timestamp,
            symbol=symbol,
            exchange=exchange,
            market=market,
            timeframe=timeframe,
            action="HOLD",
            regime="UNKNOWN",
            raw_confidence=0,
            reasoning=f"Error in AI pipeline: {str(e)}",
            key_factors=[f"Exception: {str(e)}"]
        )
```

---

## 3. CREATE DATABASE SCHEMA

**File**: Create new file or add to existing init script  
**File**: `/root/BotTrading/trading-bot/db_schema.sql`

```sql
-- AI Decision Tracking for Weighted Consensus
CREATE TABLE IF NOT EXISTS ai_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id TEXT UNIQUE NOT NULL,
    timestamp INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    provider TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('BUY', 'SELL', 'HOLD')),
    confidence FLOAT NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    setup TEXT,
    regime TEXT,
    entry REAL NOT NULL,
    stop_loss REAL NOT NULL,
    take_profit REAL NOT NULL,
    risk_reward REAL,
    expected_value REAL,
    
    -- Closed trade results
    exit_price REAL,
    closed_at INTEGER,
    result TEXT CHECK(result IN ('CLOSED_TP', 'CLOSED_SL', 'EARLY_EXIT', 'NULL')),
    pnl REAL,  -- NULL until closed
    
    -- Metadata
    reasoning TEXT,
    data_quality REAL CHECK(data_quality >= 0 AND data_quality <= 1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_symbol ON ai_decisions(symbol);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_provider ON ai_decisions(provider);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_timestamp ON ai_decisions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_symbol_provider ON ai_decisions(symbol, provider);

-- Model accuracy statistics
CREATE VIEW IF NOT EXISTS model_accuracy_stats AS
SELECT 
    symbol,
    provider,
    COUNT(*) as total_decisions,
    SUM(CASE WHEN result IN ('CLOSED_TP') THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN result IN ('CLOSED_SL') THEN 1 ELSE 0 END) as losses,
    ROUND(100.0 * SUM(CASE WHEN result IN ('CLOSED_TP') THEN 1 ELSE 0 END) / 
          COUNT(*), 2) as win_rate_pct,
    ROUND(AVG(CASE WHEN result IS NOT NULL THEN pnl ELSE NULL END), 2) as avg_pnl,
    ROUND(AVG(confidence), 3) as avg_confidence
FROM ai_decisions
WHERE result IS NOT NULL AND closed_at IS NOT NULL
GROUP BY symbol, provider
HAVING COUNT(*) >= 3;
```

**Initialize schema** in bot startup:
```python
def init_ai_decisions_schema():
    try:
        with sqlite3.connect(DB_PATH) as conn:
            with open("/root/BotTrading/trading-bot/db_schema.sql") as f:
                conn.executescript(f.read())
            conn.commit()
    except Exception as e:
        print(f"DB schema init error: {e}")
```

---

## 4. COMPLETE db_get_symbol_model_weights()

**File**: `/root/BotTrading/trading-bot/main.py`  
**Location**: Replace current stub (around line 4040-4050)

```python
def db_get_symbol_model_weights(symbol: str) -> Dict[str, float]:
    """
    Query historical accuracy for each AI provider on this symbol.
    Returns normalized weights (sum = 1.0).
    Fallback to equal weights if insufficient sample.
    """
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            
            # Get win rates per provider (minimum 3 trades for credibility)
            cursor.execute("""
                SELECT 
                    provider,
                    COUNT(*) as trades,
                    SUM(CASE WHEN result = 'CLOSED_TP' THEN 1 ELSE 0 END) as wins,
                    ROUND(100.0 * SUM(CASE WHEN result = 'CLOSED_TP' THEN 1 ELSE 0 END) / 
                          COUNT(*), 2) as win_rate
                FROM ai_decisions
                WHERE symbol = ? AND result IS NOT NULL AND closed_at IS NOT NULL
                GROUP BY provider
                HAVING COUNT(*) >= 3
                ORDER BY win_rate DESC
            """, (symbol,))
            
            results = cursor.fetchall()
            
            if not results:
                # Insufficient data - equal weights for all models
                return {
                    "primary": 0.4,
                    "validator1": 0.2,
                    "validator2": 0.2,
                    "validator3": 0.2,
                }
            
            # Weighted by win rate (prevent single model dominating)
            total_win_rate = sum(row[3] for row in results)  # win_rate column
            weights = {}
            
            for provider, trades, wins, win_rate in results:
                # Normalize: higher win rate = higher weight
                # But bounded: max 50%, min 5% per model
                raw_weight = win_rate / total_win_rate if total_win_rate > 0 else 1.0 / len(results)
                bounded = max(0.05, min(0.5, raw_weight))
                weights[provider] = bounded
            
            # Re-normalize to sum to 1.0
            total = sum(weights.values())
            return {k: v / total for k, v in weights.items()}
            
    except Exception as e:
        print(f"Error getting model weights: {e}")
        # Fallback to equal weights
        return {
            "primary": 0.4,
            "validator1": 0.2,
            "validator2": 0.2,
            "validator3": 0.2,
        }
```

---

## 5. ADD AI RESPONSE LOGGING

**In ask_ai()**, after step 14:

```python
# Log decision to database for future weighting
if DB_PATH and os.path.exists(DB_PATH):
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO ai_decisions (
                    decision_id, timestamp, symbol, provider, decision, confidence,
                    setup, regime, entry, stop_loss, take_profit, expected_value,
                    reasoning, data_quality
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                decision_id,
                timestamp,
                symbol,
                "consensus",
                decision.action,
                decision.calibrated_confidence,
                setup_type,
                canonical_regime,
                ai_response.entry,
                ai_response.stop_loss,
                ai_response.take_profit,
                ev_after_cost,
                decision.reasoning,
                quality_score
            ))
            conn.commit()
    except Exception as e:
        pass  # Non-blocking - logging failure doesn't stop trading
```

---

## 6. VALIDATION CHECKLIST

After implementing above changes:

```bash
# 1. Syntax validation
python3 -m py_compile /root/BotTrading/trading-bot/main.py
# Expected: No errors

# 2. Check imports
python3 -c "from dataclasses import dataclass; from main import TradeDecision, AIResponse"
# Expected: No errors

# 3. Verify functions exist
grep -n "def ask_ai\|def AIResponse\|def check_data_quality\|def detect_setup" main.py
# Expected: All found

# 4. Check TradeDecision dataclass
grep -n "@dataclass" main.py
# Expected: Found (line ~34, ~45)
```

---

## SUMMARY

After implementing sections 1-5:

✅ **Structured AI output validation** - Rejects malformed/invalid responses  
✅ **Complete decision pipeline** - All components wired in sequence  
✅ **Database schema** - Tracks decisions for model weighting  
✅ **Historical weighting** - Models weighted by symbol-specific accuracy  
✅ **Error handling** - Any component failure → HOLD  

**Next**: Implement real AI providers (replace echo stubs in TypeScript)
