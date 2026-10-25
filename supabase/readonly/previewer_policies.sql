-- Read-only: every RLS policy that uses is_previewer() (the 1120 reuse contract counts them).
SELECT schemaname, tablename, policyname, cmd, roles::text AS roles, (with_check IS NOT NULL) AS has_with_check,
       (coalesce(qual,'') LIKE '%is_active%') AS mentions_is_active
FROM pg_policies
WHERE coalesce(qual,'') LIKE '%is_previewer()%' OR coalesce(with_check,'') LIKE '%is_previewer()%'
ORDER BY 1, 2, 3;
