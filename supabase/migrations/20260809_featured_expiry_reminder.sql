-- ─── Slice 3b — Featured expiry reminder (generic, facilities table) ──────────
-- Sends the featured OWNER a localized reminder a few days BEFORE their featured
-- placement expires, so they can arrange an extension. Additive to Slice 3a:
-- does NOT touch derived-expiry (featured_until > now() still auto-drops with no
-- cron) — this only ADDS an outbound reminder, which genuinely needs a scheduled
-- job (nothing else fires pre-expiry).
--
-- DEDUPE ACROSS PERIODS: featured_reminded_at guards one reminder per period. The
-- predicate re-arms itself when a NEW/extended period pushes featured_until out
-- (reminded_at falls >3d before the new expiry), and the admin activation path
-- also nulls it on activate/extend — belt and suspenders.
--
-- ANTI-STEERING (iOS 3.1.1): reminder copy carries NO price/amount/payment word —
-- date only, "get in touch to keep it" (mirrors 3a's request wording).
--
-- LOCALIZED SERVER-SIDE: cron has no client t(); featured_notif_text() resolves
-- the recipient owner's preferred_language (9 locales, English fallback), mirroring
-- grooming_notif_text and the just-shipped push localization.
--
-- Additive/idempotent (ADD COLUMN IF NOT EXISTS = metadata-only; CREATE OR REPLACE;
-- unschedule-then-schedule). Apply with Role dropdown = postgres BEFORE the OTA.

BEGIN;

-- ─── 1. Dedupe column (admin-only, like featured_until) ──────────────────────
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS featured_reminded_at timestamptz;

COMMENT ON COLUMN public.facilities.featured_reminded_at IS
  'Admin-only. Set by process_featured_expiring() when the pre-expiry reminder is sent; nulled on activate/extend. Guards one reminder per featured period.';

-- ─── 2. Guard: featured_reminded_at admin-only ───────────────────────────────
-- Live 20260808 body reproduced verbatim + ONE new flagged block. Cron writes it
-- with auth.uid() null → the null-uid early-return lets it through; admin bypasses
-- via is_admin_user; an owner direct update is blocked.
CREATE OR REPLACE FUNCTION public.facilities_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  if current_setting('app.trusted_facility_write', true) = '1' then
    return new;
  end if;

  if auth.uid() is null then return new; end if;
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin')
    into is_admin_user;
  if is_admin_user then return new; end if;
  if new.verified is distinct from old.verified then
    raise exception 'facilities: verified is admin-only'; end if;
  if new.status is distinct from old.status then
    raise exception 'facilities: status is admin-only'; end if;
  if new.is_public is distinct from old.is_public then
    raise exception 'facilities: is_public is admin-only'; end if;
  if new.provider_id is distinct from old.provider_id then
    raise exception 'facilities: provider_id is immutable'; end if;
  if new.membership_tier is distinct from old.membership_tier then
    raise exception 'facilities: membership_tier is admin-only'; end if;
  if new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'facilities: trial_ends_at is admin-only'; end if;

  if new.featured_until is distinct from old.featured_until then
    raise exception 'facilities: featured_until is admin-only'; end if;
  if new.featured_requested_at is distinct from old.featured_requested_at then
    raise exception 'facilities: featured_requested_at is set via request_featured_facility'; end if;

  -- NEW (Slice 3b): reminder-dedupe timestamp is admin-only. Cron sets it with a
  -- null auth.uid() (early-returns above); an owner must never touch it.
  if new.featured_reminded_at is distinct from old.featured_reminded_at then
    raise exception 'facilities: featured_reminded_at is admin-only'; end if;

  -- Garage material-field lock (20260802) — unchanged.
  if old.type = 'garage' then
    if new.name is distinct from old.name then
      raise exception 'facilities: garage name changes must go through update_garage_facility'; end if;
    if new.service_types is distinct from old.service_types then
      raise exception 'facilities: garage service_types changes must go through update_garage_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: garage address changes must go through update_garage_facility'; end if;
  end if;

  return new;
end $function$;

-- ─── 3. Server-side i18n for the reminder (recipient language, EN fallback) ──
-- Parallel to grooming_notif_text (that fn is grooming-scoped; this reminder is
-- generic across facility types → its own fn, not a lie in a "grooming" name).
-- featTitle / featBody; {date} substituted by the caller. Price-free.
CREATE OR REPLACE FUNCTION public.featured_notif_text(p_key text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT coalesce(
    (SELECT txt FROM (VALUES
      ('featTitle','English','Featured placement ending soon'),
      ('featTitle','Turkish','Öne çıkarma süreniz doluyor'),
      ('featTitle','Arabic','الظهور المميّز على وشك الانتهاء'),
      ('featTitle','Russian','Продвижение скоро заканчивается'),
      ('featTitle','Greek','Η προβολή σας λήγει σύντομα'),
      ('featTitle','French','Votre mise en avant se termine bientôt'),
      ('featTitle','Spanish','Tu destacado termina pronto'),
      ('featTitle','German','Deine Hervorhebung endet bald'),
      ('featTitle','Persian','برجسته‌سازی شما به‌زودی پایان می‌یابد'),

      ('featBody','English','Your featured placement expires on {date}. Get in touch to keep it.'),
      ('featBody','Turkish','Öne çıkarma süreniz {date} tarihinde sona eriyor. Devam ettirmek için bizimle iletişime geçin.'),
      ('featBody','Arabic','ينتهي ظهورك المميّز في {date}. تواصل معنا للاستمرار.'),
      ('featBody','Russian','Ваше продвижение заканчивается {date}. Свяжитесь с нами, чтобы продлить.'),
      ('featBody','Greek','Η προβολή σας λήγει στις {date}. Επικοινωνήστε μαζί μας για να τη διατηρήσετε.'),
      ('featBody','French','Votre mise en avant se termine le {date}. Contactez-nous pour la conserver.'),
      ('featBody','Spanish','Tu destacado termina el {date}. Ponte en contacto para mantenerlo.'),
      ('featBody','German','Deine Hervorhebung endet am {date}. Melde dich, um sie zu behalten.'),
      ('featBody','Persian','برجسته‌سازی شما در {date} پایان می‌یابد. برای ادامه با ما در تماس باشید.')
    ) AS m(k, l, txt)
    WHERE m.k = p_key AND m.l = coalesce(p_lang, 'English')),
    (SELECT txt FROM (VALUES
      ('featTitle','Featured placement ending soon'),
      ('featBody','Your featured placement expires on {date}. Get in touch to keep it.')
    ) AS f(k, txt) WHERE f.k = p_key)
  );
$function$;

-- ─── 4. Reminder processor: one nudge ≤3d before expiry, per period ──────────
CREATE OR REPLACE FUNCTION public.process_featured_expiring() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  r     record;
  tok   text;
  plang text;
  ttl   text;
  bdy   text;
BEGIN
  FOR r IN
    SELECT f.id, f.name, f.provider_id, f.featured_until
    FROM facilities f
    WHERE f.featured_until IS NOT NULL
      AND f.featured_until >  now()
      AND f.featured_until <= now() + interval '3 days'
      AND f.provider_id IS NOT NULL
      -- Not yet reminded THIS period. A new/extended featured_until pushes the
      -- threshold past the old reminded_at → self-re-arms even without the
      -- activation-path reset.
      AND (f.featured_reminded_at IS NULL
           OR f.featured_reminded_at < f.featured_until - interval '3 days')
  LOOP
    UPDATE facilities SET featured_reminded_at = now() WHERE id = r.id;

    SELECT push_token, preferred_language INTO tok, plang
      FROM profiles WHERE id = r.provider_id;
    ttl := featured_notif_text('featTitle', plang);
    bdy := replace(featured_notif_text('featBody', plang), '{date}',
                   to_char(r.featured_until, 'DD/MM/YYYY'));

    INSERT INTO notifications (user_id, title, body) VALUES (r.provider_id, ttl, bdy);
    IF tok IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END LOOP;
END;
$function$;

COMMIT;

-- ─── 5. Schedule daily (outside txn; unschedule-then-schedule = idempotent) ──
DO $$
BEGIN
  PERFORM cron.unschedule('featured-expiry-reminder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
SELECT cron.schedule('featured-expiry-reminder', '0 9 * * *',
  $$ SELECT process_featured_expiring(); $$);

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- (i) Cron job registered:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='featured-expiry-reminder';
--   -- expect: featured-expiry-reminder | 0 9 * * * | t
--
--   -- (ii) Dry run is safe/idempotent (no featured rows in-window → no-op):
--   SELECT process_featured_expiring();
--
--   -- (iii) i18n resolves + falls back:
--   SELECT featured_notif_text('featTitle','Turkish');   -- 'Öne çıkarma süreniz doluyor'
--   SELECT featured_notif_text('featBody','Klingon');    -- English fallback
--
--   -- (iv) Guard regression — as a non-admin owner, this must FAIL (admin-only):
--   UPDATE facilities SET featured_reminded_at = now() WHERE provider_id = auth.uid();
--   -- and 3a locks still hold:
--   UPDATE facilities SET featured_until = now() + interval '30 days' WHERE provider_id = auth.uid(); -- FAILS
--   UPDATE facilities SET description = 'x' WHERE provider_id = auth.uid();                            -- OK (minor edit)

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   DO $$ BEGIN PERFORM cron.unschedule('featured-expiry-reminder'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
--   DROP FUNCTION IF EXISTS public.process_featured_expiring();
--   DROP FUNCTION IF EXISTS public.featured_notif_text(text, text);
--   ALTER TABLE public.facilities DROP COLUMN IF EXISTS featured_reminded_at;
--   -- then restore facilities_guard_update() body from 20260808_facility_featured_tier.sql
