-- ─── Events feature migration ────────────────────────────────────────────────
-- Run this in Supabase SQL Editor
--
-- Safe to re-run: the table uses CREATE TABLE IF NOT EXISTS (its inline CHECK
-- constraints ride along only on first create), the bucket insert uses
-- ON CONFLICT DO NOTHING, and every policy is dropped-then-created. Postgres has
-- no CREATE POLICY IF NOT EXISTS, so a re-run without the DROPs errors with
-- "policy ... already exists" — hence the drop-then-create on each.

BEGIN;

-- 1. Create events table
CREATE TABLE IF NOT EXISTS events (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organizer_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  organizer_name   text NOT NULL,
  title            text NOT NULL,
  description      text CHECK (char_length(description) <= 500),
  images           text[]        DEFAULT '{}',
  start_date       timestamptz   NOT NULL,
  end_date         timestamptz,
  location         text,
  location_url     text,
  status           text          DEFAULT 'draft'
                   CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at       timestamptz   DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- 3. Policy: any authenticated user can read approved events
DROP POLICY IF EXISTS "read approved events" ON events;
CREATE POLICY "read approved events"
  ON events FOR SELECT
  TO authenticated
  USING (status = 'approved');

-- 4. Policy: organizer can manage their own events (all statuses)
DROP POLICY IF EXISTS "organizer manage own events" ON events;
CREATE POLICY "organizer manage own events"
  ON events FOR ALL
  TO authenticated
  USING  (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

-- 5. Policy: admin can manage all events
DROP POLICY IF EXISTS "admin manage all events" ON events;
CREATE POLICY "admin manage all events"
  ON events FOR ALL
  TO authenticated
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 6. Create Storage bucket for event images
-- (Do this in Supabase Dashboard → Storage → New bucket)
-- Name: event-images
-- Public: YES
-- Run the SQL below to set public access policy on the bucket:

INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public read event images" ON storage.objects;
CREATE POLICY "public read event images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

DROP POLICY IF EXISTS "authenticated upload event images" ON storage.objects;
CREATE POLICY "authenticated upload event images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'event-images');

-- Path layout is events/{uid}/{file}, so the uid is folder segment [2], not [1].
DROP POLICY IF EXISTS "organizer delete own event images" ON storage.objects;
CREATE POLICY "organizer delete own event images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'event-images' AND (storage.foldername(name))[2] = auth.uid()::text);

COMMIT;
