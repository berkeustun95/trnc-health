-- ─── Slice 4 — Orphan report: provider_documents / provider_credentials metadata ─
--     rows whose document_url has no backing object in storage.objects.
--
-- PURPOSE: size the re-upload problem. Before the Slice-1 storage policies landed,
-- every provider upload was RLS-rejected. ProviderOnboardingScreen gated its metadata
-- insert on upload success (so provider_documents should have few/no path-orphans),
-- but the OLD ProviderScreen.saveCred() inserted a credential row UNCONDITIONALLY —
-- with document_url = NULL when the upload failed. So expect the credential side to
-- carry NULL-url rows (section 3) rather than dangling paths.
--
-- READ-ONLY. Run in the SQL editor, Role = postgres. There are NO writes here — this
-- only reports; any deletion/repair is a separate, deliberate decision.
--
-- Match key: metadata.document_url stores the object PATH (= storage.objects.name)
-- within its bucket:
--   provider_documents   → bucket 'provider-documents'
--   provider_credentials → bucket 'provider-credentials'
-- An orphan (path form) = a NON-NULL document_url with no matching storage object.

-- ── 1) provider_documents — path present, object missing ─────────────────────
-- (document_url is NOT NULL on this table, so this covers every doc row that points
--  at a file that isn't there.)
SELECT 'provider_documents' AS source, pd.id, pd.provider_id, pd.facility_id,
       pd.doc_type, pd.status, pd.document_url, pd.created_at
FROM provider_documents pd
WHERE pd.document_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'provider-documents' AND o.name = pd.document_url
  )
ORDER BY pd.created_at;

-- ── 2) provider_credentials — path present, object missing ───────────────────
SELECT 'provider_credentials' AS source, pc.id, pc.provider_id, pc.facility_id,
       pc.cred_type, pc.title, pc.status, pc.document_url, pc.created_at
FROM provider_credentials pc
WHERE pc.document_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'provider-credentials' AND o.name = pc.document_url
  )
ORDER BY pc.created_at;

-- ── 3) provider_credentials — NULL document_url (no path at all) ─────────────
-- AMBIGUOUS by design: either a credential intentionally saved without an image, OR
-- the pre-fix saveCred() orphan (row inserted even though the upload failed). Reported
-- separately — eyeball rather than auto-classify. (provider_documents can't appear
-- here: its document_url is NOT NULL.)
SELECT 'provider_credentials_null_url' AS source, pc.id, pc.provider_id, pc.facility_id,
       pc.cred_type, pc.title, pc.status, pc.created_at
FROM provider_credentials pc
WHERE pc.document_url IS NULL
ORDER BY pc.created_at;

-- ── 4) Scale summary (the re-upload counts, one row) ─────────────────────────
SELECT
  (SELECT count(*) FROM provider_documents pd
     WHERE pd.document_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM storage.objects o
         WHERE o.bucket_id='provider-documents' AND o.name = pd.document_url))   AS docs_orphaned_path,
  (SELECT count(*) FROM provider_documents)                                      AS docs_total,
  (SELECT count(*) FROM provider_credentials pc
     WHERE pc.document_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM storage.objects o
         WHERE o.bucket_id='provider-credentials' AND o.name = pc.document_url)) AS creds_orphaned_path,
  (SELECT count(*) FROM provider_credentials pc WHERE pc.document_url IS NULL)    AS creds_null_url,
  (SELECT count(*) FROM provider_credentials)                                    AS creds_total;
