-- =============================================================================
-- MyBABY BARN — PostgreSQL health & optimization checklist
-- Safe to run: read-only SELECT queries (no DDL/DML that mutates data).
-- Prefer staging or a recent prod COPY. Review output before any VACUUM/REINDEX.
-- Usage:  psql "$DATABASE_URL" -f optimize-checklist.sql
-- =============================================================================

\timing on
\echo '=== 1. Database size ==='
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

\echo '=== 2. Largest tables (heap + indexes + TOAST) ==='
SELECT
  schemaname,
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_indexes_size(relid)) AS indexes_size,
  n_live_tup AS estimated_live_rows,
  n_dead_tup AS estimated_dead_rows,
  CASE
    WHEN n_live_tup > 0
      THEN round(100.0 * n_dead_tup / n_live_tup, 2)
    ELSE 0
  END AS dead_pct
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 40;

\echo '=== 3. Tables with high dead-tuple ratio (candidate for VACUUM) ==='
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  round(100.0 * n_dead_tup / NULLIF(n_live_tup, 0), 2) AS dead_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
  AND n_dead_tup > COALESCE(n_live_tup, 0) * 0.05
ORDER BY n_dead_tup DESC
LIMIT 30;

\echo '=== 4. Unused indexes (never scanned since stats reset) — review carefully ==='
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 50;

\echo '=== 5. Duplicate / overlapping indexes (same column key) — manual review ==='
SELECT
  indrelid::regclass AS table_name,
  array_agg(indexrelid::regclass ORDER BY indexrelid) AS indexes
FROM pg_index
JOIN pg_class c ON c.oid = indrelid
WHERE c.relnamespace = 'public'::regnamespace
  AND indislive
GROUP BY indrelid, indkey
HAVING count(*) > 1
ORDER BY indrelid::regclass::text;

\echo '=== 6. Foreign keys without supporting index on referencing column(s) ==='
WITH fk AS (
  SELECT
    conrelid AS table_oid,
    conname,
    pg_get_constraintdef(oid) AS def,
    (
      SELECT array_agg(a.attname ORDER BY u.ord)
      FROM unnest(conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = u.attnum
    ) AS cols
  FROM pg_constraint
  WHERE contype = 'f'
    AND connamespace = 'public'::regnamespace
),
idx AS (
  SELECT
    indrelid AS table_oid,
    (
      SELECT array_agg(a.attname ORDER BY u.ord)
      FROM unnest(indkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = indrelid AND a.attnum = u.attnum
      WHERE u.attnum > 0
    ) AS cols
  FROM pg_index
  WHERE indisvalid
)
SELECT
  fk.conname AS foreign_key,
  fk.table_oid::regclass AS table_name,
  fk.cols AS fk_columns,
  fk.def
FROM fk
WHERE NOT EXISTS (
  SELECT 1
  FROM idx
  WHERE idx.table_oid = fk.table_oid
    AND idx.cols IS NOT NULL
    AND fk.cols IS NOT NULL
    AND idx.cols[1:array_length(fk.cols, 1)] = fk.cols
)
ORDER BY table_name::text, foreign_key;

\echo '=== 7. Sequential scan heavy tables (may need better indexes or ANALYZE) ==='
SELECT
  schemaname,
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup,
  CASE
    WHEN (seq_scan + COALESCE(idx_scan, 0)) > 0
      THEN round(100.0 * seq_scan / (seq_scan + COALESCE(idx_scan, 0)), 2)
    ELSE 0
  END AS seq_scan_pct
FROM pg_stat_user_tables
WHERE seq_scan > 100
ORDER BY seq_tup_read DESC
LIMIT 30;

\echo '=== 8. Cache hit ratio (want > ~99% on warm production) ==='
SELECT
  'index' AS kind,
  sum(idx_blks_hit) AS hits,
  sum(idx_blks_read) AS reads,
  round(
    100.0 * sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0),
    2
  ) AS hit_pct
FROM pg_statio_user_indexes
UNION ALL
SELECT
  'table' AS kind,
  sum(heap_blks_hit),
  sum(heap_blks_read),
  round(
    100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0),
    2
  )
FROM pg_statio_user_tables;

\echo '=== 9. Hot business tables — row estimates ==='
SELECT relname, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
WHERE relname IN (
  'User', 'Product', 'ProductVariant', 'Order', 'OrderItem',
  'ReturnRequest', 'InventoryLedgerEvent', 'StoreCreditTransaction',
  'CheckoutIntent', 'AdminAuditLog', 'StripeWebhookEvent',
  'ShippingProviderLog', 'ShipmentTrackingEvent', 'AdminNotification'
)
ORDER BY n_live_tup DESC;

\echo '=== 10. Invalid / not-ready indexes ==='
SELECT
  c.relname AS index_name,
  t.relname AS table_name,
  i.indisvalid,
  i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
WHERE t.relnamespace = 'public'::regnamespace
  AND (NOT i.indisvalid OR NOT i.indisready);

\echo '=== 11. Autovacuum / settings snapshot (informational) ==='
SHOW autovacuum;
SHOW shared_buffers;
SHOW effective_cache_size;
SHOW work_mem;
SHOW maintenance_work_mem;
SHOW random_page_cost;
SHOW max_connections;

\echo '=== 12. Optional: activity snapshot ==='
SELECT
  pid,
  usename,
  state,
  wait_event_type,
  wait_event,
  left(query, 120) AS query_preview,
  now() - query_start AS running_for
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state IS NOT NULL
ORDER BY query_start NULLS LAST
LIMIT 40;

\echo '=== DONE ==='
\echo 'Next steps (manual, maintenance window only):'
\echo '  - High dead_pct  -> VACUUM (ANALYZE) "TableName";'
\echo '  - Confirmed unused large index -> DROP INDEX CONCURRENTLY ...'
\echo '  - Missing FK index -> CREATE INDEX CONCURRENTLY ...'
\echo '  - Low cache hit -> check shared_buffers / RAM / query patterns'
\echo '  - Never VACUUM FULL / REINDEX on prod without a plan'
