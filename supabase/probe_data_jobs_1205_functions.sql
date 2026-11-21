-- Read-only. Catalogs only: no table rows, no user ids, no counts.
-- The three functions 20261205_data_jobs creates, checked against what origin/main expects:
-- admin_data_jobs() and record_data_job_run(...) as 20261205 writes them; data_jobs_overview(timestamptz) as 20261210
-- rewrote it on purpose (20261211 and later only call it). Body = md5 of prosrc, expected value computed from the
-- $function$ body in the file. One row per fact: expected beside live, then OK / NOT OK.
-- Grants: only what the files state (REVOKE/GRANT lines) is asserted; the full ACL is printed as info.
-- Positive control: the 20261205 overview body must NOT match (20261210 replaced it).
WITH f(fn, sig, exp_definer, exp_vol, exp_body_md5) AS (
  VALUES
    ('admin_data_jobs',     'public.admin_data_jobs()',                                         true,  's', '8608f846ddb364925639de9a265d30ef'),
    ('data_jobs_overview',  'public.data_jobs_overview(timestamptz)',                           false, 's', '49e72b1867dd3629d5345037ac8376be'),
    ('record_data_job_run', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', false, 'v', 'd9f9c2a05f4154f90a1aca90706eb352')
), live AS (
  SELECT f.*, p.oid,
         pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer, p.provolatile::text AS vol,
         array_to_string(p.proconfig, ',') AS config, md5(p.prosrc) AS body_md5, length(p.prosrc) AS body_len,
         p.proacl::text AS acl,
         (SELECT string_agg(g, ',' ORDER BY g) FROM (
            SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS g
              FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) x) AS non_owner_exec
    FROM f LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
), grants(fn, sig, grantee, exp) AS (
  VALUES
    ('admin_data_jobs',     'public.admin_data_jobs()',                                         'public',        false),
    ('admin_data_jobs',     'public.admin_data_jobs()',                                         'anon',          false),
    ('admin_data_jobs',     'public.admin_data_jobs()',                                         'authenticated', true),
    ('record_data_job_run', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'public',        false),
    ('record_data_job_run', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'anon',          false),
    ('record_data_job_run', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'authenticated', false),
    ('record_data_job_run', 'public.record_data_job_run(text,text,text,text,text,timestamptz)', 'service_role',  true)
), grant_live AS (
  SELECT g.*, p.oid,
         CASE WHEN p.oid IS NULL THEN NULL
              WHEN g.grantee = 'public' THEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
              ELSE has_function_privilege(g.grantee, p.oid, 'EXECUTE') END AS has_exec
    FROM grants g LEFT JOIN pg_proc p ON p.oid = to_regprocedure(g.sig)
)
SELECT fn, 'a exists' AS fact, 'yes' AS expected, CASE WHEN oid IS NULL THEN 'MISSING' ELSE 'yes' END AS live,
       CASE WHEN oid IS NOT NULL THEN 'OK' ELSE 'NOT OK' END AS verdict FROM live
UNION ALL SELECT fn, 'b owner', 'postgres', coalesce(owner, '-'), CASE WHEN owner = 'postgres' THEN 'OK' ELSE 'NOT OK' END FROM live
UNION ALL SELECT fn, 'c security definer', exp_definer::text, coalesce(definer::text, '-'),
       CASE WHEN oid IS NOT NULL AND definer = exp_definer THEN 'OK' ELSE 'NOT OK' END FROM live
UNION ALL SELECT fn, 'd volatility', exp_vol, coalesce(vol, '-'), CASE WHEN oid IS NOT NULL AND vol = exp_vol THEN 'OK' ELSE 'NOT OK' END FROM live
UNION ALL SELECT fn, 'e config', 'search_path=public', coalesce(config, '-'),
       CASE WHEN config IS NOT DISTINCT FROM 'search_path=public' THEN 'OK' ELSE 'NOT OK' END FROM live
UNION ALL SELECT fn, 'f body md5 (len)', exp_body_md5, coalesce(body_md5 || ' (' || body_len || ')', '-'),
       CASE WHEN body_md5 IS NOT DISTINCT FROM exp_body_md5 THEN 'OK' ELSE 'NOT OK' END FROM live
UNION ALL SELECT fn, 'g EXECUTE ' || grantee, CASE WHEN exp THEN 'yes' ELSE 'no' END,
       CASE WHEN has_exec IS NULL THEN '-' WHEN has_exec THEN 'yes' ELSE 'no' END,
       CASE WHEN has_exec IS NOT DISTINCT FROM exp THEN 'OK' ELSE 'NOT OK' END FROM grant_live
UNION ALL SELECT fn, 'g EXECUTE held by any non-owner', 'none', coalesce(non_owner_exec, CASE WHEN oid IS NULL THEN '-' ELSE 'none' END),
       CASE WHEN oid IS NOT NULL AND non_owner_exec IS NULL THEN 'OK' ELSE 'NOT OK' END
  FROM live WHERE fn = 'data_jobs_overview'
UNION ALL SELECT fn, 'h raw ACL', '-', coalesce(acl, '(null = default)'), 'info' FROM live
UNION ALL SELECT 'data_jobs_overview', 'i control: 20261205 body is gone (20261210 replaced it)', 'not f3d621d3f86f615c10453f22c6f30d9c',
       coalesce(md5(p.prosrc), '-'),
       CASE WHEN md5(p.prosrc) IS DISTINCT FROM 'f3d621d3f86f615c10453f22c6f30d9c' THEN 'OK' ELSE 'NOT OK' END
  FROM pg_proc p WHERE p.oid = to_regprocedure('public.data_jobs_overview(timestamptz)')
ORDER BY 1, 2;
