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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouterClient = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("@rfsanz/logger");
const router_config_1 = require("./router.config");
/**
 * Low-level Axios client for the 9Router gateway.
 * Handles auth headers, base URL, and SSE stream parsing.
 * All other logic (retry, timeout, logging) lives in RouterService.
 */
let RouterClient = class RouterClient {
    config;
    http;
    log;
    constructor(config) {
        this.config = config;
        this.log = (0, logger_1.createLogger)('RouterClient');
        this.http = axios_1.default.create({
            baseURL: config.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            timeout: config.timeoutMs,
        });
        this.http.interceptors.response.use((res) => res, (err) => {
            const status = err.response?.status;
            this.log.warn({ status, code: err.code }, 'RouterClient HTTP error');
            return Promise.reject(err);
        });
    }
    // ─── Chat (non-streaming) ─────────────────────────────────────────────────
    async chatCompletions(request) {
        const res = await this.http.post('/chat/completions', { ...request, stream: false });
        return res.data;
    }
    // ─── Chat (streaming) — returns SSE as async generator ───────────────────
    async *streamCompletions(request) {
        const res = await this.http.post('/chat/completions', { ...request, stream: true }, { responseType: 'stream' });
        const stream = res.data;
        let buffer = '';
        for await (const raw of stream) {
            buffer += raw.toString('utf8');
            const lines = buffer.split('\n');
            // Keep last (potentially incomplete) line in buffer
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]')
                    continue;
                if (!trimmed.startsWith('data: '))
                    continue;
                const json = trimmed.slice(6); // strip "data: "
                try {
                    const chunk = JSON.parse(json);
                    yield chunk;
                }
                catch {
                    this.log.warn({ line: trimmed }, 'Failed to parse SSE chunk');
                }
            }
        }
    }
    // ─── Models ───────────────────────────────────────────────────────────────
    async getModels() {
        const res = await this.http.get('/models');
        return res.data;
    }
    // ─── Embeddings ───────────────────────────────────────────────────────────
    async createEmbedding(request) {
        const res = await this.http.post('/embeddings', request);
        return res.data;
    }
    // ─── Raw health ping ──────────────────────────────────────────────────────
    async ping(model) {
        const start = Date.now();
        await this.http.post('/chat/completions', {
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false,
        });
        return { latencyMs: Date.now() - start };
    }
};
exports.RouterClient = RouterClient;
exports.RouterClient = RouterClient = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(router_config_1.ROUTER_CONFIG)),
    __metadata("design:paramtypes", [Object])
], RouterClient);
