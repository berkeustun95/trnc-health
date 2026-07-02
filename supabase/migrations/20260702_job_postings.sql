-- ─── Job Postings Module — Slice 1: Schema + RLS ─────────────────────────────
-- v1: free, self-post listings board. No payment, no employer accounts.
--
-- Forward-compat notes for v2:
--   - owner_id is the posting user (auth.users FK). No UNIQUE constraint — a
--     single user may post multiple jobs, and a future employers table will
--     group postings via employer_id FK (add that column in v2, not here).
--   - status enum already includes 'filled' and 'expired' for v2 tooling.
--   - Paid posting tiers ship together with employer accounts (v2 scope).

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE job_postings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES auth.users(id),   -- nullable for admin-added
  job_title        TEXT NOT NULL,
  employer_name    TEXT NOT NULL,
  category         TEXT NOT NULL,
  employment_type  TEXT NOT NULL DEFAULT 'full_time'
                     CHECK (employment_type IN ('full_time', 'part_time', 'seasonal', 'temporary')),
  salary           TEXT,                             -- nullable; free-form ("€1200/mo", "Negotiable")
  description      TEXT,
  district         TEXT NOT NULL
                     CHECK (district IN ('nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz')),
  phone            TEXT,
  whatsapp         TEXT,
  contact_pref     TEXT NOT NULL DEFAULT 'whatsapp'
                     CHECK (contact_pref IN ('call', 'whatsapp', 'both')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'rejected', 'filled', 'expired')),
  rejection_reason TEXT,
  expires_at       TIMESTAMPTZ,                      -- NULL until admin approves; set to now()+30d on approval
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Supports owner's own-listings queries and future employer_id grouping
CREATE INDEX job_postings_owner_idx         ON job_postings (owner_id);
-- Supports the hot-path public board query
CREATE INDEX job_postings_board_idx         ON job_postings (status, expires_at);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Who can read what (plain English):
--   • Anyone (logged-in or not): active listings that have not yet expired
--   • The poster:               their own rows at any status (for their dashboard)
--   • Admin:                    everything
-- A poster's own pending/filled/expired rows are visible to them via their
-- dashboard query, but the public board screen applies an explicit app-level
-- filter (status='active' AND expires_at > now()) so their rows never appear
-- in the public list even when they are logged in.

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jp_select" ON job_postings FOR SELECT
  USING (
    (status = 'active' AND expires_at IS NOT NULL AND expires_at > now())
    OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Any authenticated user can post (no unique constraint — multiple jobs per user ok).
CREATE POLICY "jp_insert_self" ON job_postings FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Owner can edit their own listing (incl. marking it filled).
-- Admin can approve (→ active + expires_at), reject (+ reason), or edit anything.
CREATE POLICY "jp_update_self" ON job_postings FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Hard delete: admin only.
CREATE POLICY "jp_delete_admin" ON job_postings FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
