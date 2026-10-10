-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104 — Duyurular joins the waitlist notify path (MODULE_FLAGS.duyurular, dark)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The app gains MODULE_FLAGS.duyurular (false) with a Coming Soon screen and waitlist. For the
-- go-live blast (SOP step 10) notify_module_waitlist() must accept 'duyurular' and
-- module_notif_text() must name it; scripts/check-module-flags.mjs reads both from ONE file
-- (NOTIFY_SQL), repointed to this one in the same commit.
--
-- ─── BUILT FROM THE LIVE DEFINITIONS, NOT FROM AN OLDER FILE ────────────────
-- The newest notify_module_waitlist is 20261066's (admin guard + notifications.type), the
-- newest module_notif_text is 20261015's — and NOTIFY_SQL still pointed at 20261015, whose
-- RPC is superseded: copying it would have reverted 20261066 with no error. Both bodies below
-- are pg_get_functiondef() read from production on 2026-10-10 (supabase/readonly/
-- notify_functions_def.sql, run 38065685119; md5 module_notif_text 4b3508cd…,
-- notify_module_waitlist a120a838…), with ONLY these additions:
--   • module_notif_text: nine ('duyurular', <lang>, <name>) rows + the English fallback row.
--     Names = the app's menuDuyurular in each locale (all nine, like homeServices: a one-word
--     noun, reviewed, not generated).
--   • notify_module_waitlist: 'duyurular' appended to the module allow-list.
-- The assertion block proves it: each new body minus exactly those additions has the md5 the
-- live body had. If production changed since that read, this file aborts instead of reverting it.
--
-- WHO CAN CALL WHAT: unchanged. CREATE OR REPLACE keeps the existing ACL; anon still has no
-- EXECUTE on notify_module_waitlist (20261034) and the admin-only guard inside it is untouched.
--
-- Apply: gh workflow run supabase-migrate -f file=20261104_duyurular_waitlist_notify.sql (dry),
-- then -f apply=true. No table shape changes, so no NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Refuse to replace a body that is not the one read on 2026-10-10.
DO $$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.module_notif_text(text,text,text)'))) IS DISTINCT FROM '4b3508cd2db62485ef8e3c2bb0650ff0' THEN
    RAISE EXCEPTION 'module_notif_text changed since 2026-10-10 (md5 %); rebuild this file from the live definition',
      md5(pg_get_functiondef(to_regprocedure('public.module_notif_text(text,text,text)')));
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.notify_module_waitlist(text)'))) IS DISTINCT FROM 'a120a838b6dbd480ae07ebfa39884016' THEN
    RAISE EXCEPTION 'notify_module_waitlist changed since 2026-10-10 (md5 %); rebuild this file from the live definition',
      md5(pg_get_functiondef(to_regprocedure('public.notify_module_waitlist(text)')));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.module_notif_text(p_key text, p_module text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
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
        ('checkins','Turkish','Buradayım'),

        ('duyurular','English','Notices'),
        ('duyurular','Turkish','Duyurular'),
        ('duyurular','Arabic','الإعلانات'),
        ('duyurular','Russian','Объявления'),
        ('duyurular','Greek','Ανακοινώσεις'),
        ('duyurular','French','Annonces'),
        ('duyurular','Spanish','Anuncios'),
        ('duyurular','German','Mitteilungen'),
        ('duyurular','Persian','اطلاعیه‌ها')
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
        ('checkins','Check-ins'),
        ('duyurular','Notices')
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
  -- ⚠ THE GUARD THAT LET THE INTERNET IN, AND WHY IT READ AS CORRECT.
  --   It used to be `IF auth.uid() IS NOT NULL AND NOT is_admin()`, with a comment saying
  --   "postgres in the SQL editor (uid null) passes". That is true, and it is also true of
  --   the `anon` role: a request with no JWT has auth.uid() NULL too. The test was written
  --   to describe ONE caller and it matched TWO, one of which is the open internet.
  --
  --   current_setting('role') is what tells them apart. PostgREST does SET ROLE per
  --   request from the validated JWT (or the anon role when there is none), and that GUC
  --   survives SECURITY DEFINER — unlike current_user, which inside this function is the
  --   OWNER and therefore says 'postgres' no matter who called. Measured in PGlite:
  --       as anon           current_user=postgres  role=anon
  --       as authenticated  current_user=postgres  role=authenticated
  --       no SET ROLE       current_user=postgres  role=none
  --
  --   Written as a DENY LIST on purpose. An allow-list of what the SQL editor reports
  --   would be a guess about somebody else's connection string, and being wrong about it
  --   breaks go-live step 10 at the moment it is needed. Denying the two roles PostgREST
  --   can possibly be in cannot break the editor, and the NOTICE below prints the real
  --   value so the next person does not have to guess either.
  --
  --   ⚠ THIS IS DEFENCE IN DEPTH, NOT THE FIX. The fix is the REVOKE below: anon cannot
  --     call what it has no EXECUTE on. This guard is what holds if that grant is ever
  --     restored by a default-privilege change or a careless GRANT ... TO anon.
  IF NOT is_admin()
     AND coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'notify_module_waitlist: admin only (role=%)',
      coalesce(current_setting('role', true), 'none');
  END IF;

  -- Validate against the module keys MODULE_FLAGS declares. The module_waitlist CHECK
  -- itself is only a shape guard (^[a-zA-Z]{2,40}$ since 20260814), so THIS list is the
  -- only thing that rejects a typo'd module name.
  IF p_module NOT IN ('homeServices','grooming','garages','transport',
                      'insurance','pets','events','jobs','accommodation',
                      'explore','studentHub','towing','checkins','duyurular') THEN
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

    INSERT INTO notifications (user_id, title, body, type) VALUES (r.user_id, ttl, bdy, 'waitlist');
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

DO $$
DECLARE
  v_txt text := pg_get_functiondef(to_regprocedure('public.module_notif_text(text,text,text)'));
  v_ntf text := pg_get_functiondef(to_regprocedure('public.notify_module_waitlist(text)'));
BEGIN
  -- Nothing but the additions changed.
  IF md5(replace(replace(v_txt, $x$,

        ('duyurular','English','Notices'),
        ('duyurular','Turkish','Duyurular'),
        ('duyurular','Arabic','الإعلانات'),
        ('duyurular','Russian','Объявления'),
        ('duyurular','Greek','Ανακοινώσεις'),
        ('duyurular','French','Annonces'),
        ('duyurular','Spanish','Anuncios'),
        ('duyurular','German','Mitteilungen'),
        ('duyurular','Persian','اطلاعیه‌ها')$x$, ''), $x$,
        ('duyurular','Notices')$x$, '')) IS DISTINCT FROM '4b3508cd2db62485ef8e3c2bb0650ff0' THEN
    RAISE EXCEPTION 'module_notif_text differs from the live body by more than the duyurular rows';
  END IF;
  IF md5(replace(v_ntf, ',''duyurular'')', ')')) IS DISTINCT FROM 'a120a838b6dbd480ae07ebfa39884016' THEN
    RAISE EXCEPTION 'notify_module_waitlist differs from the live body by more than the allow-list entry';
  END IF;
  -- Behaviour, with a control on each side.
  IF public.module_notif_text('title', 'duyurular', 'Turkish') IS DISTINCT FROM 'ADA''da yeni: Duyurular' THEN
    RAISE EXCEPTION 'Turkish title: %', public.module_notif_text('title', 'duyurular', 'Turkish');
  END IF;
  IF public.module_notif_text('body', 'duyurular', 'German') NOT LIKE '%Mitteilungen%' THEN
    RAISE EXCEPTION 'German body: %', public.module_notif_text('body', 'duyurular', 'German');
  END IF;
  IF public.module_notif_text('title', 'duyurular', 'Japanese') IS DISTINCT FROM 'New on ADA: Notices' THEN
    RAISE EXCEPTION 'fallback title: %', public.module_notif_text('title', 'duyurular', 'Japanese');
  END IF;
  IF public.module_notif_text('title', 'checkins', 'Turkish') IS DISTINCT FROM 'ADA''da yeni: Buradayım' THEN
    RAISE EXCEPTION 'CONTROL FAILED: checkins title changed: %', public.module_notif_text('title', 'checkins', 'Turkish');
  END IF;
  IF v_ntf NOT LIKE '%NOT is_admin()%' OR v_ntf NOT LIKE '%''waitlist''%' THEN
    RAISE EXCEPTION 'notify_module_waitlist lost its admin guard or its notification type';
  END IF;
  IF has_function_privilege('anon', 'public.notify_module_waitlist(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can EXECUTE notify_module_waitlist';
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
VALUES ('20261104_duyurular_waitlist_notify.sql', '7374e8691b509e1bede840764f7ef7e95b880da90edbd171f9c605a719917b2f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
