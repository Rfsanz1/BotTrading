# PHASE 2.1 Implementation Status & Action Plan

## ✅ COMPLETED (2/14)

### 1. AIResponse Schema with Validation ✅
- **File:** `trading-bot/ai_decision_models.py`
- **Status:** COMPLETE & TESTED
- **What:** Canonical AIResponse dataclass with strict validation
  - BUY/SELL/HOLD enforcement
  - Confidence 0-100, probability 0-1
  - R:R ratio validation (SL < entry < TP for BUY, TP < entry < SL for SELL)
  - Reasoning required for BUY/SELL
  - Price validation (finite, positive)
- **Tests:** 5/5 passing
  - Valid BUY response ✅
  - Invalid R:R rejection ✅
  - HOLD without reasoning ✅
  - Missing reasoning for BUY rejection ✅
  - JSON parsing ✅

### 2. Echo Providers Removed ✅
- **Files:** 
  - `packages/ai/src/providers/adapters/openai.provider.ts`
  - `packages/ai/src/providers/adapters/future.provider.ts`
- **Status:** COMPLETE
- **What:**
  - ❌ Removed `[OpenAI echo]` response
  - ❌ Removed `[Future stub]` response  
  - ✅ Now return UNAVAILABLE status if no credentials
  - ✅ Document real implementation requirements (TODO comments added)

## ⏳ IN PROGRESS (0/14)

## 📋 PENDING (12/14)

### Critical Path (Must complete for production readiness):

#### 3. Independent AI Analysis Flow
- **Required for:** Multi-model voting to work correctly
- **Action:** Each AI model must receive CanonicalMarketSnapshot independently
- **Pattern:** No model knows previous model's decision before rendering
- **Implementation:** Refactor validators in main.py to use same snapshot

#### 4. Data Quality Gate (BEFORE AI)
- **Required for:** Prevent wasting AI tokens on stale/invalid data
- **Action:** In ask_ai(), check_data_quality() before calling any AI model
- **Logic:**
  ```python
  quality = check_data_quality(symbol, df_1m)
  if quality["gates_passed"] == False or quality["score"] < 0.5:
      return TradeDecision(action="HOLD", reason="DATA_QUALITY_FAILURE", ...)
  # Only call AI if data passes quality gate
  ```

#### 5. Setup + Regime Validation (BEFORE AI)
- **Required for:** Setup must match detected regime
- **Action:** Validate no contradictory setups before asking AI
- **Logic:**
  ```python
  regime = detect_market_regime(...)
  if regime["canonical_regime"] == "UNKNOWN":
      return TradeDecision(action="HOLD", reason="UNKNOWN_REGIME", ...)
  # For each setup, verify it's valid for this regime
  ```

#### 6. Weighted Consensus Wiring
- **Required for:** Multi-model voting works
- **Blockers:** 
  - Independent AI responses needed first
  - Historical model weights (from DB or defaults)
- **Implementation:**
  ```python
  # After all validators return:
  consensus = build_weighted_consensus(
      primary=ask_ai(...),
      validator1=ask_ai_openrouter(...),
      validator2=ask_ai_openai_validator(...),
      validator3=ask_ai_claude_direct_validator(...),
      symbol=symbol
  )
  ```

#### 7. Confidence Calibration Wiring
- **Required for:** Raw confidence → calibrated probability
- **Status:** Function exists (`calibrate_confidence()`) but unused
- **Implementation:**
  ```python
  calibrated = calibrate_confidence(
      raw_confidence=consensus["confidence"],
      setup_score=setup_score,
      regime_confidence=regime["conf_adjust"],
      data_quality=quality["score"],
      agreement_score=consensus["agreement_score"]
  )
  ```

#### 8. Expected Value Gate Wiring
- **Required for:** Reject negative EV trades
- **Status:** Function exists (`calculate_expected_value()`) but unused
- **Logic:**
  ```python
  ev = calculate_expected_value(...)
  if ev["ev_after_cost"] < MIN_EV_PCT:
      return TradeDecision(action="HOLD", reason="NEGATIVE_EV", ...)
  ```

#### 9. TradeDecision Output (NOT Dict)
- **Required for:** Canonical contract for execution
- **Current:** ask_ai() returns dict
- **Target:** ask_ai() returns TradeDecision object (already defined in main.py lines 34-107)
- **Implementation:**
  ```python
  return TradeDecision(
      id=decision_id,
      timestamp=now(),
      symbol=symbol,
      action=consensus["decision"],  # BUY/SELL/HOLD
      setup=detected_setup,
      regime=regime["canonical_regime"],
      entry=entry_price,
      stopLoss=sl,
      takeProfit=tp,
      confidence=calibrated["calibrated_probability"] * 100,
      expectedValue=ev["ev_after_cost"],
      reasoning=consensus_reason,
      ...
  )
  ```

#### 10. Live Trading Integration Check
- **Required for:** Verify bot actually uses new pipeline
- **Action:** Find entry point for live trading signal generation
- **Search:** Look for:
  - Main loop or scheduler
  - Signal generation function calls ask_ai()
  - Execution gate checks TradeDecision.action
- **File:** `trading-bot/main.py` - search for signal processing loop

#### 11. Remove Old Decision Paths
- **Required for:** Single canonical path (no confusion)
- **Action:** 
  - Find all places that make BUY/SELL decisions
  - Verify they all go through canonical ask_ai() → TradeDecision → execution
  - Deprecate/remove any old paths
- **Search pattern:** `return.*BUY|return.*SELL|decision.*=.*BUY`

#### 12. Request Tracing / Decision ID
- **Required for:** Full observability
- **Action:** Add correlation/request ID logging
- **Pattern:**
  ```python
  decision_id = str(uuid.uuid4())
  logger.info(f"[{decision_id}] market_snapshot → regime={regime} setup={setup}")
  logger.info(f"[{decision_id}] ai_response → {response}")
  logger.info(f"[{decision_id}] consensus → {consensus}")
  logger.info(f"[{decision_id}] final_decision → {trade_decision}")
  ```

#### 13. Comprehensive Unit Tests
- **Required for:** Regression prevention
- **Scope:**
  - AIResponse validation (5 tests done ✅)
  - Pipeline edge cases (12 tests needed)
    - Valid market → produces decision
    - Stale data → HOLD
    - Invalid data → HOLD
    - Unknown regime → HOLD
    - Invalid setup → HOLD
    - No AI available → HOLD
    - One provider failure → remaining models continue
    - All providers unavailable → HOLD
    - Strong disagreement → HOLD
    - Negative EV → HOLD
    - Calibration with enough history
    - Calibration with insufficient data
- **File:** `trading-bot/tests/test_bot.py`

#### 14. Execute & Verify Tests
- **Command:** `cd trading-bot && python3 -m pytest tests/ -v`
- **Must pass:** 100%
- **Also run:** `python3 -m py_compile main.py` (syntax check)

## Summary Table

| # | Task | Status | Dependencies | Est. Time |
|----|------|--------|--------------|-----------|
| 1 | AIResponse schema | ✅ DONE | - | 0m (done) |
| 2 | Remove echo providers | ✅ DONE | - | 0m (done) |
| 3 | Independent AI analysis | 📋 PENDING | #12 (tests) | 45m |
| 4 | Data quality gate | 📋 PENDING | #3 | 30m |
| 5 | Setup validation | 📋 PENDING | #3 | 30m |
| 6 | Weighted consensus | 📋 PENDING | #3 | 45m |
| 7 | Calibration wiring | 📋 PENDING | #6 | 30m |
| 8 | EV gate wiring | 📋 PENDING | #7 | 30m |
| 9 | TradeDecision output | 📋 PENDING | #8 | 45m |
| 10 | Live trading check | 📋 PENDING | #9 | 60m |
| 11 | Remove old paths | 📋 PENDING | #10 | 60m |
| 12 | Request tracing | 📋 PENDING | #9 | 30m |
| 13 | Unit tests | 📋 PENDING | #9 | 90m |
| 14 | Execute tests | 📋 PENDING | #13 | 10m |

**Total Est. Time for All Remaining Tasks:** ~465 minutes (~7.75 hours)

## CRITICAL BLOCKERS

**NONE** — All dependencies are internal to this phase. Can proceed sequentially.

## Production Readiness Criteria (for PHASE 2.1 Done)

- [ ] AIResponse schema implemented + validated ✅
- [ ] Production echo providers removed ✅
- [ ] ask_ai() wired with all 7 components
- [ ] Canonical market snapshot used
- [ ] Data quality gates BEFORE AI
- [ ] Setup validation BEFORE AI
- [ ] Weighted consensus WORKING
- [ ] Calibration APPLIED
- [ ] EV gate ACTIVE
- [ ] TradeDecision actually produced (not dict)
- [ ] Live trading verified using new pipeline
- [ ] Single canonical decision path (no duplicates)
- [ ] Request correlation logging
- [ ] 12+ tests passing
- [ ] No critical TODO/FIXME in production path
- [ ] TypeScript builds
- [ ] Python compiles

## Verification Checklist (Final)

Before claiming PHASE 2.1 "Done":

1. **Code Compile:**
   ```bash
   cd /root/BotTrading
   python3 -m py_compile trading-bot/main.py  # Python ✅
   # pnpm build  # TypeScript (if applicable)
   ```

2. **Schema Validation:**
   ```bash
   cd trading-bot && python3 ai_decision_models.py  # ✅ All tests pass
   ```

3. **Tests Execute:**
   ```bash
   cd trading-bot && python3 -m pytest tests/ -v  # ✅ 100% pass
   ```

4. **No Production Stubs:**
   ```bash
   grep -r "return {}\|echo\|TODO.*AI\|FIXME.*AI" trading-bot/ packages/ai/src/providers/adapters/ | wc -l  # Must be 0 in production path
   ```

5. **Live Trading Verified:**
   - Find entry point in main loop
   - Trace call to ask_ai()
   - Verify return value is used as TradeDecision
   - Document call chain

6. **Canonical Path Verified:**
   - Single source of truth: ask_ai() → TradeDecision
   - No parallel decision engines
   - No old regex parsing of AI responses

