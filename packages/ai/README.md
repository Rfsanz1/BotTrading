# @rfsanz/ai

AI Engine package implementing provider pattern, prompt templates, conversation history, streaming and consensus.

Usage (high-level):
- `AIService.sendMessage(provider, conversationId, messages, onChunk?)` — send message and optionally stream chunks via callback.
- `AIService.consensus(conversationId, messages, providers[])` — run providers in parallel and return aggregated result.
- `renderTemplate(template, vars)` — mustache prompt templating.

Adapters are stubs — replace implementations in `src/providers/adapters/*` with real SDK calls.
