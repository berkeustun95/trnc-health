-- READ ONLY. The rewritten 1033 count (catalogs) beside the old one (information_schema), as this role.
SELECT
  (SELECT count(*) FROM (
     SELECT a.attname, r.rolname FROM pg_attribute a
       CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
      WHERE a.attrelid = to_regclass('public.reviews') AND a.attnum > 0 AND NOT a.attisdropped
        AND x.privilege_type = 'SELECT' AND r.rolname IN ('anon','authenticated')
     UNION
     SELECT a.attname, r.rolname FROM pg_class c
       CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.oid = to_regclass('public.reviews')
        AND x.privilege_type = 'SELECT' AND r.rolname IN ('anon','authenticated')) s) AS catalog_count,
  (SELECT count(*) FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='reviews'
      AND privilege_type='SELECT' AND grantee IN ('anon','authenticated')) AS info_schema_count,
  (SELECT string_agg(a.attname || ':' || r.rolname, ' ' ORDER BY a.attname, r.rolname) FROM pg_attribute a
     CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
    WHERE a.attrelid = to_regclass('public.reviews') AND x.privilege_type='SELECT' AND r.rolname IN ('anon','authenticated')) AS column_grants,
  (SELECT string_agg(r.rolname || ':' || x.privilege_type, ' ') FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.oid = to_regclass('public.reviews') AND r.rolname IN ('anon','authenticated') AND x.privilege_type='SELECT') AS table_select_grants;
