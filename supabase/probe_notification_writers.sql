-- Read-only probe (2026-11-13): which functions write notifications rows, after 20261196 turned
-- verify_schema's "6 notification writers" token red. Function names and two pattern flags only;
-- no user data, no counts of rows.
SELECT p.proname,
       p.prosrc LIKE '%INSERT INTO notifications (user_id, title, body, type%) VALUES%' AS sets_type,
       p.prosrc LIKE '%INSERT INTO notifications (user_id, title, body) VALUES%' AS three_column_insert
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosrc ~* 'insert\s+into\s+(public\.)?notifications\M'
ORDER BY p.proname;
