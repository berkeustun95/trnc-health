-- ─── Events feature migration ────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

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
CREATE POLICY "read approved events"
  ON events FOR SELECT
  TO authenticated
  USING (status = 'approved');

-- 4. Policy: organizer can manage their own events (all statuses)
CREATE POLICY "organizer manage own events"
  ON events FOR ALL
  TO authenticated
  USING  (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

-- 5. Policy: admin can manage all events
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

CREATE POLICY "public read event images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

CREATE POLICY "authenticated upload event images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "organizer delete own event images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'event-images' AND (storage.foldername(name))[1] = auth.uid()::text);
