import { Module, type DynamicModule } from '@nestjs/common';

import { ROUTER_CONFIG, ROUTER_SERVICE, loadRouterConfig, type RouterConfig } from './router/router.config';
import { RouterClient }  from './router/router.client';
import { RouterService } from './router/router.service';
import { RouterHealth }  from './router/router.health';
import { AIManager }     from './core/ai.manager';
import { AIService }     from './core/ai.service';
import { ConversationMemoryStore } from './memory';
import { AIResponseScorer }        from './scoring';
import { EmbeddingsService }       from './embeddings';

export interface AIModuleOptions {
  /** Override any RouterConfig values at module registration time. */
  config?: Partial<RouterConfig>;
  /** Max conversation history entries per conversation. Default: 50 */
  maxMemoryEntries?: number;
}

/**
 * NestJS module that wires the entire AI Engine.
 *
 * Usage in an AppModule:
 * ```ts
 * @Module({ imports: [AIModule.register()] })
 * export class AppModule {}
 * ```
 *
 * All exported providers can be injected with standard NestJS @Inject().
 */
@Module({})
export class AIModule {
  static register(options: AIModuleOptions = {}): DynamicModule {
    const baseConfig = loadRouterConfig();
    const config: RouterConfig = { ...baseConfig, ...options.config };

    return {
      module: AIModule,
      providers: [
        // ── Config ─────────────────────────────────────────────────────────
        {
          provide:  ROUTER_CONFIG,
          useValue: config,
        },

        // ── Router layer ───────────────────────────────────────────────────
        RouterClient,
        RouterHealth,
        RouterService,

        // ── Alias: ROUTER_SERVICE token → RouterService instance ──────────
        {
          provide:  ROUTER_SERVICE,
          useExisting: RouterService,
        },

        // ── Core AI layer ──────────────────────────────────────────────────
        AIManager,
        AIService,

        // ── Supporting services ────────────────────────────────────────────
        {
          provide:    ConversationMemoryStore,
          useFactory: () => new ConversationMemoryStore(options.maxMemoryEntries ?? 50),
        },
        AIResponseScorer,
        EmbeddingsService,
      ],
      exports: [
        RouterService,
        RouterHealth,
        AIManager,
        AIService,
        ConversationMemoryStore,
        AIResponseScorer,
        EmbeddingsService,
        ROUTER_CONFIG,
      ],
    };
  }
}
