-- Live definitions of the waitlist notify path, read before a migration adds a module to it
-- (Duyurular, 2026-10-10). A migration file is intent; pg_get_functiondef is the authority.
SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS md5, pg_get_functiondef(p.oid) AS def
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('notify_module_waitlist', 'module_notif_text')
ORDER BY p.proname;
