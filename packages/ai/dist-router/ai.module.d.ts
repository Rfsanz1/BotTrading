import { type DynamicModule } from '@nestjs/common';
import { type RouterConfig } from './router/router.config';
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
export declare class AIModule {
    static register(options?: AIModuleOptions): DynamicModule;
}
