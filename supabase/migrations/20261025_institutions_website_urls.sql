-- ═══ institutions.website_url — the 23 university links (PROPOSED, not applied) ══════
--
-- Fills the column 20261024 added and left NULL. One https link per ACTIVE university,
-- matched BY ID. Source: YÖDAK's official directory (yodak.gov.ct.tr/universiteler.html),
-- the same list 20261018/21 reconciled the rows against; transcribed by the owner and
-- checked from here on 2026-09-16 (curl on macOS, then Node's strict TLS client) before
-- this file was written. All 23 serve a certificate valid for their host; none is http-only.
--
--   • 19 answer 200 on every client. Five of those redirect first and are stored as given,
--     not as the redirect target — where a university sends its root is its own business:
--       www.emu.edu.tr → /en · ciu.edu.tr → /tr · kktc.itu.edu.tr → /index.php/en/
--       cwu.edu.tr → www.cwu.edu.tr · kstu.edu.tr → aday.kstu.edu.tr (the APPLICANT portal,
--       not a general home page)
--   • 2 return 403 with `cf-mitigated: challenge` (Cloudflare's bot check), valid certs:
--       neu.edu.tr, final.edu.tr. A person in a browser passes the challenge; a script does not.
--   • 2 serve an INCOMPLETE certificate chain — the site is up, the server is misconfigured:
--       www.eul.edu.tr sends only its leaf (missing GlobalSign RSA OV SSL CA 2018);
--       arucad.edu.tr sends the wrong intermediate (leaf issued by GCC R46 AlphaSSL CA 2025,
--       chain carries GCC R6). macOS curl completes the chain and gets 200 (eul → /en/);
--       OpenSSL and Node refuse it. Browsers that fetch missing intermediates recover; that
--       is expected, NOT verified on a phone. The fix is the universities' to make.
--   • ncc.metu.edu.tr timed out for several minutes (TLS completed, then no HTTP response)
--     and then answered 200 in under a second to curl and Node alike — a transient outage.
--   • …0018 Altınbaş Kıbrıs is wpu.edu.tr on purpose: it was World Peace University before
--     the rebrand.
--
-- NOT set, and asserted NULL: …0006 Kıbrıs İlim (deactivated) and …00ff Other.
--
-- ─── RE-RUN ──────────────────────────────────────────────────────────────────
-- A no-op against its own end state. Section 1 refuses if a listed row is missing or
-- inactive (an UPDATE by id would match 0 rows, or publish a link for a hidden row), and
-- if a listed row already holds a DIFFERENT link — that is a later edit, and re-running
-- would silently revert it. scripts/check-institution-links.mjs re-checks the live links.
--
-- ONE DO BLOCK, NO TEMP OBJECTS. The list is a jsonb variable read by the guard, the UPDATE
-- and the state check alike, so the three cannot disagree — and nothing depends on a
-- temp table surviving from one top-level statement to the next (the shape that failed
-- 20261024's first production apply with 42P01).
--
-- EXECUTION: SQL editor, Role = postgres, the WHOLE FILE. No NOTIFY — no column changes.
-- Requires 20261024 (the column and its CHECK).

SET ROLE postgres;

BEGIN;

DO $$
DECLARE
  -- The list. Names are carried for the printout and the error messages only; rows are
  -- matched BY ID, and a later rename must not make this file refuse.
  v_list  jsonb := '[
    {"id": "00000000-0000-4000-b000-000000000001", "url": "https://www.emu.edu.tr",   "name": "Doğu Akdeniz"},
    {"id": "00000000-0000-4000-b000-000000000002", "url": "https://neu.edu.tr",       "name": "Yakın Doğu"},
    {"id": "00000000-0000-4000-b000-000000000003", "url": "https://ciu.edu.tr",       "name": "Uluslararası Kıbrıs"},
    {"id": "00000000-0000-4000-b000-000000000004", "url": "https://www.gau.edu.tr",   "name": "Girne Amerikan"},
    {"id": "00000000-0000-4000-b000-000000000005", "url": "https://www.eul.edu.tr",   "name": "Lefke Avrupa"},
    {"id": "00000000-0000-4000-b000-000000000007", "url": "https://arucad.edu.tr",    "name": "ARUCAD"},
    {"id": "00000000-0000-4000-b000-000000000008", "url": "https://final.edu.tr",     "name": "Uluslararası Final"},
    {"id": "00000000-0000-4000-b000-000000000009", "url": "https://kyrenia.edu.tr",   "name": "Girne Üniversitesi"},
    {"id": "00000000-0000-4000-b000-00000000000a", "url": "https://baucyprus.edu.tr", "name": "Bahçeşehir Kıbrıs"},
    {"id": "00000000-0000-4000-b000-00000000000b", "url": "https://onbeskku.edu.tr",  "name": "Onbeş Kasım Kıbrıs"},
    {"id": "00000000-0000-4000-b000-00000000000c", "url": "https://akun.edu.tr",      "name": "Akdeniz Karpaz"},
    {"id": "00000000-0000-4000-b000-00000000000d", "url": "https://rdu.edu.tr",       "name": "Rauf Denktaş"},
    {"id": "00000000-0000-4000-b000-00000000000f", "url": "https://adakent.edu.tr",   "name": "Ada Kent"},
    {"id": "00000000-0000-4000-b000-000000000010", "url": "https://elu.edu.tr",       "name": "Avrupa Liderlik"},
    {"id": "00000000-0000-4000-b000-000000000011", "url": "https://kktc.itu.edu.tr",  "name": "İTÜ-KKTC"},
    {"id": "00000000-0000-4000-b000-000000000012", "url": "https://auc.edu.tr",       "name": "Kıbrıs Amerikan"},
    {"id": "00000000-0000-4000-b000-000000000013", "url": "https://cau.edu.tr",       "name": "Kıbrıs Aydın"},
    {"id": "00000000-0000-4000-b000-000000000014", "url": "https://cwu.edu.tr",       "name": "Kıbrıs Batı"},
    {"id": "00000000-0000-4000-b000-000000000015", "url": "https://kstu.edu.tr",      "name": "Kıbrıs Sağlık ve Toplum Bilimleri"},
    {"id": "00000000-0000-4000-b000-000000000016", "url": "https://ncc.metu.edu.tr",  "name": "ODTÜ Kuzey Kıbrıs"},
    {"id": "00000000-0000-4000-b000-000000000017", "url": "https://kktc.asbu.edu.tr", "name": "Ankara Sosyal Bilimler"},
    {"id": "00000000-0000-4000-b000-000000000018", "url": "https://wpu.edu.tr",       "name": "Altınbaş Kıbrıs (ex World Peace University)"},
    {"id": "00000000-0000-4000-b000-000000000019", "url": "https://alasia.edu.tr",    "name": "Uluslararası Alasia"}
  ]';
  v_n     int;
  v_ids   int;
  v_urls  int;
  v_rows  text;
  v_def   text;
  v_valid boolean;
BEGIN
  -- ─── 1. Guard ──────────────────────────────────────────────────────────────
  SELECT count(*), count(DISTINCT id), count(DISTINCT url) INTO v_n, v_ids, v_urls
    FROM jsonb_to_recordset(v_list) AS l(id uuid, url text, name text);
  IF v_n IS DISTINCT FROM 23 OR v_ids IS DISTINCT FROM 23 OR v_urls IS DISTINCT FROM 23 THEN
    RAISE EXCEPTION 'REFUSING: the list holds % rows, % distinct ids, % distinct urls — expected 23 of each. Nothing applied.', v_n, v_ids, v_urls;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'website_url') THEN
    RAISE EXCEPTION 'REFUSING: institutions.website_url does not exist — apply 20261024 first. Nothing applied.';
  END IF;

  SELECT string_agg(l.name || ' (' || l.id || ')', ', ' ORDER BY l.id) INTO v_rows
    FROM jsonb_to_recordset(v_list) AS l(id uuid, url text, name text)
    LEFT JOIN public.institutions i ON i.id = l.id
   WHERE i.id IS NULL OR i.is_active IS DISTINCT FROM true;
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: listed row(s) missing or inactive: %. Nothing applied.', v_rows;
  END IF;

  SELECT string_agg(format('%s holds %s, this file sets %s', i.name, i.website_url, l.url), '; ' ORDER BY i.name) INTO v_rows
    FROM jsonb_to_recordset(v_list) AS l(id uuid, url text, name text)
    JOIN public.institutions i ON i.id = l.id
   WHERE i.website_url IS NOT NULL AND i.website_url IS DISTINCT FROM l.url;
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: link(s) edited after this file ran — re-running would revert them: %. Nothing applied.', v_rows;
  END IF;

  SELECT count(*) INTO v_n FROM public.institutions WHERE website_url IS NOT NULL;
  RAISE NOTICE 'links before: % populated', v_n;

  -- ─── 2. The update ─────────────────────────────────────────────────────────
  UPDATE public.institutions i
     SET website_url = l.url
    FROM jsonb_to_recordset(v_list) AS l(id uuid, url text, name text)
   WHERE i.id = l.id
     AND i.website_url IS DISTINCT FROM l.url;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'rows updated: %', v_n;

  -- ─── 3. State check — this file's end state ────────────────────────────────
  -- (a) The https rule as the DATABASE holds it, validated — not as 20261024 says it wrote it.
  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_valid FROM pg_constraint
   WHERE conrelid = 'public.institutions'::regclass AND conname = 'institutions_website_url_scheme_check';
  IF v_def IS DISTINCT FROM 'CHECK (((website_url IS NULL) OR (website_url ~ ''^https://''::text)))'
     OR v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'institutions_website_url_scheme_check is % (validated=%)', coalesce(v_def, '<missing>'), v_valid;
  END IF;
  --     …and every stored value satisfies it, which a dropped CHECK would not say.
  SELECT string_agg(name || ' = ' || website_url, '; ') INTO v_rows FROM public.institutions
   WHERE website_url IS NOT NULL AND website_url !~ '^https://';
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION 'non-https link(s): %', v_rows;
  END IF;

  -- (b) Every listed row holds exactly its link.
  SELECT string_agg(format('%s: %s ≠ %s', l.name, coalesce(i.website_url, 'NULL'), l.url), '; ') INTO v_rows
    FROM jsonb_to_recordset(v_list) AS l(id uuid, url text, name text)
    LEFT JOIN public.institutions i ON i.id = l.id
   WHERE i.website_url IS DISTINCT FROM l.url;
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION 'link mismatch: %', v_rows;
  END IF;

  -- (c) 23 populated — and derived, not remembered: no ACTIVE university is left without
  --     a link, so a university added later without one makes this file say so.
  SELECT count(*) INTO v_n FROM public.institutions WHERE website_url IS NOT NULL;
  IF v_n IS DISTINCT FROM 23 THEN
    RAISE EXCEPTION 'expected 23 populated links, found %', v_n;
  END IF;
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_rows FROM public.institutions
   WHERE is_active AND website_url IS NULL AND id IS DISTINCT FROM '00000000-0000-4000-b000-0000000000ff';
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION 'active universities without a link: %', v_rows;
  END IF;

  -- (d) Kıbrıs İlim (deactivated) and Other exist and stay NULL.
  SELECT string_agg(k.kid::text || ' = ' || CASE WHEN i.id IS NULL THEN '<row missing>' ELSE i.website_url END, ', ') INTO v_rows
    FROM (VALUES ('00000000-0000-4000-b000-000000000006'::uuid), ('00000000-0000-4000-b000-0000000000ff'::uuid)) AS k(kid)
    LEFT JOIN public.institutions i ON i.id = k.kid
   WHERE i.id IS NULL OR i.website_url IS NOT NULL;
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION '…0006 and …00ff must exist with a NULL link: %', v_rows;
  END IF;

  -- (e) No two universities share a link. The list is checked for this in section 1;
  --     this is the table, which could carry one from outside the list.
  SELECT string_agg(website_url, ', ') INTO v_rows FROM (
    SELECT website_url FROM public.institutions WHERE website_url IS NOT NULL
     GROUP BY website_url HAVING count(*) > 1) d;
  IF v_rows IS NOT NULL THEN
    RAISE EXCEPTION 'link(s) shared by more than one university: %', v_rows;
  END IF;

  SELECT string_agg(name || ' → ' || website_url, E'\n' ORDER BY name) INTO v_rows
    FROM public.institutions WHERE website_url IS NOT NULL;
  RAISE NOTICE E'23 links set; …0006 and …00ff NULL; CHECK validated.\n%', v_rows;
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
VALUES ('20261025_institutions_website_urls.sql', '6f11ea7e8e679646257e5d540fb8c6d68e0bdbb1d09f911fbacaf9654e0271c8')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
