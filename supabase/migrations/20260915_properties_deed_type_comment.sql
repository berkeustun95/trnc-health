-- ─── properties.deed_type — the comment was right about a different source ───
--
-- COMMENT ONLY. No DDL, no data, no constraint. The deed_type column, its CHECK and
-- its five allowed values are all unchanged from 20260904.
--
-- ⚠ WHY THIS IS ITS OWN FILE AND NOT AN EDIT TO 20260904.
-- 20260904 is applied and its checksum sits in schema_migrations_applied. Editing it in
-- place would leave the ledger attesting a file that no longer matches the text that ran
-- — failure mode 3 in scripts/migration-ledger.mjs, the one nothing else can see. An
-- applied migration is history. History gets appended to, never rewritten.
--
-- ─── WHAT CHANGED, AND WHY THE OLD COMMENT MUST GO ──────────────────────────
--
-- The old comment reads: "101evler does NOT expose deed type as a structured field; it
-- appears only inside the free-text title and description. Any Slice 2 attempt to parse
-- it is heuristic and unreliable."
--
-- Every word of that was TRUE OF 101EVLER. The source then changed. Slice 2 pulls from
-- Coldwell Banker Novest's own Houzez WordPress site, whose descriptions are structured
-- <ul><li> lists carrying one fact per element:
--
--     <li>90M2</li><li>2+1</li><li>Türk Koçanlı</li><li>2 Wc/2 Banyo</li>
--
-- A comment that says "unreliable" when a reliable rule has since been demonstrated does
-- not merely go stale — it actively misleads the next reader into not trying. That is
-- worse than no comment at all, which is why this is worth a migration of its own.
--
-- ─── THE RULE, AND ITS LIMITS ───────────────────────────────────────────────
--
-- ANCHORED WHOLE-<li> MATCH, POSITIVE-ONLY:   ^-?\s*Türk\s+Koçan(lı)?$
--
-- Measured against all 91 live listings on 2026-08-24:
--     33 x  <li>Türk Koçanlı</li>
--      1 x  <li>Türk Koçan</li>
--      1 x  <li>-Türk Koçan</li>
--
-- The anchoring is the whole trick. A substring search for "koçan" is WRONG, and these
-- four real strings in the same feed are why — every one of them contains it, none of
-- them states a deed type:
--     3 x  "%40 Peşinat Geriye Kalan Koçan Tesliminde"   payment terms
--     1 x  "Koçanları Hazır"                             deeds ready, type unstated
--     1 x  "Koçanı Hazır"                                    "
--     1 x  "Anahtar Teslimine Hazır ,Türk koçanlı ve Asansörü Olan 3 Adet Daire
--           Karşılığı Satılık"                           compound sentence, land-swap
--
-- The rule was watched go red before it was trusted: fed those six strings, confirmed
-- zero matches, then confirmed the 35 still match. A check nobody has seen refuse
-- something is not a check.
--
-- POSITIVE-ONLY IS LOAD-BEARING. Absence of the token means the listing did not say, not
-- that the deed is something else. NULL keeps its 20260904 meaning exactly: "not known",
-- never "no deed". Nothing may infer a non-turkish deed from a NULL.
--
-- ─── THE DATED CLAUSE ───────────────────────────────────────────────────────
--
-- The comment states that zero Eşdeğer / Tahsis / TMD / Yabancı Koçan listings appear in
-- this feed AS OF 2026-08-24. That date is deliberate and belongs in the text: it is a
-- fact about 91 listings on one day, not a property of TRNC deeds. Novest listing a
-- single exchange-title property falsifies it. A dated claim invites the reader to
-- re-check; an undated one invites them to believe it forever.
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
     WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'deed_type'
  ) THEN
    RAISE EXCEPTION 'properties.deed_type is missing — apply 20260904_accommodation_partner_feed.sql first';
  END IF;
END $$;

COMMENT ON COLUMN public.properties.deed_type IS
  'KNOWN SPARSE — expect mostly NULL. NULL means "not known", NEVER "no deed", and '
  'nothing may infer a non-Turkish deed from it. '
  'PARSEABLE FROM THE NOVEST FEED, unlike 101evler: that source exposed deed type only '
  'in free text, this one puts it in a structured <li>. The importer uses an ANCHORED '
  'WHOLE-<li> MATCH, POSITIVE-ONLY: ^-?\s*Türk\s+Koçan(lı)?$ -> ''turkish''. Anchoring is '
  'load-bearing — a substring search for "koçan" also matches "%40 Peşinat Geriye Kalan '
  'Koçan Tesliminde" (payment terms) and "Koçanı Hazır" (deeds ready, type unstated), '
  'neither of which states a deed type. '
  'AS OF 2026-08-24, across all 91 live Novest listings, ZERO carry Eşdeğer, Tahsis, TMD '
  'or Yabancı Koçan, so ''turkish'' is the only value this feed can currently produce. '
  'That clause is dated on purpose: it describes one day''s data, not TRNC deeds, and one '
  'exchange-title listing falsifies it. Re-measure before relying on it.';

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
VALUES ('20260915_properties_deed_type_comment.sql', '175250865182c5d97b3a1d0da55caa0c05fcc13c4c57d55c4c82328eef5ac7a8')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- PostgREST serves column comments as field descriptions in its OpenAPI output, so the
-- cache holds a copy of the superseded text until it is told otherwise. No ADD COLUMN
-- here, so this is not the 42703 case the CLAUDE.md rule is about — it is the same
-- NOTIFY for a smaller reason.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ───────────────────────────────────────────────────────────
--   SELECT col_description('public.properties'::regclass, ordinal_position) LIKE '%ANCHORED%'
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='properties' AND column_name='deed_type';
--   -- expect: t     (registered as an H-token in verify_schema.sql)

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Restores the 20260904 text verbatim. Only correct if the Novest feed is abandoned —
--   the parse rule it calls unreliable is demonstrably reliable against this source.
--   SET ROLE postgres; BEGIN;
--   COMMENT ON COLUMN public.properties.deed_type IS
--     'KNOWN SPARSE — expect mostly NULL. 101evler does NOT expose deed type as a '
--     'structured field; it appears only inside the free-text title and description. Any '
--     'Slice 2 attempt to parse it is heuristic and unreliable, so NULL means "not known", '
--     'never "no deed". Nullable with no NOT NULL implication anywhere.';
--   COMMIT; RESET ROLE; NOTIFY pgrst, 'reload schema';
