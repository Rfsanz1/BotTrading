import type { MarketContext, AITradingSignal, AIRiskAssessment, RiskLevel } from '../core/ai.types';

/**
 * Builds user-role prompts for risk assessment,
 * and parses raw AI text into typed AIRiskAssessment objects.
 */
export const RiskPrompt = {
  build(ctx: MarketContext, signal: AITradingSignal): string {
    const atr = ctx.indicators.atr ?? 0;
    const atrPct = ctx.currentPrice > 0 ? ((atr / ctx.currentPrice) * 100).toFixed(2) : 'N/A';

    return `## Risk Assessment Request

**Symbol:** ${ctx.symbol}  **Price:** ${ctx.currentPrice}
**Proposed Action:** ${signal.action}  **Confidence:** ${signal.confidence}%
**Reasoning:** ${signal.reasoning}

### Risk Parameters
- ATR (volatility): ${atr.toFixed(4)} (${atrPct}% of price)
- Proposed Stop-Loss:    ${signal.stopLoss   ?? 'not set'}
- Proposed Take-Profit: ${signal.takeProfit  ?? 'not set'}
- Proposed Position:    ${signal.positionSizePct ?? 'not set'}% of capital
${ctx.indicators.rsi !== undefined ? `- RSI: ${ctx.indicators.rsi.toFixed(2)}` : ''}
${ctx.indicators.adx !== undefined ? `- ADX (trend strength): ${ctx.indicators.adx.toFixed(2)}` : ''}

### Constraints
- Max loss per trade:  2% of capital
- Daily loss limit:    5% of capital
- Max position size:   10% of capital per symbol

### Required Output
Respond ONLY with a JSON object:
\`\`\`json
{
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "maxDrawdownPct": number,
  "recommendation": "string (max 150 chars)",
  "shouldProceed": boolean,
  "warnings": ["string", ...],
  "suggestedSizePct": number
}
\`\`\``;
  },

  // ─── Parser ───────────────────────────────────────────────────────────────

  parseAssessment(content: string): AIRiskAssessment {
    try {
      const json = extractJson(content);
      const raw = JSON.parse(json) as Record<string, unknown>;

      return {
        riskLevel:        validateRiskLevel(raw['riskLevel']),
        maxDrawdownPct:   Number(raw['maxDrawdownPct'] ?? 2),
        recommendation:   String(raw['recommendation'] ?? ''),
        shouldProceed:    Boolean(raw['shouldProceed'] ?? false),
        warnings:         toStringArray(raw['warnings']),
        suggestedSizePct: toNumberOrUndefined(raw['suggestedSizePct']),
      };
    } catch {
      return {
        riskLevel:     'HIGH',
        maxDrawdownPct: 5,
        recommendation: 'Failed to parse risk assessment — blocking trade as precaution',
        shouldProceed:  false,
        warnings:       ['AI risk assessment parsing error'],
      };
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced?.[1]) return fenced[1];
  const brace = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (brace !== -1 && last !== -1) return text.slice(brace, last + 1);
  return text;
}

function validateRiskLevel(value: unknown): RiskLevel {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'CRITICAL') {
    return value;
  }
  return 'HIGH';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
