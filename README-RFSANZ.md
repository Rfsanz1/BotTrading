# RFSANZ AI Trading — Monorepo Scaffold

This repository contains a monorepo scaffold for the RFSANZ AI Trading platform. It provides an enterprise-grade folder structure and starter files for backend, frontend, integrations, and infra.

High-level layout
- apps/
  - api — NestJS backend (TypeScript, Prisma, PostgreSQL, Redis, BullMQ)
  - telegram — Telegraf-based Telegram bot
  - web — Next.js public web app (Tailwind, shadcn)
  - admin — Next.js admin console
- packages/
  - database — Prisma schema and migration helpers
  - auth — Passport JWT wrappers and auth types
  - ai — provider abstraction and adapters
  - exchange — exchange adapters (Binance, Bybit, OKX, MEXC, MT5)
  - notification — notification service (email, SMS, in-app)
  - common — shared domain types, utilities
  - shared — UI components, design tokens (for frontend)

Principles
- Clean Architecture, Domain-Driven Design, SOLID
- Modular boundaries between apps and packages
- TypeScript strict mode across all packages

Next steps
- Install dependencies with `pnpm install`
- Customize database connection and environment files in `apps/api`
- Implement business logic in domain packages under `packages/`
