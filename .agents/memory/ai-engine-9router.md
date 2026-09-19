---
name: AI Engine — 9Router integration
description: Architecture decisions for packages/ai 9Router gateway layer (Tahap 3)
---

# AI Engine — 9Router (Tahap 3)

## Rule
ALL AI traffic must go through 9Router (`packages/ai/src/router/`). Never call OpenAI/Gemini/Claude/Groq SDKs directly from new code.

**Why:** User's explicit constraint. 9Router is an OpenAI-compatible gateway (POST /v1/chat/completions, GET /v1/models).

## How to apply
- Use `RouterService.chat()` / `RouterService.stream()` for all LLM calls.
- Inject via `AIManager` (adds retry + timeout) or `AIService` (trading-aware methods).
- Register `AIModule.register()` in any NestJS app to get all providers wired.

## Key ENV vars
- `AI_BASE_URL` — 9Router URL (default: http://localhost:20128/v1)
- `AI_API_KEY`  — bearer token (empty = unauthenticated local)
- `AI_MODEL`    — default model (default: google/gemini-2.5-pro)
- `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_RETRY_DELAY_MS`

## Naming quirk
`RouterService` has a `healthService` private field (not `health`) because the method is also named `health()`. Naming both the same would cause TS duplicate-identifier error.

## Jest quirk
`packages/ai/jest.config.js` uses `tsconfig.jest.json` (not tsconfig.json) because the base tsconfig uses `moduleResolution: "bundler"` which ts-node/ts-jest don't support. tsconfig.jest.json overrides to `commonjs`/`node`.

## Index export clash
`packages/ai/src/index.ts` exports `AIService` from legacy `./ai.service` AND from new `./core`. To avoid clash, new core AIService is re-exported as `AIEngineService`. Pre-existing duplicate exports (ConsensusEngine, PromptTemplate etc.) in legacy files are known pre-existing TS errors — do not fix unless explicitly asked.
