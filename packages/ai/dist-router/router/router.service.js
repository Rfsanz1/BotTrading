"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouterService = void 0;
const common_1 = require("@nestjs/common");
const logger_1 = require("@rfsanz/logger");
const router_client_1 = require("./router.client");
const router_health_1 = require("./router.health");
const router_config_1 = require("./router.config");
const utils_1 = require("../utils");
/**
 * Primary consumer-facing service for the 9Router gateway.
 * Implements IRouterService and adds retry, timeout, and logging on top of
 * the thin RouterClient.
 */
let RouterService = class RouterService {
    client;
    healthService;
    config;
    log;
    constructor(client, healthService, config) {
        this.client = client;
        this.healthService = healthService;
        this.config = config;
        this.log = (0, logger_1.createLogger)('RouterService');
    }
    // ─── chat() ───────────────────────────────────────────────────────────────
    async chat(messages, options = {}) {
        const model = options.model ?? this.config.defaultModel;
        const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
        const retries = options.retries ?? this.config.maxRetries;
        this.log.debug({ model, messages: messages.length }, 'RouterService.chat');
        return (0, utils_1.withRetry)(() => (0, utils_1.withTimeout)(() => this.client.chatCompletions({
            model,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            stream: false,
        }), timeoutMs), {
            retries,
            delayMs: this.config.retryDelayMs,
            factor: 2,
            shouldAbort: (error) => {
                const status = error?.response?.status;
                return status === 401 || status === 403;
            },
            onRetry: (attempt, err) => {
                this.log.warn({ attempt, model, error: err.message }, 'RouterService.chat retry');
            },
        });
    }
    // ─── stream() ─────────────────────────────────────────────────────────────
    async *stream(messages, options = {}) {
        const model = options.model ?? this.config.defaultModel;
        this.log.debug({ model, messages: messages.length }, 'RouterService.stream');
        yield* this.client.streamCompletions({
            model,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            stream: true,
        });
    }
    // ─── listModels() ─────────────────────────────────────────────────────────
    async listModels() {
        this.log.debug('RouterService.listModels');
        const res = await this.client.getModels();
        return res.data;
    }
    // ─── health() ─────────────────────────────────────────────────────────────
    async health() {
        return this.healthService.check();
    }
    // ─── embeddings() ─────────────────────────────────────────────────────────
    async embeddings(request) {
        this.log.debug({ model: request.model }, 'RouterService.embeddings');
        return this.client.createEmbedding(request);
    }
};
exports.RouterService = RouterService;
exports.RouterService = RouterService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(router_config_1.ROUTER_CONFIG)),
    __metadata("design:paramtypes", [router_client_1.RouterClient,
        router_health_1.RouterHealth, Object])
], RouterService);
