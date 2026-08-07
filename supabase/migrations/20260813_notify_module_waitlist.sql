-- Slice 3 — module go-live blast: notify_module_waitlist(module)
-- When a marketplace module's MODULE_FLAGS flag is flipped true via OTA, this RPC
-- notifies everyone who tapped "Notify me" on that module's Coming Soon screen
-- (guests + users, per the Slice 2 module_waitlist table) and marks them notified
-- so re-runs are no-ops. Mirrors process_featured_expiring() exactly: SECURITY
-- DEFINER, SET search_path, one in-app notifications row + one Expo push per user
-- via net.http_post, inlined (there is no shared push helper — every processor
-- inlines this same block).
--
-- WHO CAN RUN IT:
--   - SQL editor as postgres (auth.uid() null) → allowed, so I can trigger a
--     go-live blast by hand.
--   - App RPC caller → must be admin (is_admin()); a normal authenticated user is
--     rejected. GRANT EXECUTE TO authenticated only gates PostgREST visibility; the
--     is_admin() body guard is the real check. There is NO is_admin(uuid) overload
--     in this DB — is_admin() reads auth.uid() from the JWT and works unchanged
--     inside this SECURITY DEFINER function (auth.uid() is a per-request GUC, not
--     affected by the definer role switch).
--
-- RE-RUN SAFE: the loop only touches rows with notified_at IS NULL and stamps
-- notified_at = now() as it goes, so a second run of the same module notifies 0.
--
-- GUESTS: anonymous sessions DO get a profiles row (handle_new_user fires for every
-- auth.users insert with no is_anonymous check), so the notifications FK → profiles
-- holds for guests. They usually have no push_token → in-app notification only,
-- which still counts toward the returned total.
--
-- COPY (Option A): generic per-language title/body template with a {module}
-- placeholder, filled with the module's LOCALIZED display name (sourced from the
-- app's own menu* i18n; events/pets/garages are EN+TR only in the app and fall
-- back to English there too, mirrored here). The grammar sits on a head noun
-- ("section"/"bölümü"/"раздел"…) so the inserted name stays in nominative and never
-- has to agree. Price/payment-free (Apple 3.1.1).
--
-- Idempotent: CREATE OR REPLACE both functions; safe to re-run. Apply with the SQL
-- editor Role dropdown = postgres, like every other migration. File is dated 0813
-- so an in-order apply runs AFTER 0812_module_waitlist (the table it depends on).

BEGIN;

-- ── Server-side i18n: fully-composed title/body for a (module, language) ──────
-- key ∈ {'title','body'}. Returns the localized string with the localized module
-- name already substituted. Two coalesce layers each: (lang match → English
-- fallback). IMMUTABLE — pure VALUES, no table reads.
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
        ('accommodation','Accommodations')
      ) AS g(mod, nm) WHERE g.mod = p_module)
    )
  );
$function$;

-- ── Go-live blast for one module ─────────────────────────────────────────────
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

  -- Validate against the same 9 keys the module_waitlist CHECK allows.
  IF p_module NOT IN ('homeServices','grooming','garages','transport',
                      'insurance','pets','events','jobs','accommodation') THEN
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

-- Expose the new RPC to PostgREST immediately, else an admin .rpc() call 404s on a
-- stale schema cache (PGRST202). Same class of gap as the module_waitlist table.
NOTIFY pgrst, 'reload schema';

-- ── Verification / test plan (run after applying, Role = postgres) ───────────
--   -- i18n resolves + falls back:
--   SELECT module_notif_text('title','pets','Turkish');   -- 'ADA''da yeni: Evcil Hayvanlar'
--   SELECT module_notif_text('body','homeServices','Russian'); -- Russian body, «Бытовые услуги»
--   SELECT module_notif_text('title','pets','Klingon');   -- English fallback: 'New on ADA: Pets & Animals'
--   SELECT module_notif_text('title','events','French');  -- events untranslated → 'Nouveau sur ADA : Events'
--
--   -- (a) Seed a waitlist row for yourself, then blast:
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(), 'grooming')
--     ON CONFLICT DO NOTHING;
--   SELECT notify_module_waitlist('grooming');            -- returns 1 (count notified)
--   SELECT notified_at FROM module_waitlist WHERE user_id=auth.uid() AND module='grooming'; -- set
--   SELECT title, body FROM notifications WHERE user_id=auth.uid() ORDER BY created_at DESC LIMIT 1;
--
--   -- (b) Re-run is a no-op (notified_at already set):
--   SELECT notify_module_waitlist('grooming');            -- returns 0, no new notification
--
--   -- (c) Unknown module fails:
--   SELECT notify_module_waitlist('nope');                -- ERROR: unknown module nope
--
--   -- (d) Auth guard — as a non-admin authenticated caller (via the app / a user
--   --     JWT), this must ERROR 'admin only'. As postgres (uid null) it runs.

-- ── Rollback ─────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.notify_module_waitlist(text);
--   DROP FUNCTION IF EXISTS public.module_notif_text(text, text, text);
--   NOTIFY pgrst, 'reload schema';
