import type { AITradingSignal, AIRiskAssessment, MarketContext } from '../core/ai.types';

/**
 * Builds Telegram-ready user-role prompts and formats AI responses
 * as short, human-friendly Telegram messages (≤4096 chars).
 */
export const TelegramPrompt = {
  // ─── Prompt builders ──────────────────────────────────────────────────────

  /**
   * Ask the AI to summarise a trading signal for Telegram notification.
   */
  summariseSignal(
    symbol: string,
    signal: AITradingSignal,
    risk: AIRiskAssessment,
  ): string {
    return `Summarise the following trading signal as a Telegram message for a crypto trader.
Keep it under 200 characters. Use emojis sparingly. No markdown headers.

Symbol: ${symbol}
Action: ${signal.action}
Confidence: ${signal.confidence}%
Reasoning: ${signal.reasoning}
Risk Level: ${risk.riskLevel}
Should Proceed: ${risk.shouldProceed}
${signal.stopLoss   ? `Stop-Loss: ${signal.stopLoss}`   : ''}
${signal.takeProfit ? `Take-Profit: ${signal.takeProfit}` : ''}

Write the message as plain text, one paragraph.`;
  },

  /**
   * Ask the AI to answer a natural-language Telegram command.
   */
  command(cmd: string, context: string): string {
    return `A user sent this Telegram bot command: "${cmd}"

Current bot context:
${context}

Reply in plain text, max 3 sentences. Be direct and informative.
If the command is unclear, ask for clarification politely.`;
  },

  /**
   * Ask the AI to generate a daily performance summary.
   */
  dailySummary(stats: {
    pnlUsdt: number;
    pnlPct: number;
    wins: number;
    losses: number;
    bestTrade: string;
    worstTrade: string;
  }): string {
    return `Generate a daily trading performance summary for a Telegram bot.
Keep it under 300 characters, plain text, friendly tone.

Stats:
- P&L: ${stats.pnlUsdt > 0 ? '+' : ''}${stats.pnlUsdt.toFixed(2)} USDT (${stats.pnlPct.toFixed(2)}%)
- Wins: ${stats.wins}  Losses: ${stats.losses}
- Best: ${stats.bestTrade}
- Worst: ${stats.worstTrade}`;
  },

  // ─── Formatters (no AI call needed) ──────────────────────────────────────

  /**
   * Format a trading signal as a Telegram message without AI summarisation.
   * Use when low latency is critical.
   */
  formatSignal(symbol: string, signal: AITradingSignal, risk: AIRiskAssessment): string {
    const emoji = signal.action === 'BUY' ? '🟢' : signal.action === 'SELL' ? '🔴' : '⚪';
    const riskEmoji = risk.riskLevel === 'LOW' ? '✅' : risk.riskLevel === 'MEDIUM' ? '⚠️' : '🚨';

    const lines = [
      `${emoji} *${signal.action}* ${symbol}`,
      `Confidence: ${signal.confidence}%  |  ${riskEmoji} Risk: ${risk.riskLevel}`,
      signal.stopLoss   ? `SL: ${signal.stopLoss}`   : '',
      signal.takeProfit ? `TP: ${signal.takeProfit}` : '',
      `_${signal.reasoning.slice(0, 120)}_`,
    ].filter(Boolean);

    return lines.join('\n');
  },

  /**
   * Format a market snapshot for the /saldo or /posisi command.
   */
  formatMarketSnapshot(ctx: MarketContext): string {
    const ind = ctx.indicators;
    return [
      `📊 *${ctx.symbol}* @ ${ctx.currentPrice}`,
      ind.rsi  !== undefined ? `RSI: ${ind.rsi.toFixed(1)}` : '',
      ind.macd !== undefined ? `MACD: ${ind.macd.toFixed(4)}` : '',
      ctx.trend ? `Trend: ${ctx.trend}` : '',
    ].filter(Boolean).join('  |  ');
  },
};
