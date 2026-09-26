import { Injectable, Logger } from '@nestjs/common';
import { IAIProvider } from '../../../domain/interfaces';
import { AIAnalysisFailedException, AIProviderNotAvailableException } from '../../../domain/exceptions';

type Analysis = {
  recommendation: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  analysis: string;
  riskLevel: string;
  sentiment?: string;
  keyPoints?: string[];
};

export interface ProviderRuntimeStatus {
  provider: string;
  endpointConfigured: boolean;
  credentialConfigured: boolean;
  modelConfigured: boolean;
}

export abstract class BaseAIProvider implements IAIProvider {
  protected readonly logger = new Logger(this.constructor.name);
  abstract getName(): string;
  abstract analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis>;

  protected abstract endpointEnv: string;
  protected abstract keyEnv?: string;

  async isAvailable(): Promise<boolean> {
    const endpoint = process.env[this.endpointEnv];
    const key = this.keyEnv ? process.env[this.keyEnv] : 'configured';
    return Boolean(endpoint && key);
  }

  runtimeStatus(): ProviderRuntimeStatus {
    return {
      provider: this.getName(),
      endpointConfigured: Boolean(process.env[this.endpointEnv]),
      credentialConfigured: this.keyEnv ? Boolean(process.env[this.keyEnv]) : Boolean(process.env.OLLAMA_ENDPOINT),
      modelConfigured: Boolean(process.env.AI_MODEL || process.env[`${this.getName()}_MODEL`]),
    };
  }

  protected async callConfiguredProvider(symbol: string, data: Record<string, any>): Promise<Analysis> {
    const endpoint = process.env[this.endpointEnv];
    const key = this.keyEnv ? process.env[this.keyEnv] : undefined;
    if (!endpoint || (this.keyEnv && !key)) {
      throw new AIProviderNotAvailableException(this.getName());
    }
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(30_000, Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 8_000)));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          symbol,
          market: data,
          model: process.env.AI_MODEL || process.env[`${this.getName()}_MODEL`],
          response_format: 'json',
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`${this.getName()} returned HTTP ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const candidate = (payload.result ?? payload.output ?? payload) as Record<string, unknown>;
    const recommendation = candidate.recommendation;
    if (recommendation !== 'BUY' && recommendation !== 'SELL' && recommendation !== 'HOLD') {
      throw new Error(`${this.getName()} returned an invalid recommendation`);
    }
    const confidence = Number(candidate.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`${this.getName()} returned an invalid confidence`);
    }
    return {
      recommendation,
      confidence,
      analysis: String(candidate.analysis ?? ''),
      riskLevel: String(candidate.riskLevel ?? 'UNKNOWN'),
      sentiment: candidate.sentiment ? String(candidate.sentiment) : undefined,
      keyPoints: Array.isArray(candidate.keyPoints) ? candidate.keyPoints.map(String) : [],
    };
  }

  protected async analyzeOrFail(symbol: string, data: Record<string, any>): Promise<Analysis> {
    try {
      return await this.callConfiguredProvider(symbol, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${this.getName()} analysis failed: ${message}`);
      if (error instanceof AIProviderNotAvailableException) throw error;
      throw new AIAnalysisFailedException(this.getName(), message);
    }
  }
}

@Injectable()
export class OpenAIProvider extends BaseAIProvider {
  protected endpointEnv = 'AI_OPENAI_ENDPOINT';
  protected keyEnv = 'OPENAI_API_KEY';
  getName(): string { return 'OPENAI'; }
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis> { return this.analyzeOrFail(symbol, data); }
}

@Injectable()
export class ClaudeProvider extends BaseAIProvider {
  protected endpointEnv = 'AI_CLAUDE_ENDPOINT';
  protected keyEnv = 'ANTHROPIC_API_KEY';
  getName(): string { return 'CLAUDE'; }
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis> { return this.analyzeOrFail(symbol, data); }
}

@Injectable()
export class GeminiProvider extends BaseAIProvider {
  protected endpointEnv = 'AI_GEMINI_ENDPOINT';
  protected keyEnv = 'GEMINI_API_KEY';
  getName(): string { return 'GEMINI'; }
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis> { return this.analyzeOrFail(symbol, data); }
}

@Injectable()
export class GroqProvider extends BaseAIProvider {
  protected endpointEnv = 'AI_GROQ_ENDPOINT';
  protected keyEnv = 'GROQ_API_KEY';
  getName(): string { return 'GROQ'; }
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis> { return this.analyzeOrFail(symbol, data); }
}

@Injectable()
export class DeepSeekProvider extends BaseAIProvider {
  protected endpointEnv = 'AI_DEEPSEEK_ENDPOINT';
  protected keyEnv = 'DEEPSEEK_API_KEY';
  getName(): string { return 'DEEPSEEK'; }
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis> { return this.analyzeOrFail(symbol, data); }
}

@Injectable()
export class OllamaProvider extends BaseAIProvider {
  protected endpointEnv = 'OLLAMA_ENDPOINT';
  protected keyEnv = undefined;
  getName(): string { return 'OLLAMA'; }
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<Analysis> { return this.analyzeOrFail(symbol, data); }
}
