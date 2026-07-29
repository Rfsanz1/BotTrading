import { Injectable } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import type { IAIService } from './ai.interface';
import type { AIMessage, AIManagerOptions, AITradingSignal, AIRiskAssessment, MarketContext } from './ai.types';
import { AIManager } from './ai.manager';
import { MarketPrompt } from '../prompts/market.prompt';
import { RiskPrompt } from '../prompts/risk.prompt';
import { TradingPrompt } from '../prompts/trading.prompt';
import { SystemPrompt } from '../prompts/system.prompt';

@Injectable()
export class AIService implements IAIService {
  private readonly log: Logger;

  constructor(private readonly manager: AIManager) {
    this.log = createLogger('AIService');
  }

  // ─── Market analysis ───────────────────────────────────────────────────────

  async analyseMarket(
    ctx: MarketContext,
    options: AIManagerOptions = {},
  ): Promise<AITradingSignal> {
    this.log.debug({ symbol: ctx.symbol, interval: ctx.interval }, 'Analysing market');

    const messages: AIMessage[] = [
      { role: 'system', content: SystemPrompt.trading() },
      { role: 'user', content: MarketPrompt.build(ctx) },
    ];

    const result = await this.manager.execute(messages, {
      temperature: 0.3,
      maxTokens: 1024,
      ...options,
    });

    return TradingPrompt.parseSignal(result.response.choices[0]?.message.content ?? '');
  }

  // ─── Risk assessment ───────────────────────────────────────────────────────

  async assessRisk(
    ctx: MarketContext,
    signal: AITradingSignal,
    options: AIManagerOptions = {},
  ): Promise<AIRiskAssessment> {
    this.log.debug(
      { symbol: ctx.symbol, action: signal.action, confidence: signal.confidence },
      'Assessing risk',
    );

    const messages: AIMessage[] = [
      { role: 'system', content: SystemPrompt.riskManager() },
      { role: 'user', content: RiskPrompt.build(ctx, signal) },
    ];

    const result = await this.manager.execute(messages, {
      temperature: 0.1,
      maxTokens: 512,
      ...options,
    });

    return RiskPrompt.parseAssessment(result.response.choices[0]?.message.content ?? '');
  }

  // ─── Free-form chat ────────────────────────────────────────────────────────

  async chat(
    userMessage: string,
    history: AIMessage[] = [],
    options: AIManagerOptions = {},
  ): Promise<string> {
    this.log.debug({ historyLength: history.length }, 'Free-form chat');

    const messages: AIMessage[] = [
      { role: 'system', content: SystemPrompt.assistant() },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const result = await this.manager.execute(messages, {
      temperature: 0.7,
      maxTokens: 2048,
      ...options,
    });

    return result.response.choices[0]?.message.content ?? '';
  }
}
