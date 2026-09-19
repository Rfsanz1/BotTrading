import type { MarketContext } from '../core/ai.types';

/**
 * Builds the user-role prompt for market analysis requests.
 * Serialises MarketContext into a structured, LLM-friendly format.
 */
export const MarketPrompt = {
  build(ctx: MarketContext): string {
    const ind = ctx.indicators;
    const lines: string[] = [
      `## Market Analysis Request`,
      ``,
      `**Symbol:** ${ctx.symbol}  **Interval:** ${ctx.interval}`,
      `**Current Price:** ${ctx.currentPrice}`,
      ctx.volume24h          !== undefined ? `**24h Volume:** ${ctx.volume24h}` : '',
      ctx.priceChange24hPct  !== undefined ? `**24h Change:** ${ctx.priceChange24hPct.toFixed(2)}%` : '',
      ctx.trend              !== undefined ? `**Detected Trend:** ${ctx.trend}` : '',
      ``,
      `### Technical Indicators`,
    ];

    if (ind.rsi         !== undefined) lines.push(`- RSI (14):           ${ind.rsi.toFixed(2)}`);
    if (ind.macd        !== undefined) lines.push(`- MACD:               ${ind.macd.toFixed(4)}`);
    if (ind.macdSignal  !== undefined) lines.push(`- MACD Signal:        ${ind.macdSignal.toFixed(4)}`);
    if (ind.ema20       !== undefined) lines.push(`- EMA 20:             ${ind.ema20.toFixed(4)}`);
    if (ind.ema50       !== undefined) lines.push(`- EMA 50:             ${ind.ema50.toFixed(4)}`);
    if (ind.ema200      !== undefined) lines.push(`- EMA 200:            ${ind.ema200.toFixed(4)}`);
    if (ind.atr         !== undefined) lines.push(`- ATR (14):           ${ind.atr.toFixed(4)}`);
    if (ind.adx         !== undefined) lines.push(`- ADX (14):           ${ind.adx.toFixed(2)}`);
    if (ind.bollingerUpper !== undefined) lines.push(`- BB Upper:           ${ind.bollingerUpper.toFixed(4)}`);
    if (ind.bollingerMid   !== undefined) lines.push(`- BB Mid:             ${ind.bollingerMid.toFixed(4)}`);
    if (ind.bollingerLower !== undefined) lines.push(`- BB Lower:           ${ind.bollingerLower.toFixed(4)}`);

    if (ctx.recentCandles && ctx.recentCandles.length > 0) {
      const last3 = ctx.recentCandles.slice(-3);
      lines.push(``, `### Last ${last3.length} Candles (O/H/L/C/V)`);
      for (const c of last3) {
        lines.push(
          `- ${new Date(c.timestamp).toISOString()} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`,
        );
      }
    }

    if (ctx.additionalContext) {
      lines.push(``, `### Additional Context`, ctx.additionalContext);
    }

    lines.push(
      ``,
      `### Required Output`,
      `Respond ONLY with a JSON object matching this exact schema:`,
      `\`\`\`json`,
      `{`,
      `  "action": "BUY" | "SELL" | "HOLD",`,
      `  "confidence": 0-100,`,
      `  "reasoning": "string (max 200 chars)",`,
      `  "stopLoss": number | null,`,
      `  "takeProfit": number | null,`,
      `  "positionSizePct": number | null,`,
      `  "urgency": "LOW" | "MEDIUM" | "HIGH",`,
      `  "validForSeconds": number`,
      `}`,
      `\`\`\``,
    );

    return lines.filter((l) => l !== null).join('\n');
  },
};
