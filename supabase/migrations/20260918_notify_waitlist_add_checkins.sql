-- ═══ notify path — add `checkins` ═══════════════════════════════════════════
--
-- WHY THIS FILE EXISTS AT ALL. `checkins` is a Coming-Soon module: the "Check in" button
-- on a place profile opens ComingSoonScreen, which upserts module='checkins' into
-- module_waitlist. That INSERT needs NOTHING from this migration — 20260814 loosened the
-- CHECK to a shape guard (^[a-zA-Z]{2,40}$), so any key is accepted the moment the client
-- sends it. Signups will start arriving on the next OTA either way.
--
-- NOTIFYING those people is what needs this file. notify_module_waitlist() validates
-- against a hardcoded whitelist, and module_notif_text() resolves the display name from
-- two hardcoded VALUES tables. A module absent from them fails in one of two ways:
--
--   whitelist only          → ERROR: unknown module checkins.  Loud, at least.
--   whitelist but no name   → module_notif_text returns NULL (no name row → coalesce
--                             gives NULL → replace(text,'{module}',NULL) is NULL), the
--                             INSERT hits notifications.title NOT NULL, and the blast
--                             dies naming nothing relevant.
--
-- That gap is not hypothetical: explore, studentHub and towing each collected signups for
-- MONTHS while being un-notifiable, and nothing surfaced it until launch day. 20260909
-- fixed those three and scripts/check-module-flags.mjs now cross-checks every
-- MODULE_FLAGS key against both lists on every push — which is why `checkins` cannot be
-- added to MODULE_FLAGS without this migration landing in the same commit.
--
-- ⚠ THE GUARD READS ONE FILE, BY PATH. check-module-flags.mjs hardcodes NOTIFY_SQL. This
--   migration supersedes 20260909 as the current definition, so that constant is
--   repointed HERE in the same commit. Miss that and the guard keeps reading the old file
--   and fails every push with "checkins is missing from the whitelist" — while the
--   database is perfectly correct.
--
-- ─── SCOPE ──────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE on two functions. No new table, no new column, no policy change, no
-- RLS change, no grant change. Both bodies are reproduced in full because CREATE OR
-- REPLACE substitutes the whole definition — they are 20260909's bodies with `checkins`
-- added in three places and one stale comment corrected ("the same 9 keys" had been wrong
-- since 20260814 loosened the CHECK).
--
-- ─── EN + TR ONLY, DELIBERATELY ─────────────────────────────────────────────
--
-- `checkins` gets English and Turkish display names and nothing else, following the
-- garages/events/pets precedent already in this function: the other seven locales fall
-- through to the English name, exactly as the app's own t() does. A machine-translated
-- name in seven languages is worse than a clean English fallback. The Turkish is
-- "Buradayım" — reviewed, not generated: it reads as a status rather than a transaction,
-- which is what a check-in is. ("Giriş yap" collides with log-in; "Check-in yap" is the
-- half-English construction a nine-language app should not ship.)
--
-- Apply by hand: SQL editor, Role = postgres. Then `node scripts/migration-ledger.mjs`
-- and re-run supabase/migration_ledger_check.sql — this file should stop being listed.

SET ROLE postgres;
BEGIN;

CREATE OR REPLACE FUNCTION public.module_notif_text(p_key text, p_module text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT replace(
    -- (1) the per-language template for this key, English fallback.
    coalesce(
      (SELECT txt FROM (VALUES
        ('title','English','New on ADA: {module}'),
        ('title','Turkish','ADA''da yeni: {module}'),
        ('title','Arabic','جديد على ADA: {module}'),
        ('title','Russian','Новое в ADA: {module}'),
        ('title','Greek','Νέο στο ADA: {module}'),
        ('title','French','Nouveau sur ADA : {module}'),
        ('title','Spanish','Nuevo en ADA: {module}'),
        ('title','German','Neu bei ADA: {module}'),
        ('title','Persian','جدید در ADA: {module}'),

        ('body','English','The {module} section is now live in ADA. Tap to open it and explore.'),
        ('body','Turkish','{module} bölümü artık ADA''da yayında. Açmak ve keşfetmek için dokun.'),
        ('body','Arabic','قسم {module} متاح الآن في ADA. اضغط لفتحه واستكشافه.'),
        ('body','Russian','Раздел «{module}» теперь доступен в ADA. Нажмите, чтобы открыть.'),
        ('body','Greek','Η ενότητα «{module}» είναι πλέον διαθέσιμη στο ADA. Πατήστε για να την ανοίξετε.'),
        ('body','French','La rubrique {module} est maintenant disponible sur ADA. Touchez pour l''ouvrir.'),
        ('body','Spanish','La sección {module} ya está disponible en ADA. Toca para abrirla y explorar.'),
        ('body','German','Der Bereich {module} ist jetzt in ADA verfügbar. Tippe, um ihn zu öffnen.'),
        ('body','Persian','بخش {module} اکنون در ADA فعال است. برای باز کردن آن ضربه بزنید.')
      ) AS m(k, l, txt)
      WHERE m.k = p_key AND m.l = coalesce(p_lang, 'English')),
      (SELECT txt FROM (VALUES
        ('title','New on ADA: {module}'),
        ('body','The {module} section is now live in ADA. Tap to open it and explore.')
      ) AS f(k, txt) WHERE f.k = p_key)
    ),
    '{module}',
    -- (2) the localized module display name, English fallback. Sourced from the
    -- app's menu* i18n; garages/events/pets are EN+TR only (the app falls back to
    -- English for the other 7 too), so only their EN+TR rows are listed.
    coalesce(
      (SELECT nm FROM (VALUES
        ('homeServices','English','Home Services'),
        ('homeServices','Turkish','Ev Hizmetleri'),
        ('homeServices','Arabic','الخدمات المنزلية'),
        ('homeServices','Russian','Бытовые услуги'),
        ('homeServices','Greek','Οικιακές Υπηρεσίες'),
        ('homeServices','French','Services à domicile'),
        ('homeServices','Spanish','Servicios del hogar'),
        ('homeServices','German','Haushaltsservices'),
        ('homeServices','Persian','خدمات منزل'),

        ('grooming','English','Beauty & Grooming'),
        ('grooming','Turkish','Güzellik & Bakım'),
        ('grooming','Arabic','الحلاقة والتجميل'),
        ('grooming','Russian','Красота и уход'),
        ('grooming','Greek','Ομορφιά & Περιποίηση'),
        ('grooming','French','Beauté & Coiffure'),
        ('grooming','Spanish','Belleza y Estética'),
        ('grooming','German','Beauty & Pflege'),
        ('grooming','Persian','زیبایی و آرایش'),

        ('transport','English','Transportation'),
        ('transport','Turkish','Ulaşım'),
        ('transport','Arabic','المواصلات'),
        ('transport','Russian','Транспорт'),
        ('transport','Greek','Μεταφορές'),
        ('transport','French','Transport'),
        ('transport','Spanish','Transporte'),
        ('transport','German','Transport'),
        ('transport','Persian','حمل‌ونقل'),

        ('insurance','English','Insurance'),
        ('insurance','Turkish','Sigorta'),
        ('insurance','Arabic','التأمين'),
        ('insurance','Russian','Страхование'),
        ('insurance','Greek','Ασφάλιση'),
        ('insurance','French','Assurance'),
        ('insurance','Spanish','Seguros'),
        ('insurance','German','Versicherung'),
        ('insurance','Persian','بیمه'),

        ('jobs','English','Jobs'),
        ('jobs','Turkish','İş İlanları'),
        ('jobs','Arabic','وظائف'),
        ('jobs','Russian','Вакансии'),
        ('jobs','Greek','Εργασία'),
        ('jobs','French','Emplois'),
        ('jobs','Spanish','Empleo'),
        ('jobs','German','Stellenangebote'),
        ('jobs','Persian','آگهی شغلی'),

        ('accommodation','English','Accommodations'),
        ('accommodation','Turkish','Konaklama'),
        ('accommodation','Arabic','الإقامة'),
        ('accommodation','Russian','Жильё'),
        ('accommodation','Greek','Διαμονή'),
        ('accommodation','French','Hébergement'),
        ('accommodation','Spanish','Alojamiento'),
        ('accommodation','German','Unterkunft'),
        ('accommodation','Persian','اقامتگاه'),

        ('explore','English','Explore'),
        ('explore','Turkish','Keşfet'),
        ('explore','Arabic','استكشاف'),
        ('explore','Russian','Обзор'),
        ('explore','Greek','Εξερεύνηση'),
        ('explore','French','Explorer'),
        ('explore','Spanish','Explorar'),
        ('explore','German','Entdecken'),
        ('explore','Persian','کاوش'),

        ('studentHub','English','Student Hub'),
        ('studentHub','Turkish','Öğrenci Merkezi'),
        ('studentHub','Arabic','مركز الطلاب'),
        ('studentHub','Russian','Студентам'),
        ('studentHub','Greek','Φοιτητικά'),
        ('studentHub','French','Espace étudiant'),
        ('studentHub','Spanish','Zona estudiantil'),
        ('studentHub','German','Studenten-Hub'),
        ('studentHub','Persian','مرکز دانشجویان'),

        ('towing','English','Towing & Roadside'),
        ('towing','Turkish','Çekici & Yol Yardım'),
        ('towing','Arabic','سحب السيارات والمساعدة على الطريق'),
        ('towing','Russian','Эвакуатор и помощь на дороге'),
        ('towing','Greek','Οδική βοήθεια & ρυμούλκηση'),
        ('towing','French','Dépannage & remorquage'),
        ('towing','Spanish','Grúa y asistencia en carretera'),
        ('towing','German','Abschleppdienst & Pannenhilfe'),
        ('towing','Persian','یدک‌کش و امداد جاده‌ای'),

        ('garages','English','Garages'),
        ('garages','Turkish','Oto Servis'),

        ('events','English','Events'),
        ('events','Turkish','Etkinlikler'),

        ('pets','English','Pets & Animals'),
        ('pets','Turkish','Evcil Hayvanlar'),

        ('checkins','English','Check-ins'),
        ('checkins','Turkish','Buradayım')
      ) AS n(mod, l, nm)
      WHERE n.mod = p_module AND n.l = coalesce(p_lang, 'English')),
      (SELECT nm FROM (VALUES
        ('homeServices','Home Services'),
        ('grooming','Beauty & Grooming'),
        ('garages','Garages'),
        ('transport','Transportation'),
        ('insurance','Insurance'),
        ('pets','Pets & Animals'),
        ('events','Events'),
        ('jobs','Jobs'),
        ('accommodation','Accommodations'),
        ('explore','Explore'),
        ('studentHub','Student Hub'),
        ('towing','Towing & Roadside'),
        ('checkins','Check-ins')
      ) AS g(mod, nm) WHERE g.mod = p_module)
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.notify_module_waitlist(p_module text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  tok   text;
  plang text;
  ttl   text;
  bdy   text;
  n     integer := 0;
BEGIN
  -- Auth guard: postgres in the SQL editor (uid null) passes; an app caller must
  -- be admin. is_admin(uuid) does not exist — is_admin() reads auth.uid() itself.
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'notify_module_waitlist: admin only';
  END IF;

  -- Validate against the module keys MODULE_FLAGS declares. The module_waitlist CHECK
  -- itself is only a shape guard (^[a-zA-Z]{2,40}$ since 20260814), so THIS list is the
  -- only thing that rejects a typo'd module name.
  IF p_module NOT IN ('homeServices','grooming','garages','transport',
                      'insurance','pets','events','jobs','accommodation',
                      'explore','studentHub','towing','checkins') THEN
    RAISE EXCEPTION 'notify_module_waitlist: unknown module %', p_module;
  END IF;

  FOR r IN
    SELECT user_id FROM module_waitlist
    WHERE module = p_module AND notified_at IS NULL
  LOOP
    -- Stamp first so a mid-run error / retry never double-notifies this row.
    UPDATE module_waitlist SET notified_at = now()
      WHERE user_id = r.user_id AND module = p_module;

    SELECT push_token, preferred_language INTO tok, plang
      FROM profiles WHERE id = r.user_id;
    ttl := module_notif_text('title', p_module, plang);
    bdy := module_notif_text('body',  p_module, plang);

    INSERT INTO notifications (user_id, title, body) VALUES (r.user_id, ttl, bdy);
    IF tok IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.notify_module_waitlist(text) TO authenticated;

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
VALUES ('20260918_notify_waitlist_add_checkins.sql', '41374e31e529eb790597629778e33cb85a507248232944e8d7f15873d8bfdd95')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN in this migration, so no `NOTIFY pgrst, 'reload schema'` is required:
-- PostgREST's cache holds table/column shape, and CREATE OR REPLACE of a function body
-- changes neither. (Re-issuing it would be harmless but would misrepresent what changed.)

-- ─── Verification (Role = postgres) ─────────────────────────────────────────
--   -- 1. the whitelist and BOTH name tables know checkins:
--   SELECT pg_get_functiondef(oid) ILIKE '%''checkins''%' AS in_whitelist
--     FROM pg_proc WHERE proname = 'notify_module_waitlist';
--   SELECT pg_get_functiondef(oid) ILIKE '%Buradayım%'    AS has_tr_name,
--          pg_get_functiondef(oid) ILIKE '%Check-ins%'    AS has_en_fallback
--     FROM pg_proc WHERE proname = 'module_notif_text';
--   -- expect true / true / true.
--
--   -- 2. the text resolves in both directions — this is the NOT NULL abort, caught early:
--   SELECT module_notif_text('title','checkins','Turkish');   -- ADA'da yeni: Buradayım
--   SELECT module_notif_text('title','checkins','Persian');   -- New on ADA: Check-ins
--   SELECT module_notif_text('body' ,'checkins',NULL);        -- English body, non-NULL
--   -- ⚠ NEVER run notify_module_waitlist('checkins') as a check: it EXECUTES the blast,
--   --   stamps notified_at and sends real pushes. The SELECTs above prove the same thing.
--
-- Then run supabase/verify_schema.sql (the 0918 H-token is registered there) and
-- supabase/migration_ledger_check.sql (this file must no longer be listed as missing).

-- ─── Rollback ───────────────────────────────────────────────────────────────
-- Re-apply 20260909_notify_waitlist_add_modules.sql verbatim; it is the previous
-- definition of both functions. Also repoint NOTIFY_SQL in scripts/check-module-flags.mjs
-- back to that file and drop `checkins` from MODULE_FLAGS + EXPECTED_MODULES, or the
-- guard will block every push looking for a key the database no longer accepts.
-- Rolling back does NOT remove module_waitlist rows already collected under
-- module='checkins' — the shape guard accepted them without any of this. Deleting them
-- throws away real demand data; leave them.
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260918_notify_waitlist_add_checkins.sql';
