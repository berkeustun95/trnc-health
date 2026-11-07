-- The 1120 reuse-contract row of verify_schema, evaluated alone after the Araçlar S1 apply (run 42416976779 was red on
-- this row only: it pinned 4 is_previewer() policies, 20261165 added 3). Catalog reads only.
SELECT 'previewer policies' AS item,
       count(*)::text || ': ' || string_agg(schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' check=' || coalesce(with_check, '-'), ', ' ORDER BY tablename) AS value
  FROM pg_policies WHERE coalesce(qual, '') LIKE '%is_previewer()%' OR coalesce(with_check, '') LIKE '%is_previewer()%'
UNION ALL
SELECT 'fixed 1120 row (want true)',
       (NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261120_eatery_preview_key.sql')
        OR ((SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') LIKE '%is_previewer()%' OR coalesce(with_check, '') LIKE '%is_previewer()%') = 7
            AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE (coalesce(qual, '') LIKE '%is_previewer()%' OR coalesce(with_check, '') LIKE '%is_previewer()%')
                              AND (cmd IS DISTINCT FROM 'SELECT' OR with_check IS NOT NULL OR qual NOT LIKE '%is_active%'))))::text
UNION ALL
SELECT 'ledger 20261164-67', string_agg(filename, ', ' ORDER BY filename)
  FROM public.schema_migrations_applied WHERE filename LIKE '2026116_\_%' AND filename BETWEEN '20261164' AND '20261168';
