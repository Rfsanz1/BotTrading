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
exports.RouterHealth = void 0;
const common_1 = require("@nestjs/common");
const logger_1 = require("@rfsanz/logger");
const router_client_1 = require("./router.client");
const router_config_1 = require("./router.config");
/**
 * Tracks liveness of the 9Router gateway.
 * Performs periodic background pings and caches the latest status so callers
 * can query health synchronously without incurring an extra network round-trip.
 */
let RouterHealth = class RouterHealth {
    client;
    config;
    log;
    latest;
    timer = null;
    constructor(client, config) {
        this.client = client;
        this.config = config;
        this.log = (0, logger_1.createLogger)('RouterHealth');
        this.latest = this.unknown();
    }
    // ─── Start / stop periodic checks ────────────────────────────────────────
    startPeriodicChecks() {
        if (this.timer)
            return;
        this.log.info({ intervalMs: this.config.healthIntervalMs }, 'RouterHealth periodic checks started');
        // Run once immediately, then on schedule
        void this.check();
        this.timer = setInterval(() => void this.check(), this.config.healthIntervalMs);
    }
    stopPeriodicChecks() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.log.info('RouterHealth periodic checks stopped');
        }
    }
    // ─── check() — perform a live ping ───────────────────────────────────────
    async check() {
        const model = this.config.healthModel;
        try {
            const { latencyMs } = await this.client.ping(model);
            const status = {
                status: this.classify(latencyMs),
                latencyMs,
                model,
                baseUrl: this.config.baseUrl,
                checkedAt: Date.now(),
            };
            this.latest = status;
            this.log.debug({ status: status.status, latencyMs }, 'RouterHealth check OK');
            return status;
        }
        catch (error) {
            const status = {
                status: 'down',
                latencyMs: -1,
                model,
                baseUrl: this.config.baseUrl,
                checkedAt: Date.now(),
            };
            this.latest = status;
            this.log.warn({ error: error.message }, 'RouterHealth check FAILED');
            return status;
        }
    }
    // ─── getCached() — return last known status without network call ──────────
    getCached() {
        return this.latest;
    }
    // ─── helpers ──────────────────────────────────────────────────────────────
    classify(latencyMs) {
        if (latencyMs < 0)
            return 'down';
        if (latencyMs < 5_000)
            return 'ok';
        if (latencyMs < 15_000)
            return 'degraded';
        return 'down';
    }
    unknown() {
        return {
            status: 'down',
            latencyMs: -1,
            model: '',
            baseUrl: '',
            checkedAt: 0,
        };
    }
};
exports.RouterHealth = RouterHealth;
exports.RouterHealth = RouterHealth = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(router_config_1.ROUTER_CONFIG)),
    __metadata("design:paramtypes", [router_client_1.RouterClient, Object])
], RouterHealth);
