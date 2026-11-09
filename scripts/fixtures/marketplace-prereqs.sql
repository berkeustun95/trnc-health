-- Prerequisites the marketplace migrations (20261168-20261170) build on, beyond messaging-live.sql:
--   • Araçlar S1 as its files read on 2026-11-07 (~/trnc-health-araclar, db/araclar-schema 69e446c):
--     private.is_adult_on (20261164), the 8-value content_reports_content_type_check and the auto-hide body
--     with the vehicle branch (20261166) — copied VERBATIM; the md5 of the auto-hide body is what 20261168's
--     pre-flight demands (760dc1de…).
--   • content_reports reason check as live (probe 42413063083); notifications_type_check as 20261175 left it ('weekend').
--   • Supabase Storage, minimally: storage.buckets, storage.objects (RLS on), storage.foldername() as Supabase
--     defines it. NOT modelled: the Storage API, protect_delete, signed URLs.
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.is_adult_on(p_dob date, p_today date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT p_dob IS NOT NULL AND p_today IS NOT NULL
     AND p_dob <= (p_today - interval '18 years')::date  -- ADULT_AGE
$function$;

ALTER TABLE public.content_reports ADD COLUMN IF NOT EXISTS details text;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('answer','facility','message','place','profile','question','review','vehicle'));
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_reason_check
  CHECK ((reason = ANY (ARRAY['offensive'::text, 'harassment'::text, 'spam'::text, 'false_info'::text, 'other'::text])));
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_unique UNIQUE (reporter_id, content_type, content_id);
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_reports FROM PUBLIC, anon, authenticated;
GRANT INSERT (reporter_id, content_type, content_id, reason, details) ON public.content_reports TO authenticated;
CREATE POLICY reports_insert_own ON public.content_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND NOT is_anonymous_session());
CREATE OR REPLACE FUNCTION auto_hide_reported_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM content_reports
  WHERE content_type = NEW.content_type AND content_id = NEW.content_id;

  IF v_count < 3 THEN RETURN NEW; END IF;

  IF NEW.content_type = 'review' THEN
    UPDATE reviews    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'question' THEN
    UPDATE questions  SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'answer' THEN
    UPDATE answers    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'facility' THEN
    UPDATE facilities SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'place' THEN
    UPDATE places     SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'vehicle' THEN
    UPDATE vehicles   SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER auto_hide_on_report AFTER INSERT ON public.content_reports FOR EACH ROW EXECUTE FUNCTION auto_hide_reported_content();

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK ((type = ANY (ARRAY['duty'::text, 'message'::text, 'waitlist'::text, 'question'::text, 'admin_alert'::text, 'admin_message'::text, 'featured'::text, 'general'::text, 'weekend'::text])));

CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON storage.objects TO authenticated;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $f$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated;
-- One pre-existing policy on another bucket, so the "+2" assertion is measured against a non-zero baseline.
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', false);
CREATE POLICY "avatars own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);
