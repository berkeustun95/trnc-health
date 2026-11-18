-- Read-only. Data jobs switches (20261210): the on/off state of every switchable job, for the admin pause/resume test.
-- One row per switchable job: paused, when, the note, and records_expected_from (a resume restamps it). Then every
-- distinct 'Veri işleri' watchdog notice of the last 12 h (time + text, collapsed across admins), so the test can show
-- whether the watchdog announced anything. Job metadata only: no user id (paused_by is never read), no user count.
SELECT 'job ' || d.key AS item,
       CASE WHEN d.paused THEN 'PAUSED' ELSE 'on' END AS state,
       coalesce(d.paused_at::text, '-') AS paused_at,
       coalesce(left(d.paused_note, 60), '-') AS note,
       coalesce(d.records_expected_from::text, '-') AS records_expected_from
  FROM public.data_jobs d
 WHERE d.switchable
UNION ALL
SELECT 'control: switchable jobs (expect 7)', (SELECT count(*) FROM public.data_jobs WHERE switchable)::text, '-', '-', '-'
UNION ALL
SELECT 'control: role bypasses RLS (false = an empty list may be RLS)',
       (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user)::text, '-', '-', '-'
UNION ALL
SELECT DISTINCT 'watchdog notice', date_trunc('minute', n.created_at)::text, '-', left(replace(n.body, E'\n', ' | '), 200), '-'
  FROM public.notifications n
 WHERE n.title = 'Veri işleri' AND n.created_at > now() - interval '12 hours'
 ORDER BY 1, 2;
