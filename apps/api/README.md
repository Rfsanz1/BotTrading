# API (NestJS)

This app uses NestJS and exposes the backend API for RFSANZ AI Trading.

Environment variables (examples):
- DATABASE_URL=postgresql://user:pass@host:5432/db
- REDIS_URL=redis://redis:6379
- JWT_ACCESS_SECRET=your_access_secret
- JWT_REFRESH_SECRET=your_refresh_secret

Commands:
- `pnpm --filter @rfsanz/api dev` — run dev
- `pnpm --filter @rfsanz/api build` — build
