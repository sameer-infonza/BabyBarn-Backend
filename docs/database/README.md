# MyBABY BARN — database schema pack

Share this folder with the client so they can review the PostgreSQL design and run health/optimization checks.

## Files

| File | Purpose |
|------|---------|
| `schema-full.sql` | Complete PostgreSQL DDL (enums, tables, FKs, indexes). Load into an empty review DB. |
| `SCHEMA-OVERVIEW.md` | Business-oriented map of tables by domain (easier than reading raw SQL). |
| `optimize-checklist.sql` | Safe `SELECT` diagnostics for size, indexes, bloat, slow patterns. Run against a **copy** or staging DB. |
| `indexes-inventory.md` | Declared indexes from Prisma (what we expect in Postgres). |
| `schema-objects-list.txt` | Quick list of `CREATE` statements from `schema-full.sql`. |

## Source of truth

- Application schema: `backend/prisma/schema.prisma`
- Applied history: `backend/prisma/migrations/`

Regenerate the full DDL after schema changes:

```bash
cd backend
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script -o docs/database/schema-full.sql
```

Then re-add the header comment at the top of `schema-full.sql` (or re-run your doc sync process).

## Client: load schema in PostgreSQL

```bash
createdb babybarn_schema_review
psql -d babybarn_schema_review -f schema-full.sql
```

In pgAdmin / DBeaver: connect → Schemas → `public` → Tables / Types.

## Client: optimize / health check

```bash
psql -d your_staging_or_prod_copy -f optimize-checklist.sql
```

Or paste sections into a SQL client. All statements are read-only (`SELECT` / `EXPLAIN` helpers). Do not run `VACUUM FULL` / `REINDEX` on production without a maintenance window.
