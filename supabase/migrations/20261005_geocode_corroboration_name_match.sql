-- ─── facilities.geocode_corroboration — the vocabulary gains name_match ──────
--
-- COMMENT ONLY. No DDL, no data, no constraint. The column, its type (text[]) and
-- everything already written into it are unchanged from 20260919.
--
-- ⚠ WHY THIS IS ITS OWN FILE AND NOT AN EDIT TO 20260919.
-- 20260919 is applied and its checksum sits in schema_migrations_applied. Editing it in
-- place would leave the ledger attesting a file that no longer matches the text that ran
-- — failure mode 3 in scripts/migration-ledger.mjs, the one nothing else can see. An
-- applied migration is history. History gets appended to, never rewritten.
--
-- ─── WHAT CHANGED ───────────────────────────────────────────────────────────
--
-- scripts/geocode-pharmacies-tier2.mjs gained a NAME check: the Places displayName is
-- tokenised against the facility name, with the ECZANESİ / ECZANESI / ECZNESİ / PHARMACY
-- suffixes and any parenthetical stripped, and a row with no shared token is rejected.
-- It exists because of a confirmed wrong pin — AKÇAY ECZANESİ (Akçay village, Güzelyurt)
-- matched ERİN ECZANESİ in Güzelyurt town, several km away, and was accepted on town
-- agreement alone. Town agreement is district-level; it cannot tell two pharmacies in one
-- district apart. {akçay} vs {erin} can.
--
-- That check is a real, independent signal, and until now it was UNRECORDED: an accepted
-- row said [address_town] or [address_town, phone_exchange] and nothing in the database
-- showed that its identity had also been verified. This adds the vocabulary entry so the
-- writer can record it, which is the whole point of the column — 20260919 says it plainly:
-- "Recording 'we did not verify this' honestly is the whole value of the column."
--
-- ─── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- geocode_corroboration has NO CHECK CONSTRAINT and this migration does not add one. The
-- vocabulary has always been prose, enforced by nothing. Adding a CHECK now would be a
-- separate decision with a separate blast radius (it would have to be proven against every
-- existing array first), and it is not what this file is for. Consequence, stated so it is
-- not a surprise: nothing stops a writer putting any string in this column, before or
-- after this migration. The comment is documentation, not a gate.
--
-- ⚠ COMMENT ON COLUMN REPLACES. The text below is 20260919's, verbatim, with name_match
-- added to the list and one sentence defining it. It was reconstructed from that file
-- rather than read from the live database — PostgREST's OpenAPI root does not expose
-- column descriptions to the anon role, so the live text could not be fetched to diff.
-- BEFORE APPLYING, print the current comment and confirm this is a superset of it:
--
--   SELECT col_description('public.facilities'::regclass, ordinal_position)
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='facilities'
--      AND column_name='geocode_corroboration';
--
-- If the live text differs from 20260919's, STOP — something changed it outside the repo,
-- and applying this would silently discard that change.
--
-- EXECUTION: SQL editor, Role = postgres. COMMENT ON requires the table owner.
-- Run the WHOLE FILE — it is one transaction ending in COMMIT.

SET ROLE postgres;

BEGIN;

-- Fail loudly if the column this documents is not there: a comment on a missing column
-- raises 42703 anyway, but the message would name the column and not the cause.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'facilities'
       AND column_name = 'geocode_corroboration'
  ) THEN
    RAISE EXCEPTION 'facilities.geocode_corroboration is missing — apply 20260919_facilities_geocode_provenance.sql first';
  END IF;
END $$;

COMMENT ON COLUMN public.facilities.geocode_corroboration IS
  'What INDEPENDENTLY agreed with this coordinate: address_town, phone_exchange, '
  'region_audit, google_places, osm, visual_satellite, name_match. '
  'name_match = the Places displayName matched the facility name after suffix and '
  'parenthetical stripping (scripts/geocode-pharmacies-tier2.mjs; the suffixes are '
  'ECZANESİ / ECZANESI / ECZNESİ / PHARMACY, and note the dotless-I spelling folds to a '
  'DIFFERENT string from the dotted one). It is an IDENTITY signal, not a positional one: '
  'it says we matched the right business, and says nothing about where that business is. '
  'Empty/NULL means nothing did — a fact worth storing, not a gap to hide. '
  'FOR A HAND-PLACED PIN, visual_satellite IS MANDATORY, NOT SAMPLED: placements happen '
  'one at a time during business work, so there is no batch and no reviewer, and looking '
  'at one pin on satellite costs thirty seconds. resolveRegion() cannot substitute — its '
  'anchors derive from the same coarse geocoding it would be checking, so it confirms a '
  'town and never a street, and a wrong street is what makes someone drive to the wrong '
  'place. '
  'NOT ENFORCED: this column has no CHECK constraint, so this list is documentation and '
  'not a gate. A value outside it is a bug in the writer, not something the database will '
  'refuse.';

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
VALUES ('20261005_geocode_corroboration_name_match.sql', '772db18cb37c22a32030bc50e30d67415ac14b09f9a6e05f071359bb7ece6742')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- PostgREST serves column comments as field descriptions in its OpenAPI output, so the
-- cache holds a copy of the superseded text until it is told otherwise. No ADD COLUMN
-- here, so this is not the 42703 case the CLAUDE.md rule is about — it is the same
-- NOTIFY for a smaller reason. Same reasoning as 20260915.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ───────────────────────────────────────────────────────────
--   SELECT col_description('public.facilities'::regclass, ordinal_position) ILIKE '%name_match%'
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='facilities'
--      AND column_name='geocode_corroboration';
--   -- expect: t
--
--   -- And that nothing was LOST — the visual_satellite rule must survive:
--   SELECT col_description('public.facilities'::regclass, ordinal_position) ILIKE '%MANDATORY, NOT SAMPLED%'
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='facilities'
--      AND column_name='geocode_corroboration';
--   -- expect: t   (this is the half a careless rewrite would drop)

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Restores the 20260919 text verbatim. Only correct if the name check is removed from
--   scripts/geocode-pharmacies-tier2.mjs at the same time — otherwise the script keeps
--   writing a value the column no longer documents.
--   SET ROLE postgres; BEGIN;
--   COMMENT ON COLUMN public.facilities.geocode_corroboration IS
--     'What INDEPENDENTLY agreed with this coordinate: address_town, phone_exchange, '
--     'region_audit, google_places, osm, visual_satellite. Empty/NULL means nothing did '
--     '— a fact worth storing, not a gap to hide. FOR A HAND-PLACED PIN, visual_satellite '
--     'IS MANDATORY, NOT SAMPLED: placements happen one at a time during business work, '
--     'so there is no batch and no reviewer, and looking at one pin on satellite costs '
--     'thirty seconds. resolveRegion() cannot substitute — its anchors derive from the '
--     'same coarse geocoding it would be checking, so it confirms a town and never a '
--     'street, and a wrong street is what makes someone drive to the wrong place.';
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20261005_geocode_corroboration_name_match.sql';
--   COMMIT; RESET ROLE; NOTIFY pgrst, 'reload schema';
