-- ─── Slice 5 (piece C) — 'explore' (+ 'studentHub') into the go-live waitlist RPCs ──
-- The Explore public tile ships this piece as a Coming Soon gate that upserts
-- module_waitlist rows with module='explore'. That upsert already works (the column's
-- CHECK is the shape-guard ^[a-zA-Z]{2,40}$ from 20260814, and ComingSoonScreen writes
-- direct, no RPC) — so signups collect the moment the tile ships, BEFORE this migration.
-- This migration only gates the go-live BLAST, which the owner runs AFTER the flag flip:
--   1. notify_module_waitlist — add 'explore' to the p_module allow-list guard.
--   2. module_notif_text — add explore's localized display name to the name-map.
--
-- SAME MIGRATION fixes the studentHub asymmetry: 'studentHub' is in MODULE_FLAGS
-- (constants/flags.js) and passes the widened column shape-guard, but was MISSING from
-- BOTH RPCs — so a future studentHub go-live blast would RAISE 'unknown module'. Added
-- here alongside explore.
--
-- 9-LOCALE name-map for BOTH (not the EN+TR of garages/events/pets): the name-map mirrors
-- the app's menu-key coverage, and menuExplore (piece A) + menuStudentHub are BOTH
-- full 9-locale keys — so 9 locales is consistent with the existing design, not an
-- exception. Strings copied verbatim from those menu keys. No apostrophes in any of the
-- 18 new values (the only ''-escapes below are the pre-existing '…''da…' Turkish bodies,
-- preserved verbatim).
--
-- Behavior-only CREATE OR REPLACE of two already-registered functions (no new named
-- object) → verify_schema gets H-section tokens anchored on 'studentHub' (absent from
-- both bodies today, present after — a token on 'explore' would pass pre-apply because
-- the English/Spanish body templates already contain "explore"/"explorar").
--
-- Idempotent; apply with the SQL editor Role dropdown = postgres. No flag flips here.

BEGIN;

-- ── Server-side i18n (module_notif_text) — verbatim 20260813 body + explore/studentHub ──
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
    -- English for the other 7 too), so only their EN+TR rows are listed. explore +
    -- studentHub have full 9-locale menu keys, so all 9 are listed for each.
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

        ('garages','English','Garages'),
        ('garages','Turkish','Oto Servis'),

        ('events','English','Events'),
        ('events','Turkish','Etkinlikler'),

        ('pets','English','Pets & Animals'),
        ('pets','Turkish','Evcil Hayvanlar')
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
        ('studentHub','Student Hub')
      ) AS g(mod, nm) WHERE g.mod = p_module)
    )
  );
$function$;

-- ── Go-live blast (notify_module_waitlist) — verbatim 20260813 body + guard entries ──
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

  -- Curated allow-list (on TOP of the module_waitlist column's shape-guard regex). 'explore'
  -- and 'studentHub' added here (the latter closes a pre-existing asymmetry: it was in
  -- MODULE_FLAGS + passed the shape-guard but was missing from this list, so a blast would raise).
  IF p_module NOT IN ('homeServices','grooming','garages','transport',
                      'insurance','pets','events','jobs','accommodation',
                      'explore','studentHub') THEN
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

COMMIT;

-- Behavior-only CREATE OR REPLACE, but NOTIFY anyway (harmless; keeps the ritual uniform).
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────────────
--   -- explore + studentHub display names resolve (9 locales) + fall back:
--   SELECT module_notif_text('title','explore','Turkish');      -- 'ADA''da yeni: Keşfet'
--   SELECT module_notif_text('body','studentHub','German');     -- German body, 'Studenten-Hub'
--   SELECT module_notif_text('title','explore','Klingon');      -- English fallback: 'New on ADA: Explore'
--   -- guard now KNOWS both — check it SIDE-EFFECT-FREE (do NOT fire the blast to "test" this):
--   SELECT pg_get_functiondef('public.notify_module_waitlist(text)'::regprocedure) ILIKE '%studentHub%'; -- t
--   -- a genuinely unknown module still raises (safe — it errors BEFORE touching any row):
--   SELECT notify_module_waitlist('nope');                      -- ERROR: unknown module nope
--   -- ⚠️ NEVER run notify_module_waitlist('explore') or ('studentHub') as a check: it EXECUTES the
--   --    blast — pushes "now live" to everyone on that waitlist and stamps notified_at, silently
--   --    excluding them from the REAL launch. Run 'explore' exactly ONCE, AFTER the flag flip.
--   --    'studentHub' stays dark (no flip planned) — leave it unrun.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────────────
--   -- Restore both function bodies from 20260813_notify_module_waitlist.sql
--   -- (drops 'explore'/'studentHub' from the guard + name-map). Then:
--   NOTIFY pgrst, 'reload schema';
