-- ═══ place_claims — nature and heritage places cannot be claimed ════════════
--
-- Nobody owns Salamis, and nobody owns a public beach. The claim CTA was rendering on
-- 100% of places and was wrong on 100% of them, because the only categories with rows
-- are exactly the ones with no owner.
--
-- ─── THIS MIRRORS A GUARD THAT ALREADY EXISTS ───────────────────────────────
--
-- claim_requests_guard_insert() (20260911) already refuses public-sector FACILITY claims,
-- with the reasoning this migration reuses verbatim in shape:
--
--   "A state facility has no owner to verify and nothing to sell. There is no evidence
--    a private party could produce that would make claiming a public hospital correct,
--    so this is a flat refusal rather than an extra review step."
--
-- Places had no equivalent. This brings them to parity: same position in the function
-- (after the already-claimed check, before the duplicate-pending check), same
-- single-lookup shape, same flat-refusal message style.
--
-- ─── WHY A DATABASE GUARD AND NOT JUST THE HIDDEN BUTTON ────────────────────
--
-- Slice 1 hides the CTA. That fixes what a user sees and nothing else: place_claims'
-- RLS still permits any authenticated non-anonymous user to INSERT a claim on ANY place
-- id. Hiding a button hides the path without closing it. If such a claim were ever
-- approved, approve_place_claim() sets places.provider_id — and someone owns a public
-- beach, with owner-level edit rights and featured eligibility on it.
--
-- The screen is the affordance. This is the boundary.
--
-- ─── ⚠ THE CATEGORY LIST IS DUPLICATED IN JS, DELIBERATELY AND DANGEROUSLY ──
--
-- NON_CLAIMABLE_CATEGORIES in constants/exploreCategories.js carries this same list.
-- Two copies, one in each language, exactly as resubmit_place() (20260829) duplicates
-- SUBMITTABLE_CATEGORIES — and for the same reason: a trigger cannot import from JS.
--
-- KEEP THEM IN SYNC. The failure mode is asymmetric and worth naming:
--   * a category blocked in SQL but not JS  → the button shows and the insert 500s.
--     Ugly, visible, reported within a day.
--   * a category blocked in JS but not SQL  → the button is hidden and the path is OPEN.
--     Silent. Nothing surfaces it until something files a claim another way.
-- The second is the one to fear, which is why this is the DB side and not only the JS.
--
-- ─── WHAT IS NOT CHANGED ────────────────────────────────────────────────────
--
-- The already-claimed and duplicate-pending checks are byte-identical to 20260826.
-- approve_place_claim() is untouched — admin approval stays the human gate, and is where
-- an edge case like a municipal pool is caught. No row data changes: zero places carry a
-- provider_id today, so there is nothing to migrate or grandfather.
--
-- Apply by hand: SQL editor, Role = postgres. Run the PRE-FLIGHT first (it is read-only
-- and outside this file's transaction). Then `node scripts/migration-ledger.mjs` and
-- re-run supabase/migration_ledger_check.sql.

SET ROLE postgres;
BEGIN;

CREATE OR REPLACE FUNCTION public.place_claims_guard_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  is_admin_user   boolean;
  target_owner    uuid;
  target_category text;
  dup_exists      boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                 -- service/seed
  SELECT exists(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') INTO is_admin_user;
  IF is_admin_user THEN RETURN NEW; END IF;

  -- One lookup, both facts. (20260826 read provider_id alone; category joins it here
  -- rather than adding a second round trip.)
  SELECT provider_id, category INTO target_owner, target_category
    FROM places WHERE id = NEW.place_id;

  -- Place must be UNCLAIMED. Single-purpose: reads places.provider_id directly, no XOR
  -- against facilities (the whole reason this is a parallel table).
  IF target_owner IS NOT NULL THEN
    RAISE EXCEPTION 'place_claims: place already claimed';
  END IF;

  -- A beach, a ruin or a monument has no owner to verify and nothing to sell. There is no
  -- evidence a private party could produce that would make claiming Salamis correct, so
  -- this is a flat refusal rather than an extra review step.
  --
  -- museum and religious_site are included deliberately and REVERSIBLY: most TRNC museums
  -- are state-run and a mosque has no commercial owner, but a private collection or a
  -- mosque foundation may later want listing control. Moving one out is an edit here plus
  -- constants/exploreCategories.js — not a schema change.
  --
  -- sports_facility and pool are deliberately ABSENT. A municipal pool is claimable by
  -- this rule and is caught at admin approval instead; category is a proxy for "has an
  -- owner with something to sell", and the proxy is imperfect at exactly that edge.
  IF target_category = ANY (ARRAY['beach'::text, 'nature_scenic'::text,
                                  'castle_fortress'::text, 'ancient_ruins'::text,
                                  'museum'::text, 'religious_site'::text,
                                  'monument'::text]) THEN
    RAISE EXCEPTION 'place_claims: nature and heritage places cannot be claimed';
  END IF;

  -- No second pending claim by the same requester on the same place.
  SELECT exists(
    SELECT 1 FROM place_claims
     WHERE place_id = NEW.place_id AND requester_id = NEW.requester_id AND status = 'pending'
  ) INTO dup_exists;
  IF dup_exists THEN
    RAISE EXCEPTION 'place_claims: duplicate pending claim';
  END IF;

  RETURN NEW;
END $function$;

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
VALUES ('20260921_place_claims_category_guard.sql', '3d6e024d02c54243dc5d880a8e5b7c3efcbab31c33efd4b1b879237aecad0657')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN, so no PostgREST schema-cache reload is required: the cache holds
-- table/column shape, and a CREATE OR REPLACE of a function body changes neither.
-- The trigger from 20260826 is unchanged and still bound to this function.

-- ─── Verification (Role = postgres) ─────────────────────────────────────────
--   -- 1. the branch is in the deployed body:
--   SELECT pg_get_functiondef(oid) ILIKE '%nature and heritage places cannot be claimed%'
--     AS has_category_branch
--     FROM pg_proc WHERE proname = 'place_claims_guard_insert';   -- expect true
--
--   -- 2. the trigger still points at it:
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.place_claims'::regclass AND NOT tgisinternal;
--   -- expect place_claims_guard_insert, enabled ('O')
--
--   -- 3. WATCH IT REFUSE. A guard nobody has seen reject something is a decoration.
--   --    Run as a NON-ADMIN signed-in user (as postgres, auth.uid() is NULL and the
--   --    function returns early — it would pass and prove nothing).
--   BEGIN;
--     INSERT INTO public.place_claims (place_id, requester_id)
--     SELECT id, auth.uid() FROM public.places WHERE category = 'ancient_ruins' LIMIT 1;
--   -- expect: place_claims: nature and heritage places cannot be claimed
--   ROLLBACK;
--
--   -- 4. and that a commercial category is still permitted (currently zero such rows,
--   --    so this asserts the branch is not over-broad rather than exercising it):
--   SELECT count(*) FROM public.places
--    WHERE category = ANY (ARRAY['cafe','restaurant','bakery','gym','sports_facility',
--                                'pool','barber','print_shop','laundry']);
--   -- expect 0 today. When it is not 0, a claim on one of those must still succeed.

-- ─── Rollback ───────────────────────────────────────────────────────────────
-- Re-apply supabase/migrations/20260826_place_claims.sql section 3 verbatim; it is the
-- previous definition of this function. Also remove NON_CLAIMABLE_CATEGORIES from the
-- showClaim condition in ExploreProfileScreen, or the button stays hidden while the path
-- is open — the asymmetric failure named above, deliberately re-created.
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260921_place_claims_category_guard.sql';
