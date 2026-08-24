-- ─── Public health — contact hygiene: addresses corrected, one phone REMOVED ──
--
-- DATA ONLY. No schema, no functions, no policies. Every statement writes rows that are
-- LIVE TO USERS, so read the reasoning before pasting.
--
-- This exists because BLOCK W6 of verify_search_tokenised.sql FAILED, and the failure was
-- the point: all seven state hospitals already carried `phone` and `address`, hand-entered
-- through AdminScreen, which the previous migration had assumed were empty. The root cause
-- is recorded in the module note §18 and generalised into architecture.md — the pre-flight
-- selected the columns it already had questions about, so it confirmed its assumptions
-- instead of testing them.
--
-- ─── ⚠⚠ THE PHONE REMOVAL — WHY REMOVING BEATS KEEPING ──────────────────────
--
-- Dr. Burhan Nalbantoğlu and Acil Durum Hastanesi BOTH publish (0392) 223 24 41.
-- They are two different hospitals. AT LEAST ONE OF THOSE ROWS IS TELLING USERS TO CALL
-- THE WRONG HOSPITAL, and nothing in the data says which.
--
-- Acil Durum's number is the one removed, on ONE strong reason and one supporting one:
--   • STRONG: its OWN first-party source contradicts the stored value. adh.gov.ct.tr —
--     a government domain, valid certificate, the hospital's own site — publishes
--     (0392) 612 0500, fax 612 0599, info.adh@gov.ct.tr. The best available source for a
--     hospital's number disagrees with what we are showing.
--   • SUPPORTING: it is the emergency hospital, so a misdirected enquiry costs most there.
--
-- ⚠ AND ONE REASON DELIBERATELY NOT RELIED ON. "223 is a corroborated Lefkoşa block, so
-- BNDH is the likelier owner" DOES NOT DISCRIMINATE: both hospitals are in Lefkoşa, so a
-- Lefkoşa prefix is exactly as consistent with one as the other. It is evidence that the
-- number is real, not evidence of whose it is. Recorded because a reason that feels
-- supportive and is actually neutral is how a coin-flip gets dressed up as a deduction.
--
-- ⚠ SCOPE, HONESTLY: this is a DIRECTORY ENQUIRY number, not the emergency path. ADA has a
-- dedicated Emergency Numbers screen carrying 112 / 155 / 199 / 158, one tap from Home.
-- Nobody in a life-threatening emergency should be dialling a hospital switchboard, and
-- the app does not send them there. So the cost of a wrong number here is a person ringing
-- to ask about a department, an appointment or whether a service exists, and being told
-- about the WRONG HOSPITAL — a serious quality defect worth fixing today, but not a
-- life-safety one. Overstating it would make the next judgement call harder, not easier.
--
-- ⚠ RESIDUAL RISK, STATED PLAINLY: if 223 24 41 turns out to be ACİL DURUM's real number
-- and BNDH's is the wrong one, this migration will have removed the correct number and
-- left the incorrect one standing. That is why THE FIRST CALL IS 223 24 41 ITSELF, asking
-- which hospital answers — one call resolves the whole thing and says whether BNDH needs
-- the same treatment. The call-list order in module note §19 is built around that.
--
-- ⚠ GAZİMAĞUSA IS **NOT** TREATED THE SAME WAY, ON PURPOSE. Its (0392) 630 89 00 matches
-- no Famagusta prefix in our pharmacy corpus (which uses 365 / 366 / 378) — but that is
-- WEAK evidence: the corpus samples pharmacies, and a hospital may hold its own block.
-- The distinction that matters:
--     COLLISION  = a CERTAIN defect (two rows, one number, one must be wrong) → remove now
--     ODD PREFIX = merely UNVERIFIED                                          → dial first
-- Removing a possibly-correct number on weak evidence is its own harm. Dial it; remove
-- only if it fails or answers as something else.
--
-- ─── THE ADDRESSES ──────────────────────────────────────────────────────────
-- Five of the seven "addresses" were bare city names — `Lefkoşa`, `Gazimağusa`, `Girne`,
-- `Lefke`. That is not an address. It duplicates `city` (now populated properly by 0912)
-- and tells a user nothing they cannot already see. A column that lies about what it
-- contains is worse than an empty one, so each is either FILLED FROM A SOURCE or NULLED.
--
-- SEARCH IMPACT VERIFIED BEFORE WRITING, not assumed. Those bare city names were load-
-- bearing: `Lefkoşa` in BNDH's address is the only reason "Lefkoşa Devlet Hastanesi"
-- matched at all. Simulated against the real 387-row corpus, every hospital query returns
-- the SAME hospital first before and after, and two new ones start working:
-- "Barış Cd" now finds Acil Durum, and "Fazıl Küçük" now includes Akçiçek.
--
-- EXECUTION: Role = postgres. facilities_guard_update early-returns when auth.uid() IS
-- NULL, and `address`/`phone` are not on its deny-list for non-garage rows anyway.
-- No moderation column is touched, so guard_moderation_columns never fires.

SET ROLE postgres;

BEGIN;

-- ─── 1. Addresses — fill from a source, or NULL ─────────────────────────────
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- FILLED. First-party: the hospital's own site gives the full postal address.
      ('56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 'Acil Durum',
       'Barış Cd 8, 99010 Lefkoşa'),
      -- FILLED. Corroborated TWICE: the ministry places it in Lefkoşa, and our own
      -- pharmacy seed carries "Devlet Hastanesi Karşısı, Ortaköy, Lefkoşa" (YAZMAN
      -- ECZANESİ) — a completely independent dataset pointing at the same neighbourhood.
      ('e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 'BNDH',
       'Ortaköy, Lefkoşa'),
      -- FILLED, single source. The ministry's own page places Barış in Ortaköy,
      -- "yanında" BNDH. One citation, not two — weaker than the row above, and still far
      -- better than the bare city name it replaces.
      ('3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 'Barış Ruh ve Sinir',
       'Ortaköy, Lefkoşa'),
      -- FILLED BY HARVEST. This street address currently lives ONLY on the Girne
      -- DUPLICATE row (91338177), which is draft and scheduled for retirement. It is the
      -- single real street address in the whole set. Copying it to the canonical row NOW
      -- rather than at merge time is the whole point: the merge slice has no date, and
      -- this is exactly the kind of thing a merge destroys silently.
      ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'Girne Dr. Akçiçek',
       'Dr. Fazıl Küçük Blv., Girne'),
      -- NULLED. No address source exists for either. `city` carries the region; an
      -- address column repeating it is noise pretending to be data.
      ('ed83578f-1866-4e54-9253-705feb093c22'::uuid, 'Gazimağusa Devlet', NULL),
      ('32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 'Lefke Cengiz Topel', NULL)
      -- NOT LISTED: the Girne DUPLICATE keeps its address. It is a real one, the row is
      -- hidden from users anyway, and it is the provenance for the harvest above.
    ) AS t(fid, label, addr)
  LOOP
    SELECT count(*) INTO n FROM public.facilities WHERE id = r.fid;
    IF n <> 1 THEN
      RAISE EXCEPTION 'contact hygiene: expected exactly 1 facility with id % (%), found %', r.fid, r.label, n;
    END IF;
    -- Straight assignment, NOT coalesce. Coalesce is what silently skipped this write last
    -- time: these columns are OCCUPIED, and overwriting them is the entire intent.
    UPDATE public.facilities SET address = r.addr WHERE id = r.fid;
  END LOOP;

  -- No bare city name may survive on a public row.
  SELECT count(*) INTO n FROM public.facilities
   WHERE sector = 'public'
     AND address IN ('Lefkoşa','Gazimağusa','Girne','Lefke','Güzelyurt','İskele');
  IF n > 0 THEN
    RAISE EXCEPTION 'contact hygiene: % public row(s) still carry a bare city name as address', n;
  END IF;
END $$;

-- ─── 2. Acil Durum's phone — REMOVED pending the dial ───────────────────────
-- Not blanked out of tidiness. It is one half of a collision in which one of two live
-- hospital listings is wrong, and this is the half whose own first-party source
-- contradicts it. A user who sees no number looks further; a user who sees a confident
-- wrong number calls it.
UPDATE public.facilities
   SET phone = NULL
 WHERE id = '56614fa9-d7ba-4528-9fe4-f372e9f9286a';

-- ─── 3. Report the state this leaves behind ─────────────────────────────────
-- Deliberately a NOTICE and not an assertion. After §2 the duplicate is gone, so any
-- "no duplicate phones" check goes green — and green would OVERSTATE what happened:
-- BNDH's number is still unverified, it is simply no longer provably colliding with
-- anything. Resolving a collision is not the same as verifying a number.
DO $$
DECLARE n_null int; n_total int;
BEGIN
  SELECT count(*) FILTER (WHERE phone IS NULL), count(*) INTO n_null, n_total
    FROM public.facilities WHERE sector = 'public' AND public_facility_type = 'hospital'
      AND status <> 'draft';
  RAISE NOTICE 'contact hygiene: % of % live state hospitals now have NO phone. The other % are UNVERIFIED, not verified — see module note §19 call-list.',
    n_null, n_total, n_total - n_null;
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
VALUES ('20260913_public_health_contact_hygiene.sql', '2ca7c7b66c1054a68e1d411ae63a8f339570917812e3b354808729bcbeafef3a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- No column or table shape changed, so PostgREST's cache is unaffected. Stated so the
-- omission reads as deliberate.

-- ─── Verification ───────────────────────────────────────────────────────────
--   Re-run BLOCK W6 of supabase/verify_search_tokenised.sql. Expect:
--     • no_duplicate_phones  → OK  (but read §3's note above: this is now a weaker
--                                   statement than it looks)
--     • acil_durum_phone_held → OK  (NULL until the dial confirms 612 0500)
--     • the report rows       → no bare city names, BNDH reads 'Ortaköy, Lefkoşa',
--                               Akçiçek reads 'Dr. Fazıl Küçük Blv., Girne'
--   Then W4/W4b/W5 to confirm search did not regress — the bare city names were
--   load-bearing and this migration rewrote all of them.

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   The previous values, for the record. Restoring them re-publishes a phone number that
--   is provably wrong on one of two rows — do not do this without a reason.
--     SET ROLE postgres; BEGIN;
--     UPDATE public.facilities SET address='Lefkoşa',    phone='(0392) 223 24 41' WHERE id='56614fa9-d7ba-4528-9fe4-f372e9f9286a';
--     UPDATE public.facilities SET address='Lefkoşa'     WHERE id='3d108354-79cd-4a11-8173-e7c996d4bcd0';
--     UPDATE public.facilities SET address='Lefkoşa'     WHERE id='e83f3d1d-c0c0-4e68-993c-03a8164286c1';
--     UPDATE public.facilities SET address='Gazimağusa'  WHERE id='ed83578f-1866-4e54-9253-705feb093c22';
--     UPDATE public.facilities SET address='Girne'       WHERE id='7a1c598d-bc43-4b50-9f42-f94adffffe5d';
--     UPDATE public.facilities SET address='Lefke'       WHERE id='32dafd70-73fb-4aec-afb2-6c940d07e9b9';
--     COMMIT; RESET ROLE;
