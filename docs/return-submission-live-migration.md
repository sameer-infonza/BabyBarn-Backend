# Return Submission Live Migration

This rollout preserves existing return data.

## What changes

The grouped returns update adds `submissionPublicId` to `ReturnRequest`.

- Existing rows keep their current return identity by copying `publicId` into `submissionPublicId`
- New grouped submissions reuse one shared `submissionPublicId` across multiple child return rows
- No old return rows are deleted or rewritten into a different historical record

## Production-safe order

1. Stop the backend process so Prisma can update safely.
2. Deploy the new code.
3. Run the Prisma migration:

```bash
cd backend
npx prisma migrate deploy
```

4. Run the idempotent backfill script:

```bash
npm run backfill:return-submission-id
```

5. Regenerate the Prisma client if your deploy flow does not already do it:

```bash
npm run prisma:generate
```

6. Start the backend again.

## Safety checks

To preview the backfill without changing data:

```bash
cd backend
npm run backfill:return-submission-id:dry
```

The backfill script verifies:

- total `ReturnRequest` row count before and after
- how many rows are missing `submissionPublicId`
- that no rows remain unfilled after the update

## Why old data is safe

For pre-existing returns, the migration does this:

```sql
UPDATE "ReturnRequest"
SET "submissionPublicId" = "publicId"
WHERE "submissionPublicId" IS NULL OR "submissionPublicId" = '';
```

So every old return keeps a one-to-one shared submission ID equal to its original public return ID.
