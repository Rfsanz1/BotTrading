import type { AITradingSignal, TradingAction, Urgency } from '../core/ai.types';

/**
 * Builds supplementary user-role prompts for trade-execution context,
 * and parses raw AI text into typed AITradingSignal objects.
 */
export const TradingPrompt = {
  /**
   * Builds a follow-up prompt asking the AI to refine a signal with
   * more detail about entry, exit, and timing.
   */
  refine(symbol: string, signal: AITradingSignal): string {
    return `Given the ${signal.action} signal for ${symbol} (confidence: ${signal.confidence}%),
provide a detailed execution plan:

1. Optimal entry price range
2. Stop-loss price (hard + trailing)
3. Take-profit levels (TP1, TP2)
4. Maximum hold duration
5. Conditions that would invalidate this signal

Respond in JSON: { "entryMin": number, "entryMax": number, "stopLoss": number,
"trailingStopPct": number, "tp1": number, "tp2": number, "maxHoldMinutes": number,
"invalidationConditions": string[] }`;
  },

  /**
   * Prompt for multi-timeframe confluence check.
   */
  confluenceCheck(symbol: string, signals: Record<string, TradingAction>): string {
    const entries = Object.entries(signals)
      .map(([tf, action]) => `  ${tf}: ${action}`)
      .join('\n');

    return `Multi-timeframe signals for ${symbol}:\n${entries}\n\n
Do the timeframes show confluence (majority agreement)?
If yes, what is the combined confidence? Which timeframe should be used for entry?
Respond in JSON: { "hasConfluence": boolean, "combinedConfidence": number,
"entryTimeframe": string, "reasoning": string }`;
  },

  // ─── Parser ───────────────────────────────────────────────────────────────

  /**
   * Parse raw AI content into AITradingSignal.
   * Strips markdown fences if present. Falls back to a HOLD signal on error.
   */
  parseSignal(content: string): AITradingSignal {
    try {
      const json = extractJson(content);
      const raw = JSON.parse(json) as Record<string, unknown>;

      const action = validateAction(raw['action']);
      const confidence = clamp(Number(raw['confidence'] ?? 50), 0, 100);

      return {
        action,
        confidence,
        reasoning:       String(raw['reasoning'] ?? ''),
        stopLoss:        toNumberOrUndefined(raw['stopLoss']),
        takeProfit:      toNumberOrUndefined(raw['takeProfit']),
        positionSizePct: toNumberOrUndefined(raw['positionSizePct']),
        urgency:         validateUrgency(raw['urgency']),
        validForSeconds: toNumberOrUndefined(raw['validForSeconds']),
      };
    } catch {
      return {
        action:     'HOLD',
        confidence: 0,
        reasoning:  'Failed to parse AI response — defaulting to HOLD',
        urgency:    'LOW',
      };
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced?.[1]) return fenced[1];
  // Find first { ... } block
  const brace = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (brace !== -1 && last !== -1) return text.slice(brace, last + 1);
  return text;
}

function validateAction(value: unknown): TradingAction {
  if (value === 'BUY' || value === 'SELL' || value === 'HOLD') return value;
  return 'HOLD';
}

function validateUrgency(value: unknown): Urgency | undefined {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') return value;
  return undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
