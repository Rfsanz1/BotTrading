# RFSANZ AI Trading — Architecture Overview

Goals
- Clean Architecture + DDD for maintainability and testability.
- Modular packages for reuse across services.
- Production-grade infra: DB, Redis, job queues, observability.

Layers
- apps/: application entrypoints (API, Web, Admin, Telegram)
- packages/: domain modules and shared libraries

Conventions
- All TypeScript projects use strict mode.
- Packages export a minimal API surface in `src/index.ts`.
- Infrastructure config lives in `docker-compose.monorepo.yml` and service-level Dockerfiles.

Recommendations
- Use Prisma in `packages/database` with a single canonical client exported.
- Keep business logic inside domain packages (packages/*) and keep apps thin.
