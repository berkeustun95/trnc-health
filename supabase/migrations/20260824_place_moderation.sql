-- ─── Slice 3 (piece 2) — moderation + content filter + tile-count RPC for places ─
-- Extends the EXISTING UGC-moderation machinery to the `places` directory (mirrors
-- 20260803_facility_report_moderation exactly — same section order, same reused
-- content_reports table / guard fn / auto_hide fn). Adds the write-time content
-- filter (jsonb-aware) and a SECURITY DEFINER tile-count RPC.
--
-- WHY THE RPC: ExploreScreen threshold-gates group tiles CLIENT-SIDE over the fetched
-- ACTIVE set. Once the RESTRICTIVE hide policy below drops auto-hidden rows from the
-- client's fetch, a client-side count would UNDERCOUNT — three reporters could push a
-- group below 8 and vanish its tile for everyone. explore_category_counts() counts
-- active rows REGARDLESS of hidden_at (definer bypasses the hide policy; returns
-- aggregate counts only, no rows), so a temporarily-hidden place still counts toward
-- its group's tile. ACCEPTED LEAK: per-category aggregate counts of active-incl-hidden
-- rows are exposed to anon — the accepted cost of tiles that don't flicker on a report.
--
-- SET ROLE postgres: ALTER TABLE places + CREATE TRIGGER/POLICY on places need the
-- table owner (editor default 'authenticated' → 42501). One transaction so a partial
-- apply can't leave the CHECK widened but the auto_hide/guard/columns missing (a state
-- that would let a place report insert then silently no-op). NOTIFY pgrst at the tail:
-- the ADD COLUMN and the new RPC both need PostgREST's cache refreshed.

SET ROLE postgres;
BEGIN;

-- 1. Widen the report CHECK to admit 'place' (reuses the whole content_reports machinery).
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('review', 'question', 'answer', 'facility', 'place'));

-- 2. Moderation columns on places (mirror facilities exactly). Deferred here from Slice 1.
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS hidden_at     timestamptz;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS hidden_reason text;

-- 3. Guard: hidden_at/hidden_reason admin-only, EXCEPT the visible→auto-hidden transition
--    at 3+ distinct reporters. Binds the EXISTING generic guard_moderation_columns fn
--    (TG_ARGV[0]='place' drives its content_reports lookup) — no new function.
DROP TRIGGER IF EXISTS guard_place_moderation ON public.places;
CREATE TRIGGER guard_place_moderation
  BEFORE UPDATE ON public.places
  FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('place');

-- 4. Auto-hide at 3 distinct reporters — add a 'place' branch. review/question/answer/
--    facility branches are byte-for-byte from 20260803 §4.
CREATE OR REPLACE FUNCTION auto_hide_reported_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM content_reports
  WHERE content_type = NEW.content_type AND content_id = NEW.content_id;

  IF v_count < 3 THEN RETURN NEW; END IF;

  IF NEW.content_type = 'review' THEN
    UPDATE reviews    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'question' THEN
    UPDATE questions  SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'answer' THEN
    UPDATE answers    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'facility' THEN
    UPDATE facilities SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'place' THEN
    UPDATE places     SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
-- The auto_hide_on_report trigger on content_reports is already bound; C-O-R keeps it.

-- 5. SELECT visibility — SEPARATE RESTRICTIVE policy (mirrors facilities_hide_reported).
--    The existing permissive read policies are UNTOUCHED; this only ANDs hidden_at IS NULL
--    onto public reads. Submitter/owner still see their own hidden row; admin sees all.
DROP POLICY IF EXISTS "places_hide_reported" ON public.places;
CREATE POLICY "places_hide_reported" ON public.places
  AS RESTRICTIVE FOR SELECT
  USING (
    hidden_at IS NULL
    OR submitted_by = auth.uid()
    OR provider_id  = auth.uid()
    OR is_admin()
  );

-- 6. Write-time content filter — jsonb-aware. Blocks profanity + payment/anti-steering
--    on INSERT/UPDATE. Divergence from facilities' filter: name is plain text but
--    name_i18n/description_i18n are jsonb, so flatten the VALUES (not keys) first. NO
--    admin exemption — an admin editing name/description into a blocked term or IBAN is
--    rejected too (matches check_facility_content). Re-checks only when a filtered field
--    changes (grandfathers the Slice-1 backfill).
CREATE OR REPLACE FUNCTION public.check_place_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_text text;
  v_tmp  text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.name             IS NOT DISTINCT FROM OLD.name
     AND NEW.name_i18n        IS NOT DISTINCT FROM OLD.name_i18n
     AND NEW.description_i18n IS NOT DISTINCT FROM OLD.description_i18n THEN
    RETURN NEW;
  END IF;

  v_text := coalesce(NEW.name, '');
  IF jsonb_typeof(NEW.name_i18n) = 'object' THEN
    SELECT string_agg(value, '  ') INTO v_tmp FROM jsonb_each_text(NEW.name_i18n);
    v_text := v_text || '  ' || coalesce(v_tmp, '');
  END IF;
  IF jsonb_typeof(NEW.description_i18n) = 'object' THEN
    SELECT string_agg(value, '  ') INTO v_tmp FROM jsonb_each_text(NEW.description_i18n);
    v_text := v_text || '  ' || coalesce(v_tmp, '');
  END IF;

  IF contains_blocked_term(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;
  IF contains_payment_solicitation(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_PAYMENT';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_place_content ON public.places;
CREATE TRIGGER check_place_content
  BEFORE INSERT OR UPDATE ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.check_place_content();

-- 7. Tile-count RPC — see WHY THE RPC above. WHERE mirrors the browse predicate EXACTLY
--    (status='active', nothing else); counts include hidden rows (definer bypasses the
--    RESTRICTIVE policy). Aggregate counts only. Client aggregates category→group in JS.
CREATE OR REPLACE FUNCTION public.explore_category_counts()
RETURNS TABLE(category text, n bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT category, count(*) FROM places WHERE status = 'active' GROUP BY category;
$$;

REVOKE ALL     ON FUNCTION public.explore_category_counts() FROM public;
GRANT  EXECUTE ON FUNCTION public.explore_category_counts() TO authenticated, anon;

COMMIT;
RESET ROLE;

-- ADD COLUMN + new RPC → refresh PostgREST's cache (else 42703 on hidden_* / PGRST202 on the RPC).
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   -- CHECK admits place:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='content_reports_content_type_check'; -- has 'place'
--   -- columns + policy:
--   SELECT count(*) FILTER (WHERE hidden_at IS NULL) AS visible, count(*) FROM places;   -- visible == total today
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='places';    -- 8 (7 + places_hide_reported)
--   -- RPC (counts include hidden; matches browse status filter):
--   SELECT * FROM explore_category_counts();     -- {category, n} for every active category
--   -- content filter (as owner, should FAIL): update a place's description to an IBAN.
--   -- auto-hide: 3 distinct reporters on a place → it flips hidden_at (guard permits that one path).
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.explore_category_counts();
--   DROP TRIGGER  IF EXISTS check_place_content ON public.places;
--   DROP FUNCTION IF EXISTS public.check_place_content();
--   DROP POLICY   IF EXISTS "places_hide_reported" ON public.places;
--   DROP TRIGGER  IF EXISTS guard_place_moderation ON public.places;
--   ALTER TABLE public.places DROP COLUMN IF EXISTS hidden_reason, DROP COLUMN IF EXISTS hidden_at;
--   ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
--   ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
--     CHECK (content_type IN ('review','question','answer','facility'));
--   -- then restore auto_hide_reported_content() body without the place branch (20260803 §4);
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
