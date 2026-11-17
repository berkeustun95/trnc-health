-- ═══════════════════════════════════════════════════════════════════════════
-- 20261199 — one phone token, one profiles row (non-provider groups only)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT: where the same Expo push token sits on 2+ public.profiles rows, keep it on ONE row and set
-- push_token to NULL on the others. Nothing else on any row changes.
-- WHY: a phone whose token sits on two accounts (one phone, two sign-ins over time) is pushed once per
-- row by every sender that loops over profiles rows (notify_module_waitlist, notify_admins and the other
-- per-row SQL notifiers), so it gets those twice, plus pushes meant only for the other account. Since
-- #405 the duty push and the weekend digest send one message per token at send time; this cleans the
-- data for the rest. Reported on 2026-11-13/14.
-- WHICH GROUPS: a group is the set of rows sharing one non-null token, built from public.profiles alone
-- (auth.users is joined only to rank, so a missing auth row can never shrink a group). A group is cleaned
-- only when EVERY member's role is customer or admin; a group with any provider, other or missing role is
-- left exactly as it is (Berke's standing rule: provider accounts are out of scope).
-- WHICH ROW KEEPS IT: the newest auth.users.last_sign_in_at (unknown last), then the highest id.
-- supabase/probe_push_token_cleanup_dry.sql carries the same predicate slice (the test compares them)
-- and was run before this file to show exactly which rows this keeps.
-- SELF-HEALING: a cleared token comes back by itself for the account in use. On every launch with a
-- signed-in, non-guest session, App.js registerPushToken() calls utils/signOut.js savePushToken(), which
-- writes the phone's token onto that account's row. If the account in use on that phone is not the kept
-- one, the pair forms again on its next launch; preventing that is a separate decision.
-- NOT HERE: no trigger, unique index or other recurrence guard. No verify_schema token: this file creates
-- no object, and a data-state token would go red again whenever a new pair forms.
-- WHY NO IDS OR NUMBERS: supabase-migrate prints this file to public Actions logs. Rows are chosen by
-- predicate only and every message below is count-free; the dry-run result is in Berke's vault.
-- LOCK: profiles is locked against writes (reads continue) for the length of this transaction, so a
-- phone writing its token mid-apply cannot move the before/after checks. Waits at most 5 s, then fails
-- with nothing changed.
-- TRIGGERS: the four BEFORE UPDATE triggers on profiles (check_profile_name_content, guard_profile_ban,
-- guard_checkin_notice_columns, guard_marketplace_notice_columns) neither raise nor rewrite any column on a
-- push_token-only change run as postgres with no auth.uid(). The one way they could raise is a row holding
-- an under-13 date of birth, which the dry run reports; that would roll the whole file back.
-- Re-runnable: with no eligible group left it changes nothing and passes.
--
-- Apply: supabase-migrate. Not reversible (the cleared tokens are not kept anywhere).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_clear_ids      uuid[];
  v_elig_tokens    text[];
  v_excl_tokens    text[];
  v_excl_ids       uuid[];
  v_excl_before    text;
  v_excl_after     text;
  v_rows_before    text;
  v_rows_after     text;
  v_distinct_before bigint;
  v_distinct_after  bigint;
  v_any_before     boolean;
  v_cleared        int;
BEGIN
  WITH
-- predicate:begin (byte-identical in the dedupe migration; the test compares the two slices)
grp AS (
  SELECT p.push_token,
         coalesce(bool_and(coalesce(p.role IN ('customer', 'admin'), false)), false) AS eligible
    FROM public.profiles p
   WHERE p.push_token IS NOT NULL
   GROUP BY p.push_token
  HAVING count(*) > 1),
ranked AS (
  SELECT p.id, p.push_token, g.eligible,
         row_number() OVER (PARTITION BY p.push_token
                            ORDER BY u.last_sign_in_at DESC NULLS LAST, p.id DESC) AS rn
    FROM public.profiles p
    JOIN grp g ON g.push_token = p.push_token
    LEFT JOIN auth.users u ON u.id = p.id)
-- predicate:end
  SELECT coalesce(array_agg(r.id) FILTER (WHERE r.eligible AND r.rn > 1), '{}'),
         coalesce(array_agg(DISTINCT r.push_token) FILTER (WHERE r.eligible), '{}'),
         coalesce(array_agg(DISTINCT r.push_token) FILTER (WHERE NOT r.eligible), '{}'),
         coalesce(array_agg(r.id) FILTER (WHERE NOT r.eligible), '{}')
    INTO v_clear_ids, v_elig_tokens, v_excl_tokens, v_excl_ids
    FROM ranked r;

  -- Snapshots, compared after the change. Variables only; nothing is printed.
  SELECT md5(coalesce(string_agg(p.id::text || ':' || coalesce(p.push_token, '<null>'), ',' ORDER BY p.id), ''))
    INTO v_excl_before FROM public.profiles p WHERE p.id = ANY (v_excl_ids);
  -- Every row as it must look afterwards: cleared rows minus push_token, every other row whole.
  SELECT md5(coalesce(string_agg(CASE WHEN p.id = ANY (v_clear_ids) THEN to_jsonb(p) - 'push_token'
                                      ELSE to_jsonb(p) END::text, ',' ORDER BY p.id), ''))
    INTO v_rows_before FROM public.profiles p;
  SELECT count(DISTINCT push_token), bool_or(push_token IS NOT NULL)
    INTO v_distinct_before, v_any_before FROM public.profiles;

  UPDATE public.profiles
     SET push_token = NULL
   WHERE id = ANY (v_clear_ids)
     AND push_token = ANY (v_elig_tokens);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  IF v_cleared IS DISTINCT FROM coalesce(array_length(v_clear_ids, 1), 0) THEN
    RAISE EXCEPTION 'the update did not clear exactly the rows planned. Rolling back.';
  END IF;

  SELECT md5(coalesce(string_agg(p.id::text || ':' || coalesce(p.push_token, '<null>'), ',' ORDER BY p.id), ''))
    INTO v_excl_after FROM public.profiles p WHERE p.id = ANY (v_excl_ids);
  IF v_excl_after IS DISTINCT FROM v_excl_before THEN
    RAISE EXCEPTION 'a group with a non-customer/admin member changed. Rolling back.';
  END IF;

  SELECT md5(coalesce(string_agg(CASE WHEN p.id = ANY (v_clear_ids) THEN to_jsonb(p) - 'push_token'
                                      ELSE to_jsonb(p) END::text, ',' ORDER BY p.id), ''))
    INTO v_rows_after FROM public.profiles p;
  IF v_rows_after IS DISTINCT FROM v_rows_before THEN
    RAISE EXCEPTION 'something other than the planned push_token values changed on profiles. Rolling back.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = ANY (v_clear_ids) AND push_token IS NOT NULL) THEN
    RAISE EXCEPTION 'a planned row still holds a token. Rolling back.';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_elig_tokens) AS t(tok)
              WHERE (SELECT count(*) FROM public.profiles p WHERE p.push_token = t.tok) IS DISTINCT FROM 1) THEN
    RAISE EXCEPTION 'a cleaned token is not on exactly one row afterwards (left shared, or cleared everywhere). Rolling back.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.push_token IS NOT NULL
              GROUP BY p.push_token
             HAVING count(*) > 1
                AND (coalesce(bool_and(coalesce(p.role IN ('customer', 'admin'), false)), false)
                     OR NOT (p.push_token = ANY (v_excl_tokens)))) THEN
    RAISE EXCEPTION 'a shared token remains that is not one of the left-as-is groups. Rolling back.';
  END IF;

  SELECT count(DISTINCT push_token) INTO v_distinct_after FROM public.profiles;
  IF v_distinct_after IS DISTINCT FROM v_distinct_before THEN
    RAISE EXCEPTION 'a phone token disappeared from profiles entirely. Rolling back.';
  END IF;

  IF coalesce(v_any_before, false)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE push_token IS NOT NULL) THEN
    RAISE EXCEPTION 'positive control: tokens existed before and none are visible after. Rolling back.';
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
VALUES ('20261199_push_token_dedupe.sql', '71626c575c579c3da1ea2ef7c6e5d832cb4f987d69f14f7848851cc3f0d16899')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
