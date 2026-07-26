Exchange Adapter SDK (TypeScript)
=================================

This folder contains a small TypeScript abstraction for exchange adapters. It is intended
to provide a common interface for frontend or backend code to interact with multiple
exchange providers while following SOLID principles:

- Single Responsibility: each adapter is responsible only for one exchange.
- Open/Closed: add new adapters by implementing the `IExchange` interface without changing consumers.
- Liskov Substitution: consumers use the `IExchange` contract and can swap adapters.
- Interface Segregation: adapter methods are small and focused; optional market methods are separate.
- Dependency Inversion: higher-level services should depend on `IExchange` abstractions.

Files:
- `IExchange.ts` — the common interface and types.
- `ExchangeBase.ts` — abstract base with small helpers.
- `adapters/*.ts` — per-exchange stubs. Implement REST/WebSocket logic here.
- `factory.ts` — simple factory to create adapters by name.

How to extend:
1. Create a new file under `adapters/` and extend `ExchangeBase`.
2. Implement required methods (`connect`, `disconnect`, `placeOrder`, etc.).
3. Register the adapter in `factory.ts`.

Security:
- Keep API keys off the client — adapters that require secrets should live on the backend.
