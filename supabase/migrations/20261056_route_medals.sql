-- ═══════════════════════════════════════════════════════════════════════════
-- 20261056 — route medals: one badge per walking route, earned by walking it
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plan and decisions: ~/ObsidianVault/10-ada/2026-09-27_route-medals.md. Client side is
-- gated by ROUTE_MEDALS_LIVE (constants/flags.js); this file is safe to apply while that
-- flag is false — nothing calls it.
--
-- ─── WHAT IS STORED, AND WHAT IS NOT ────────────────────────────────────────
-- route_medals holds (user, route, completed_on) and NOTHING ELSE. No coordinates, no
-- per-stop visits, no time of day. The 70%-of-stops-within-50 m check runs on the phone;
-- the server cannot verify a walk and does not pretend to — a spoofed GPS can earn a
-- badge, which is an accepted cost for a badge.
--
-- completed_on is stamped HERE, in TRNC local time (Europe/Istanbul — the same zone
-- contact_events_monthly uses; the TRNC keeps Turkish time, not Europe/Nicosia's EET/EEST),
-- so a client cannot backdate a badge. Consequence, accepted: a guest who earns on day 1
-- and signs in on day 6 gets a badge dated day 6.
--
-- ─── WHO CAN SEE WHAT (plain English) ───────────────────────────────────────
--   route_medals rows   — the OWNER only (signed-in, not a guest), SELECT. Nobody can
--                         INSERT/UPDATE/DELETE through the API: the one write path is
--                         award_route_medal(), which only ever writes auth.uid()'s row.
--   other people        — get_profile_route_badges() returns WHICH routes (route ids, no
--                         dates) and only when get_student_profile() would show that
--                         person to that caller: both opted into the Student Hub list,
--                         not blocked either way, subject named and unbanned. It is gated
--                         BY CALLING get_student_profile, so the two cannot drift apart.
--                         Plus the subject's own switch, profiles.route_badges_public
--                         (default ON). Every "not visible" reason is zero rows — no oracle.
--   deletion            — user_id → profiles ON DELETE CASCADE (student_education's FK,
--                         verbatim), and delete_own_account deletes the profiles row.
--
-- ─── MINISTRY TOTALS ────────────────────────────────────────────────────────
-- NOT read from route_medals. The client also fires an anonymous contact_events row
-- (module 'explore', action 'route_complete', entity = route, region = the route's
-- district) — no user, no device, guests included. route_completions_monthly counts those
-- per route per TRNC month and SUPPRESSES any cell under 5 (completions NULL, suppressed
-- true). Counts are completions, not unique walkers, and a floor (fire-and-forget).
--
-- Apply: SQL Editor, Role = postgres, WHOLE FILE, once. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Requires ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.get_student_profile(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: get_student_profile(uuid,text) is missing (20261028). Nothing applied.';
  END IF;
  IF to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_anonymous_session() is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.walking_routes') IS NULL OR to_regclass('public.contact_events') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: walking_routes or contact_events is missing. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The owner's switch ──────────────────────────────────────────────────
-- Default ON, by product decision (2026-09-27): badges are visible to the people who can
-- already see this profile. Read only by get_profile_route_badges (DEFINER) — strangers
-- cannot read profiles rows at all, which is what makes a plain column safe here.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS route_badges_public boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.profiles.route_badges_public IS
  'Route badges shown on this person''s Student Hub profile to other listed students. '
  'Routes only, never dates. Default true. 20261056.';

-- ─── 2. The medals ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_medals (
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  route_id     uuid NOT NULL REFERENCES public.walking_routes(id) ON DELETE CASCADE,
  completed_on date NOT NULL,
  CONSTRAINT route_medals_pkey PRIMARY KEY (user_id, route_id)
);
COMMENT ON TABLE public.route_medals IS
  'One row per (person, walking route) earned. Route + date only — never coordinates or '
  'stops. Written only by award_route_medal(); owner-only read. 20261056.';

ALTER TABLE public.route_medals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.route_medals FROM anon, authenticated;
GRANT SELECT ON TABLE public.route_medals TO authenticated;

DROP POLICY IF EXISTS route_medals_owner_read ON public.route_medals;
CREATE POLICY route_medals_owner_read ON public.route_medals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND NOT is_anonymous_session());

-- ─── 3. The one write path ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_route_medal(p_route_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me  uuid := auth.uid();
  v_day date;
BEGIN
  -- `authenticated` includes guests; the GRANT is not the guard, this is.
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM walking_routes WHERE id = p_route_id AND is_active) THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND';
  END IF;
  -- First completion wins; a re-walk returns the original date.
  INSERT INTO route_medals (user_id, route_id, completed_on)
  VALUES (v_me, p_route_id, (now() AT TIME ZONE 'Europe/Istanbul')::date)
  ON CONFLICT ON CONSTRAINT route_medals_pkey DO NOTHING;
  SELECT m.completed_on INTO v_day FROM route_medals m WHERE m.user_id = v_me AND m.route_id = p_route_id;
  RETURN v_day;
END;
$function$;

COMMENT ON FUNCTION public.award_route_medal(uuid) IS
  'Records that the caller walked this route. Server-stamped TRNC date; idempotent '
  '(returns the first date). Guests raise AUTH_REQUIRED. 20261056.';

REVOKE ALL ON FUNCTION public.award_route_medal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_route_medal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_route_medal(uuid) TO authenticated;

-- ─── 4. Other people's badges — through the profile read itself ─────────────
CREATE OR REPLACE FUNCTION public.get_profile_route_badges(p_user_id uuid)
 RETURNS TABLE(route_id uuid)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The caller's two gates (AUTH_REQUIRED, NOT_LISTED) RAISE from inside
  -- get_student_profile, so the client sees the codes it already handles. Every reason
  -- about the SUBJECT — opted out, blocked, banned, unnamed, not a person — is zero rows
  -- there, and therefore zero rows here.
  IF NOT EXISTS (SELECT 1 FROM get_student_profile(p_user_id)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.route_id
    FROM route_medals m
    JOIN profiles p       ON p.id = m.user_id
    JOIN walking_routes r ON r.id = m.route_id AND r.is_active
   WHERE m.user_id = p_user_id
     AND p.route_badges_public
   ORDER BY r.sort_order, m.route_id;
END;
$function$;

COMMENT ON FUNCTION public.get_profile_route_badges(uuid) IS
  'Which walking-route badges a Student Hub profile shows: route ids only, never dates. '
  'Visible exactly when get_student_profile shows the person, and the subject''s '
  'route_badges_public is on. Zero rows for every not-visible reason. 20261056.';

REVOKE ALL ON FUNCTION public.get_profile_route_badges(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_route_badges(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_route_badges(uuid) TO authenticated;

-- ─── 5. The anonymous completion event ──────────────────────────────────────
-- Same name, drop-then-add (20261046's convention): the E-section token stays green.
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete'));

-- ─── 5b. Keep completions OUT of the click-through figure ──────────────────
-- contact_events_monthly (20260910, never redefined since) groups by (module, entity,
-- month) over EVERY action, and the credit tap already logs explore/<route id>/'website'.
-- Without this filter each completion would inflate that route's `taps` — the number the
-- view's own COMMENT calls sellable. Same columns, same order, so CREATE OR REPLACE keeps
-- the grants; security_invoker is restated because it is part of the definition here.
CREATE OR REPLACE VIEW public.contact_events_monthly
  WITH (security_invoker = true) AS
SELECT
  e.module,
  e.entity_id,
  date_trunc('month', l.local_ts)                  AS month,
  count(*)                                         AS taps,
  count(DISTINCT date_trunc('minute', l.local_ts)) AS tap_minutes,
  count(*) FILTER (WHERE e.action = 'call')           AS calls,
  count(*) FILTER (WHERE e.action = 'whatsapp')       AS whatsapps,
  count(*) FILTER (WHERE e.action = 'call_secondary') AS calls_secondary,
  array_agg(DISTINCT e.region ORDER BY e.region) FILTER (WHERE e.region IS NOT NULL) AS regions,
  count(*) FILTER (WHERE e.region IS NULL)            AS taps_region_unknown
FROM public.contact_events e
CROSS JOIN LATERAL (SELECT e.created_at AT TIME ZONE 'Europe/Istanbul' AS local_ts) l
WHERE e.action <> 'route_complete'
GROUP BY e.module, e.entity_id, date_trunc('month', l.local_ts);

-- ─── 6. The Ministry report ─────────────────────────────────────────────────
-- security_invoker: contact_events' own RLS (admin read) applies to whoever queries this.
-- The threshold lives in the VIEW so it cannot be forgotten in a hand-written query.
DROP VIEW IF EXISTS public.route_completions_monthly;
CREATE VIEW public.route_completions_monthly
  WITH (security_invoker = true) AS
SELECT
  c.month,
  c.route_id,
  r.region,
  r.name_i18n ->> 'en'                     AS route_name,
  CASE WHEN c.n >= 5 THEN c.n END          AS completions,
  c.n < 5                                  AS suppressed
FROM (
  SELECT date_trunc('month', e.created_at AT TIME ZONE 'Europe/Istanbul')::date AS month,
         e.entity_id AS route_id,
         count(*)    AS n
    FROM public.contact_events e
   WHERE e.module = 'explore' AND e.action = 'route_complete'
   GROUP BY 1, 2
) c
LEFT JOIN public.walking_routes r ON r.id = c.route_id;

COMMENT ON VIEW public.route_completions_monthly IS
  'Walking-route completions per route per TRNC month, for the Ministry of Tourism. '
  'Anonymous (contact_events carries no identifier); guests included. A FLOOR, and '
  'completions not unique walkers. Cells under 5 are suppressed: completions NULL, '
  'suppressed true — report them as "fewer than 5". 20261056.';

REVOKE ALL ON public.route_completions_monthly FROM anon, authenticated;
GRANT SELECT ON public.route_completions_monthly TO authenticated;

-- ─── 7. Assertions — read back from the catalogs, inside the transaction ────
DO $$
DECLARE
  v_t     regclass := to_regclass('public.route_medals');
  v_n     int;
  v_names text;
  v_def   text;
  v_role  text;
  v_priv  text;
  v_fn    text;
  v_err   text;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'route_medals is not visible to this DO block. Nothing committed; re-run the file as one paste.';
  END IF;

  -- (a) Column: NOT NULL, default true.
  SELECT format('%s|%s|%s', data_type, is_nullable, column_default) INTO v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'route_badges_public';
  IF v_def IS DISTINCT FROM 'boolean|NO|true' THEN
    RAISE EXCEPTION 'profiles.route_badges_public is % — expected boolean|NO|true', coalesce(v_def, '<missing>');
  END IF;

  -- (b) RLS on, and the FULL policy set: exactly one, permissive SELECT, guest-guarded.
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on route_medals';
  END IF;
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive || ':' || qual, ' | ' ORDER BY policyname), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'route_medals';
  IF v_n IS DISTINCT FROM 1 OR v_names NOT LIKE 'route_medals_owner_read:SELECT:PERMISSIVE:%'
     OR v_names NOT LIKE '%is_anonymous_session%' OR v_names NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'route_medals must carry exactly ONE permissive, guest-guarded owner SELECT; found %: %', v_n, v_names;
  END IF;

  -- (c) Grants: no client role may write; anon may not read.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% holds % on route_medals', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('anon', v_t, 'SELECT') THEN
    RAISE EXCEPTION 'anon holds SELECT on route_medals';
  END IF;
  IF NOT has_table_privilege('authenticated', v_t, 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on route_medals — owners could not read their own badges';
  END IF;

  -- (d) Both FKs CASCADE — the user one is what makes "deleted with the account" true.
  SELECT count(*), string_agg(pg_get_constraintdef(oid), ' | ' ORDER BY conname) INTO v_n, v_names
    FROM pg_constraint WHERE conrelid = v_t AND contype = 'f';
  IF v_n IS DISTINCT FROM 2
     OR v_names NOT LIKE '%(user_id) REFERENCES profiles(id) ON DELETE CASCADE%'
     OR v_names NOT LIKE '%(route_id) REFERENCES walking_routes(id) ON DELETE CASCADE%' THEN
    RAISE EXCEPTION 'route_medals FKs are not the two CASCADEs: % : %', v_n, coalesce(v_names, '<none>');
  END IF;

  -- (e) Functions: DEFINER, search_path pinned, guest guard reachable, no anon/PUBLIC EXECUTE.
  FOREACH v_fn IN ARRAY ARRAY['award_route_medal','get_profile_route_badges'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn
       AND p.prosecdef AND p.proconfig::text ILIKE '%search_path=public%';
    IF v_n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '% is not exactly one DEFINER function with search_path pinned (matched %)', v_fn, v_n;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
      LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND p.proname = v_fn
       AND a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR r.rolname = 'anon');
    IF v_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '% grant(s) of EXECUTE to anon or PUBLIC on %', v_n, v_fn;
    END IF;
  END LOOP;

  SELECT pg_get_function_result(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_profile_route_badges';
  IF v_def IS DISTINCT FROM 'TABLE(route_id uuid)' THEN
    RAISE EXCEPTION 'get_profile_route_badges returns % — must be route ids only, never dates', coalesce(v_def, '<missing>');
  END IF;

  -- (f) POSITIVE CONTROLS: as postgres there is no auth.uid(), so both must RAISE before
  --     touching a table. A healthy system prints an exception here; a broken one returns.
  v_err := NULL;
  BEGIN
    PERFORM public.award_route_medal('00000000-0000-4000-8000-000000000056');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'award_route_medal with no caller did not raise AUTH_REQUIRED (got %)', coalesce(v_err, 'NO EXCEPTION');
  END IF;
  v_err := NULL;
  BEGIN
    PERFORM count(*) FROM public.get_profile_route_badges('00000000-0000-4000-8000-000000000056');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'get_profile_route_badges with no caller did not raise AUTH_REQUIRED (got %)', coalesce(v_err, 'NO EXCEPTION');
  END IF;

  -- (g) The action vocabulary grew by one and lost nothing (quoted literals: 'call' is a
  --     substring of 'call_secondary').
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  IF v_def IS NULL
     OR position('''route_complete''' in v_def) = 0 OR position('''call''' in v_def) = 0
     OR position('''whatsapp''' in v_def) = 0 OR position('''call_secondary''' in v_def) = 0
     OR position('''website''' in v_def) = 0 OR position('''maps''' in v_def) = 0 THEN
    RAISE EXCEPTION 'contact_events_action_check is wrong: %', coalesce(v_def, '<missing>');
  END IF;

  -- (h) The report view: invoker rights, anon cannot read it.
  SELECT coalesce(array_to_string(c.reloptions, ','), '') INTO v_def
    FROM pg_class c WHERE c.oid = 'public.route_completions_monthly'::regclass;
  IF v_def NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'route_completions_monthly is not security_invoker (reloptions=%)', v_def;
  END IF;
  IF has_table_privilege('anon', 'public.route_completions_monthly', 'SELECT') THEN
    RAISE EXCEPTION 'anon holds SELECT on route_completions_monthly';
  END IF;

  -- (i) Completions stay out of the click-through view, which keeps its invoker rights.
  SELECT pg_get_viewdef('public.contact_events_monthly'::regclass) INTO v_def;
  IF position('route_complete' in v_def) = 0 THEN
    RAISE EXCEPTION 'contact_events_monthly does not exclude route_complete: %', v_def;
  END IF;
  SELECT coalesce(array_to_string(c.reloptions, ','), '') INTO v_def
    FROM pg_class c WHERE c.oid = 'public.contact_events_monthly'::regclass;
  IF v_def NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'contact_events_monthly lost security_invoker (reloptions=%)', v_def;
  END IF;
END $$;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20261056_route_medals.sql', 'ebf78a5345f4d5a61dc5850bcd747dfbe43915d42c39cf791d3deae7b81b7fde')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── After applying ─────────────────────────────────────────────────────────
-- 1. supabase/verify_route_medals.sql (one DO block, writes nothing that survives) —
--    the behavioural pass: award as a real user, owner reads, stranger reads nothing,
--    the switch hides badges, deletion cascades.
-- 2. supabase/verify_schema.sql — the 1056 tokens must be OK.
--
-- ─── Rollback (only while no real medals exist) ─────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--     DROP VIEW IF EXISTS public.route_completions_monthly;
--     -- and re-run 20260910's CREATE VIEW contact_events_monthly (no action filter)
--     ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_action_check;
--     ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--       CHECK (action IN ('call','whatsapp','call_secondary','website','maps'));   -- fails if route_complete rows exist: correct
--     DROP FUNCTION IF EXISTS public.get_profile_route_badges(uuid);
--     DROP FUNCTION IF EXISTS public.award_route_medal(uuid);
--     DROP TABLE IF EXISTS public.route_medals;
--     ALTER TABLE public.profiles DROP COLUMN IF EXISTS route_badges_public;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
