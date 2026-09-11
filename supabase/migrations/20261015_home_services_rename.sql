-- ═══ Ev Hizmetleri is renamed — the DISPLAY NAME only ═══════════════════════
--
-- The module's display name becomes "Tadilat · Bakım · Onarım" / "Renovation ·
-- Maintenance · Repair" in all nine locales. The app half is constants/i18n.js
-- (menuHomeServices, hsTitle, oliChipHomeServices, coachHomeServicesTitle); this file is
-- the database half — module_notif_text() is the ONLY place the display name lives
-- outside the app, and it is what the waitlist blast puts in front of the three people
-- who signed up for this module.
--
-- ⚠ THE KEY `homeServices` DOES NOT CHANGE, ANYWHERE. It is an identifier, not a label:
--   MODULE_FLAGS, EXPECTED_MODULES, WAITLIST_BLAST_DONE, module_waitlist.module,
--   contact_events.module and search_content all key off it. Only the strings the VALUES
--   tables map it TO are edited — ten of them, nine per-language rows plus the English
--   fallback.
--
-- ─── WHY notify_module_waitlist IS IN HERE UNCHANGED ────────────────────────
--
-- It is byte-identical to 20260918's and this migration does not alter its behaviour. It
-- is reproduced because scripts/check-module-flags.mjs reads ONE file by path
-- (NOTIFY_SQL) and needs both the whitelist and the English-fallback name list inside it
-- — and that constant is repointed to THIS file in the same commit. The invariant that
-- buys is the one that matters: the newest migration IS the complete current notify
-- path. Leave the constant on 20260918 and the next person adding a module starts from a
-- file whose homeServices name is stale; CREATE OR REPLACE would then revert this rename
-- with no error, no diff, and nothing to notice it by.
--
-- ─── ALL NINE LOCALES, UNLIKE garages/events/pets/checkins ──────────────────
--
-- Those four carry EN+TR only and let the other seven fall through to English, because a
-- machine-translated name is worse than a clean English fallback. This one is translated
-- in full for a different reason: it is not a noun to look up, it is a three-part phrase
-- describing the work, and the fallback would leave seven locales reading a notification
-- in their own language with an English phrase wedged into the middle of it.
--
-- The nine were reviewed, not generated. Two are not the obvious word:
--   • Russian leads with «Отделка», not «Ремонт». Ремонт covers BOTH renovation and
--     repair, so the obvious rendering would have made parts one and three the same
--     word. Отделка (fit-out / finishing) is the distinct term.
--   • German leads with "Umbau", not "Renovierung" — a LAYOUT constraint reaching into
--     the copy. The home tile renders the phrase's FIRST PART alone, and "Renovierung"
--     measures 68.6pt in a 68.0pt tile box at 320dp: it breaks mid-word. Umbau is the
--     ordinary German term for the same work, so the tile and the phrase say the same
--     word rather than the tile inventing one the notification never uses.
--
-- ─── SCOPE ──────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE on two functions. No new table, column, policy, grant, trigger or
-- index — and therefore NO NEW NAMED OBJECT, so verify_schema.sql gets an H-section
-- token (a body match on the Turkish name). Nothing else could tell that this applied.
--
-- No ADD COLUMN, so no `NOTIFY pgrst, 'reload schema'`: PostgREST caches table shape and
-- a function body is not table shape.
--
-- Apply by hand: SQL editor, Role = postgres. Then `node scripts/migration-ledger.mjs`
-- and re-run supabase/migration_ledger_check.sql.

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
        ('homeServices','English','Renovation · Maintenance · Repair'),
        ('homeServices','Turkish','Tadilat · Bakım · Onarım'),
        ('homeServices','Arabic','تجديد · صيانة · إصلاح'),
        ('homeServices','Russian','Отделка · Обслуживание · Ремонт'),
        ('homeServices','Greek','Ανακαίνιση · Συντήρηση · Επισκευή'),
        ('homeServices','French','Rénovation · Entretien · Réparation'),
        ('homeServices','Spanish','Reforma · Mantenimiento · Reparación'),
        ('homeServices','German','Umbau · Wartung · Reparatur'),
        ('homeServices','Persian','بازسازی · نگهداری · تعمیر'),

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
        ('homeServices','Renovation · Maintenance · Repair'),
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

-- ─── Verification — reads the FUNCTION BACK, not this file ──────────────────
--
-- pg_get_functiondef and a live call are the authority; everything above is a statement
-- of intent. The assertions use IS DISTINCT FROM so a NULL — function missing, or the
-- name lookup returning nothing — FAILS, rather than evaluating to NULL and skipping the
-- IF it was written to trip.
--
-- ⚠ THE CONTROL IS THE POINT OF THE BLOCK. It calls the real function for a DIFFERENT
--   module and requires the OLD answer. Without it, a module_notif_text that returned
--   this file's new string for every input on earth would satisfy every assertion above
--   it — the probe would be pinned to pass rather than measuring anything.
DO $$
DECLARE
  v_tr  text;
  v_fa  text;
  v_ctl text;
BEGIN
  v_tr := module_notif_text('title', 'homeServices', 'Turkish');
  IF v_tr IS DISTINCT FROM 'ADA''da yeni: Tadilat · Bakım · Onarım' THEN
    RAISE EXCEPTION 'TR title is %, expected the renamed module', coalesce(v_tr, '<NULL>');
  END IF;

  -- Persian, because most modules have no Persian row and this one now does: it proves
  -- the nine-locale table pasted, rather than every locale resolving to English.
  v_fa := module_notif_text('body', 'homeServices', 'Persian');
  IF v_fa IS NULL OR v_fa NOT LIKE '%بازسازی · نگهداری · تعمیر%' THEN
    RAISE EXCEPTION 'FA body is %, expected to contain the Persian name', coalesce(v_fa, '<NULL>');
  END IF;

  v_ctl := module_notif_text('title', 'towing', 'Turkish');
  IF v_ctl IS DISTINCT FROM 'ADA''da yeni: Çekici & Yol Yardım' THEN
    RAISE EXCEPTION 'CONTROL FAILED: towing TR title is % — this function is answering '
      'the same way regardless of input, so the assertions above prove nothing',
      coalesce(v_ctl, '<NULL>');
  END IF;

  RAISE NOTICE 'module_notif_text renamed. TR title: %', v_tr;
  RAISE NOTICE '  control (towing, must be unchanged): %', v_ctl;
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
VALUES ('20261015_home_services_rename.sql', 'e08cbfa7da07b1de45193502037c5b5193a20377dc47682142cef85fef2cc1fd')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Post-apply (Role = postgres) ───────────────────────────────────────────
--   SELECT l, module_notif_text('title','homeServices', l)
--     FROM unnest(ARRAY['English','Turkish','Arabic','Russian','Greek','French',
--                       'Spanish','German','Persian']) AS l;
-- Expect nine DIFFERENT strings. Nine identical ones means the per-language table did not
-- paste and every locale is falling through to the English fallback.
--
-- ⚠ THE BLAST IS NOT IN THIS FILE. notify_module_waitlist('homeServices') owes 3 signups
--   and runs at module go-live SOP step 10 — AFTER the OTA is verified on device, and
--   after this migration. Run it before this applies and those three are told the old
--   name for a screen that no longer uses it.
