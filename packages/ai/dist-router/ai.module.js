"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AIModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIModule = void 0;
const common_1 = require("@nestjs/common");
const router_config_1 = require("./router/router.config");
const router_client_1 = require("./router/router.client");
const router_service_1 = require("./router/router.service");
const router_health_1 = require("./router/router.health");
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
let AIModule = AIModule_1 = class AIModule {
    static register(options = {}) {
        const baseConfig = (0, router_config_1.loadRouterConfig)();
        const config = { ...baseConfig, ...options.config };
        return {
            module: AIModule_1,
            providers: [
                // ── Config ─────────────────────────────────────────────────────────
                {
                    provide: router_config_1.ROUTER_CONFIG,
                    useValue: config,
                },
                // ── Router layer ───────────────────────────────────────────────────
                router_client_1.RouterClient,
                router_health_1.RouterHealth,
                router_service_1.RouterService,
                // ── Alias: ROUTER_SERVICE token → RouterService instance ──────────
                {
                    provide: router_config_1.ROUTER_SERVICE,
                    useExisting: router_service_1.RouterService,
                },
            ],
            exports: [
                router_service_1.RouterService,
                router_health_1.RouterHealth,
                router_config_1.ROUTER_CONFIG,
            ],
        };
    }
};
exports.AIModule = AIModule;
exports.AIModule = AIModule = AIModule_1 = __decorate([
    (0, common_1.Module)({})
], AIModule);
