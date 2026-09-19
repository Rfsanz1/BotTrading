# Deployment Guide (Production)

This document explains how to run RFSANZ services in production using Docker Compose and CI/CD.

Prerequisites
- Docker & Docker Compose
- A Postgres instance (or use the provided postgres service)
- A Redis instance
- Environment variables set in production (see `env` section)

Quickstart (single host)
1. Build images locally:
```bash
docker compose -f docker-compose.prod.yml build
```
2. Start services:
```bash
docker compose -f docker-compose.prod.yml up -d
```

Environment
- `DATABASE_URL` — Postgres connection URL
- `REDIS_URL` — Redis connection URL
- `NODE_ENV=production`
- `PORT` — API port (default 3001)
- `CORS_ORIGIN` — comma-separated allowed origins

Security & Hardening
- Use a TLS-enabled reverse proxy (Traefik, Nginx) in front of the API.
- Provide secrets through a vault (HashiCorp Vault, AWS Secrets Manager) or environment variables managed by orchestration.
- Rotate API keys and provider credentials periodically.
- Ensure rate limits and authentication are enforced (see `apps/api/src/main.ts`).

CI/CD
- A GitHub Actions workflow is provided at `.github/workflows/ci-cd.yml` that runs typecheck, build, tests and builds the `apps/api` Docker image.
- Extend the workflow to push built images to your container registry and deploy to your orchestrator (Kubernetes, ECS, Railway, etc.).

Monitoring
- Prometheus metrics exposed at `/metrics`.
- Use logs shipped from `pino` (stdout) to your log aggregator (ELK, Loki, Datadog).

Testing
- Unit tests are defined in package-level `__tests__` folders and executed by the workspace test runner. See `packages/exchange` sample.
- Integration and E2E tests should be added to `tests/integration` and `tests/e2e` and run in CI using ephemeral Postgres/Redis services.

Notes
- Update `docker-compose.prod.yml` with production-ready images and secrets.
- Replace adapter stubs in `packages/exchange` and `packages/ai` with real provider SDK implementations before production.
