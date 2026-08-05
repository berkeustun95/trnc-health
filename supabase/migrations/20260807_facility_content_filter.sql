-- ─── Write-time content filter on facilities.name + description ──────────────
-- Blocks profanity (reuses contains_blocked_term) AND payment/anti-steering
-- content (IBAN + bank/account/transfer phrases, TR+EN) BEFORE the row is saved,
-- on INSERT and UPDATE, across EVERY facility type in this table (garage,
-- grooming, health). Closes the instant-live UGC gap that opened when garages
-- went public: an approved owner adding an IBAN / "pay me by transfer" to their
-- description used to go live instantly (Apple 3.1.1 anti-steering risk).
--
-- BYPASS-PROOF: one table trigger covers every write path — create_garage_facility,
-- update_garage_facility, create_grooming_facility, update_grooming_facility, and
-- any direct .update(). It deliberately IGNORES app.trusted_facility_write (that
-- GUC only tells the lifecycle guard to allow status flips; content is ALWAYS
-- checked). No admin exemption — matches the profanity precedent in
-- check_ugc_on_insert (an admin shouldn't publish an IBAN either).
--
-- CONSERVATIVE by design: false positives that block a legit owner are worse than
-- the occasional miss (reactive report + auto-hide catches misses). Bare
-- ambiguous words (deposit, kapora, dekont, generic phone numbers) are NOT
-- filtered — only multi-word solicitation phrases + format-specific IBAN.
--
-- ADDITIVE + IDEMPOTENT (safe to re-run). Does NOT touch review/question/answer
-- filtering. Apply this in Supabase (SQL-editor Role dropdown = postgres) BEFORE
-- publishing the OTA. No native build required.

BEGIN;

-- ─── Payment / anti-steering detector ────────────────────────────────────────
-- No table access → plain IMMUTABLE (not SECURITY DEFINER). Conservative:
-- multi-word phrases + format-specific IBAN, no bare ambiguous words.
CREATE OR REPLACE FUNCTION public.contains_payment_solicitation(p_text text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_norm    text;
  v_compact text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN false;
  END IF;

  -- Space-delimited, lowercase, Turkish letters preserved; padded for token match.
  v_norm    := ' ' || regexp_replace(lower(p_text), '[^a-z0-9çğıöşü]+', ' ', 'g') || ' ';
  -- Separator-stripped, so an IBAN written with spaces/dots still matches.
  v_compact := regexp_replace(lower(p_text), '[^a-z0-9]', '', 'g');

  IF v_compact ~ 'tr[0-9]{24}' THEN            -- Turkish IBAN format
    RETURN true;
  END IF;

  RETURN v_norm ~ ANY (ARRAY[
    -- single-token payment terms (not ordinary EN/TR words)
    ' iban ', ' havale ', ' eft ', ' swift ', ' paypal ', ' papara ',
    -- EN phrases
    ' bank transfer ', ' wire transfer ', ' bank account ', ' account number ',
    ' routing number ', ' swift code ', ' western union ', ' moneygram ',
    ' credit card number ', ' send (the )?money to ',
    ' pay me (by|via|through|with|to) ', ' pay (by|via) (bank|transfer|iban) ',
    -- TR phrases
    ' banka hesab', ' hesap numara', ' hesab[iı]ma ', ' para gönder', ' para yat[iı]r'
  ]);
END;
$$;

-- ─── Trigger: block bad name/description at write time ────────────────────────
CREATE OR REPLACE FUNCTION public.check_facility_content()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_text text;
BEGIN
  -- Only re-check when a filtered field actually changes. Grandfathers legacy
  -- rows and means a city/lat/lng/photos update never re-runs the filter.
  IF TG_OP = 'UPDATE'
     AND NEW.name        IS NOT DISTINCT FROM OLD.name
     AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;
  END IF;

  v_text := coalesce(NEW.name, '') || '  ' || coalesce(NEW.description, '');

  IF contains_blocked_term(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;
  IF contains_payment_solicitation(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_PAYMENT';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_facility_content ON public.facilities;
CREATE TRIGGER check_facility_content
  BEFORE INSERT OR UPDATE ON public.facilities
  FOR EACH ROW EXECUTE FUNCTION public.check_facility_content();

COMMIT;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   SELECT contains_payment_solicitation('Reach me at TR12 3456 7890 1234 5678 9012 34'); -- t
--   SELECT contains_payment_solicitation('havale ile ödeme yapabilirsiniz');              -- t
--   SELECT contains_payment_solicitation('pay me by bank transfer');                      -- t
--   SELECT contains_payment_solicitation('We service all car makes, oil change & tyres'); -- f
--   SELECT contains_payment_solicitation('Randevu için arayın, kapora alınır');           -- f (bare kapora not filtered)
--   -- End to end (as the owner): should FAIL with BLOCKED_PAYMENT
--   SELECT update_garage_facility('<id>','Same Name', ARRAY['repair'], '<same addr>',
--                                 null, null, 'Pay me: TR33 0006 1005 1978 6457 8413 26');

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP TRIGGER IF EXISTS check_facility_content ON public.facilities;
--   DROP FUNCTION IF EXISTS public.check_facility_content();
--   DROP FUNCTION IF EXISTS public.contains_payment_solicitation(text);
--   COMMIT;
