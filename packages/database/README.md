# @rfsanz/database

Place Prisma schema and migration scripts here. This package exposes a shared Prisma client used by backend services.

Files:
- prisma/schema.prisma — database schema
- src/client.ts — exported Prisma client instance

Running migrations and seed
--------------------------
Install dependencies and generate client:

```bash
pnpm --filter @rfsanz/database install
pnpm --filter @rfsanz/database run prisma:generate
```

Create dev migration and apply:

```bash
pnpm --filter @rfsanz/database run migrate:dev
```

Seed data (after migrations):

```bash
pnpm --filter @rfsanz/database run seed
```

Indexes are declared in the Prisma schema using `@@index` directives where appropriate. For production, review and add additional partial or expression indexes in Postgres if needed.
