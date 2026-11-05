-- ═══════════════════════════════════════════════════════════════════════════
-- 20261161 — admin_user_counts(): the numbers behind the admin user-counts screen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The app cannot read auth.users or auth.sessions, and profiles cannot tell a guest from an
-- account, so a DEFINER function is the only way these numbers reach the admin screen.
--
-- WHO CAN CALL IT: an admin session only. is_admin() is the gate, anon holds no EXECUTE.
-- WHAT IT RETURNS: counts only. No id, email, user agent or any per-user row leaves it.
-- WHAT IT WRITES: nothing. STABLE, and no table, column, policy or row changes here.
--
-- Days, weeks (Monday) and months are Europe/Nicosia, the day a TRNC reader means by "today".
-- platform_ios + platform_android + platform_unknown = accounts, one bucket per signed-up account.
-- The bucket is the newest live session that names a phone in auth.sessions.user_agent: the app
-- (okhttp, CFNetwork/Darwin) or a phone browser (Android, iPhone/iPad), which is how an email
-- confirmation link shows up. Unknown = signed out, or only a desktop browser (probes 2026-11-05:
-- 138 of 193 accounts on the app classes alone; the non-app sessions were Mozilla, and node/curl on
-- guests only). These are not installs.
-- The 10 test accounts are NOT subtracted here. AdminScreen owns that constant.
--
-- Apply: supabase-migrate. New function, so it ends with NOTIFY pgrst after COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_user_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now   timestamp := now() AT TIME ZONE 'Europe/Nicosia';
  v_today timestamp := date_trunc('day', v_now);
  v_result jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;

  WITH people AS (
    SELECT is_anonymous, created_at AT TIME ZONE 'Europe/Nicosia' AS created_local
      FROM auth.users
     WHERE deleted_at IS NULL
  ), classified AS (
    SELECT s.user_id, coalesce(s.refreshed_at, s.updated_at, s.created_at) AS last_used,
           CASE WHEN s.user_agent ILIKE '%okhttp%' OR s.user_agent ILIKE '%Android%' THEN 'android'
                WHEN s.user_agent ILIKE '%CFNetwork%' OR s.user_agent ILIKE '%Darwin%'
                  OR s.user_agent ILIKE '%iPhone%' OR s.user_agent ILIKE '%iPad%' THEN 'ios'
           END AS platform
      FROM auth.sessions s
      JOIN auth.users u ON u.id = s.user_id
     WHERE NOT u.is_anonymous AND u.deleted_at IS NULL
       AND (s.not_after IS NULL OR s.not_after > now())
  ), placed AS (
    SELECT DISTINCT ON (user_id) user_id, platform
      FROM classified
     WHERE platform IS NOT NULL
     ORDER BY user_id, last_used DESC NULLS LAST
  )
  SELECT jsonb_build_object(
    'total',         (SELECT count(*) FROM people),
    'accounts',      (SELECT count(*) FROM people WHERE NOT is_anonymous),
    'guests',        (SELECT count(*) FROM people WHERE is_anonymous),
    'new_today',     (SELECT count(*) FROM people WHERE created_local >= v_today),
    'new_week',      (SELECT count(*) FROM people WHERE created_local >= date_trunc('week', v_now)),
    'new_month',     (SELECT count(*) FROM people WHERE created_local >= date_trunc('month', v_now)),
    'platform_ios',     (SELECT count(*) FROM placed WHERE platform = 'ios'),
    'platform_android', (SELECT count(*) FROM placed WHERE platform = 'android'),
    'platform_unknown', (SELECT count(*) FROM people WHERE NOT is_anonymous) - (SELECT count(*) FROM placed),
    'daily', (
      SELECT jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n', d.n) ORDER BY d.day)
        FROM (
          SELECT g.day, count(p.created_local) AS n
            FROM generate_series(v_today - interval '29 days', v_today, interval '1 day') AS g(day)
            LEFT JOIN people p ON p.created_local >= g.day AND p.created_local < g.day + interval '1 day'
           GROUP BY g.day
        ) d
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Both anon lines matter: on Supabase a new function is born with anon in its ACL (see 20261033).
REVOKE ALL ON FUNCTION public.admin_user_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_user_counts() TO authenticated;

-- Measured as the role the app uses: a non-admin is refused and a real admin gets numbers that add
-- up. Reading only, and the positive control also proves this owner can read both auth tables.
DO $$
DECLARE
  v_admin  uuid;
  v_counts jsonb;
  v_denied boolean := false;
  v_total  bigint;
BEGIN
  IF has_function_privilege('anon', 'public.admin_user_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can still EXECUTE admin_user_counts';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_user_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE on admin_user_counts';
  END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'no admin profile to run the positive control with';
  END IF;
  SELECT count(*) INTO v_total FROM auth.users WHERE deleted_at IS NULL;

  SET LOCAL ROLE authenticated;

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
  BEGIN
    PERFORM public.admin_user_counts();
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM = 'ADMIN_ONLY';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_counts := public.admin_user_counts();

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_denied THEN
    RAISE EXCEPTION 'a non-admin was not refused with ADMIN_ONLY';
  END IF;
  IF (v_counts->>'total')::bigint IS DISTINCT FROM v_total
     OR (v_counts->>'accounts')::bigint + (v_counts->>'guests')::bigint IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'counts do not add up: % against % users', v_counts - 'daily', v_total;
  END IF;
  IF (v_counts->>'platform_ios')::bigint + (v_counts->>'platform_android')::bigint + (v_counts->>'platform_unknown')::bigint
     IS DISTINCT FROM (v_counts->>'accounts')::bigint OR (v_counts->>'platform_unknown')::bigint < 0 THEN
    RAISE EXCEPTION 'platform buckets do not add up to accounts: %', v_counts - 'daily';
  END IF;
  IF jsonb_array_length(v_counts->'daily') IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'daily must carry 30 days, got %', jsonb_array_length(v_counts->'daily');
  END IF;
  RAISE NOTICE 'admin_user_counts: non-admin refused, admin totals add up over % users', v_total;
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
VALUES ('20261161_admin_user_counts.sql', 'd8da6f8bd352526c45d48be7478f853f8f5a7025f170d61be2313a6ad08900e9')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
