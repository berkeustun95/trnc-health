-- ── Provider Verification & Credentials Migration ────────────────────────────

-- 1. Add rejection_reason to existing approval tables
ALTER TABLE facility_change_requests ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE claim_requests ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Provider identity documents (uploaded during onboarding)
CREATE TABLE IF NOT EXISTS provider_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     uuid REFERENCES facilities(id) ON DELETE CASCADE,
  provider_id     uuid REFERENCES profiles(id)   ON DELETE CASCADE,
  doc_type        text NOT NULL, -- 'medical_license' | 'registration_cert' | 'business_license' | 'national_id'
  document_url    text NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  rejection_reason text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE provider_documents ENABLE ROW LEVEL SECURITY;

-- Providers can insert and read their own documents
CREATE POLICY "provider_documents_provider_insert" ON provider_documents
  FOR INSERT WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "provider_documents_provider_select" ON provider_documents
  FOR SELECT USING (auth.uid() = provider_id);

-- Admins can read and update all documents
CREATE POLICY "provider_documents_admin_select" ON provider_documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "provider_documents_admin_update" ON provider_documents
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. Provider credentials (diplomas, certificates)
CREATE TABLE IF NOT EXISTS provider_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     uuid REFERENCES facilities(id) ON DELETE CASCADE,
  provider_id     uuid REFERENCES profiles(id)   ON DELETE CASCADE,
  cred_type       text NOT NULL, -- 'diploma' | 'certificate'
  title           text NOT NULL,
  institution     text NOT NULL,
  year            integer,
  document_url    text,
  status          text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  rejection_reason text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;

-- Providers can insert and read their own credentials
CREATE POLICY "provider_credentials_provider_insert" ON provider_credentials
  FOR INSERT WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "provider_credentials_provider_select" ON provider_credentials
  FOR SELECT USING (auth.uid() = provider_id);

-- Admins can read and update all credentials
CREATE POLICY "provider_credentials_admin_select" ON provider_credentials
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "provider_credentials_admin_update" ON provider_credentials
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Customers can read approved credentials (for facility profile display)
CREATE POLICY "provider_credentials_public_select" ON provider_credentials
  FOR SELECT USING (status = 'approved');

-- Storage buckets (run these manually in Supabase dashboard or via CLI)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('provider-documents', 'provider-documents', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('provider-credentials', 'provider-credentials', false);
--
-- Storage policies for provider-documents (non-public, providers upload own, admins read all):
-- CREATE POLICY "providers upload own docs" ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'provider-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "providers read own docs" ON storage.objects FOR SELECT
--   USING (bucket_id = 'provider-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "admins read all docs" ON storage.objects FOR SELECT
--   USING (bucket_id = 'provider-documents' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
--
-- Storage policies for provider-credentials (same pattern):
-- CREATE POLICY "providers upload cred docs" ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'provider-credentials' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "providers read own cred docs" ON storage.objects FOR SELECT
--   USING (bucket_id = 'provider-credentials' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "public read approved cred docs" ON storage.objects FOR SELECT
--   USING (bucket_id = 'provider-credentials');
