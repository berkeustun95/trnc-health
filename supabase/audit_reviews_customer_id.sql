-- ═══════════════════════════════════════════════════════════════════════════
-- 20261033 RETEST — the AUTHENTICATED half. SQL editor, Role = postgres.
--
-- The original probe used the anon key, proved `anon` is denied, and I reported
-- "20261033 is applied" on that basis. That generalised from one role to two.
-- `authenticated` is every signed-in user AND every guest, and it was never tested.
--
-- has_column_privilege resolves INHERITED privilege, so it also answers the thing a
-- grantee-filtered count cannot: a grant made to PUBLIC, or reaching these roles through
-- role membership, shows up here and nowhere else.
-- Expect: both false. Anything else means the column is still reachable.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'anon'          AS role,
       has_column_privilege('anon',          'public.reviews', 'customer_id', 'SELECT') AS can_read_customer_id
UNION ALL
SELECT 'authenticated',
       has_column_privilege('authenticated', 'public.reviews', 'customer_id', 'SELECT')
UNION ALL
SELECT 'PUBLIC (implicit grants)',
       has_column_privilege('public',        'public.reviews', 'customer_id', 'SELECT');

-- And the columns each role CAN read, derived — so a future ADD COLUMN that somebody
-- granted shows up rather than hiding inside a count.
SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name) AS readable_columns
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='reviews' AND privilege_type='SELECT'
  AND grantee IN ('anon','authenticated')
GROUP BY grantee ORDER BY grantee;
