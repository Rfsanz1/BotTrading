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
- `pnpm auth:password-reset` — local ADMIN-only password reset; prompts for actor, target, and the new password without echoing it
- `pnpm auth:bootstrap-password` — local root-only first-password bootstrap for an active passwordless user

The password reset command requires an active database user with the `ADMIN`
role as the actor. It hashes the password with the shared bcrypt helper,
invalidates the target user's sessions, and writes an audit event without
recording the password. It does not grant roles or change ownership. Do not
create a default password or pass passwords as command-line arguments.

The bootstrap command is a break-glass local operation. Run it only from a
local root session; detectable SSH sessions and non-root execution are
rejected. It requires an explicit target ID, displays only sanitized account
state, refuses users with an existing password, prompts twice with hidden
input, hashes transactionally, invalidates sessions, and writes
`USER_INITIAL_PASSWORD_BOOTSTRAP` without storing the password. It never changes
roles, ownership, exchange credentials, or trading state.
