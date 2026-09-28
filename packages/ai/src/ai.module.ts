import { Module, type DynamicModule } from '@nestjs/common';

import { ROUTER_CONFIG, ROUTER_SERVICE, loadRouterConfig, type RouterConfig } from './router/router.config';
import { RouterClient } from './router/router.client';
import { RouterService } from './router/router.service';
import { RouterHealth } from './router/router.health';

export interface AIModuleOptions {
  /** Override any RouterConfig values at module registration time. */
  config?: Partial<RouterConfig>;
}

/**
 * NestJS module that wires the canonical 9Router transport.
 *
 * Usage in an AppModule:
 * ```ts
 * @Module({ imports: [AIModule.register()] })
 * export class AppModule {}
 * ```
 *
 * All production model requests must flow through the exported RouterService.
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

      ],
      exports: [
        RouterService,
        RouterHealth,
        ROUTER_CONFIG,
      ],
    };
  }
}
