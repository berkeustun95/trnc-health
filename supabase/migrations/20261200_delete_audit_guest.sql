-- ═══════════════════════════════════════════════════════════════════════════
-- 20261200 — delete the one guest the 2026-11-14 UX audit created on the test phone
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The audit wiped ADA Preview on the test phone and tapped "Misafir olarak devam et" at about 14:46 UTC,
-- which created a guest in production (Preview shares the production database). QA then signed in on top
-- of it. Berke (2026-11-14): delete that guest, nothing else.
--
-- WHAT IT DELETES: the guest matching this signature: anonymous, no email, created 14:45:30–14:48:30 UTC on
-- 2026-11-14, a customer profile, no push token. Read-only probe run 43612514010 (sealed, vault) found
-- exactly one, and the app never deletes guests itself, so it is the audit's. The file refuses unless
-- exactly one row matches, so a different set deletes nothing.
-- WHY NO ID HERE: the workflow prints this file to Actions logs, which are public. Messages carry no counts.
-- Signed-up accounts cannot be reached: the match and the DELETE require is_anonymous, and the file asserts
-- the signed-up count is unchanged.
-- Cascades: the guest's profiles row and anything hanging off it (as in 20261162).
--
-- Apply: supabase-migrate. Irreversible.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_ids      uuid[];
  v_deleted  int;
  v_accounts bigint;
  v_guests   bigint;
BEGIN
  SELECT array_agg(u.id)
    INTO v_ids
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
   WHERE u.is_anonymous AND u.email IS NULL AND u.deleted_at IS NULL
     AND u.created_at >= '2026-11-14 14:45:30+00' AND u.created_at < '2026-11-14 14:48:30+00'
     AND p.role = 'customer' AND p.push_token IS NULL;

  IF coalesce(array_length(v_ids, 1), 0) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'the guests matching the signature are not exactly the one the probe found. Nothing deleted.';
  END IF;

  SELECT count(*) FILTER (WHERE NOT is_anonymous), count(*) FILTER (WHERE is_anonymous)
    INTO v_accounts, v_guests FROM auth.users;

  DELETE FROM auth.users WHERE id = ANY(v_ids) AND is_anonymous;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'the delete did not remove exactly the one guest. Rolling back.';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE NOT is_anonymous) IS DISTINCT FROM v_accounts THEN
    RAISE EXCEPTION 'the signed-up count changed. Rolling back.';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE is_anonymous) IS DISTINCT FROM v_guests - 1 THEN
    RAISE EXCEPTION 'the guest count did not fall by exactly one. Rolling back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.notifications WHERE user_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'dependent rows survived the delete. Rolling back.';
  END IF;
END $$;

COMMIT;

RESET ROLE;
