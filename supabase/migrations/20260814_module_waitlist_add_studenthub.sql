-- module_waitlist — generalize the module CHECK so new Coming-Soon modules no
-- longer need a per-module DDL migration. Motivated by Student Hub ('studentHub'),
-- which the enumerated CHECK from 20260812 would REJECT → the client "Notify me"
-- upsert fails with 23514 and the button errors on every tap.
--
-- DECISION (widen-forever vs drop-enum): replace the enumerated
--   module IN ('homeServices',…,'accommodation')
-- with a SHAPE guard — non-empty, identifier-like, bounded length. The
-- authoritative module vocabulary already lives in two places the enum duplicated:
--   • the client MODULE_FLAGS / ComingSoonScreen moduleKey (what can ever be SENT), and
--   • notify_module_waitlist()'s own `p_module NOT IN (…)` guard (what can ever be
--     BLASTED at go-live).
-- The enum here was a redundant third copy that cost a migration per module. The
-- shape guard still rejects '', whitespace, and oversized/garbage values.
-- TRADE-OFF ACCEPTED: a well-formed typo ('studenthub' vs 'studentHub') is no
-- longer caught at the column — only by the client + the RPC guard. Worth it for a
-- low-stakes demand-capture table. This is intended to be the LAST constraint
-- migration for module_waitlist.
--
-- Additive & idempotent: DROP … IF EXISTS then ADD, with no assumption about prior
-- state — works whether 20260812's enum, an earlier widen, or nothing is present.
-- The constraint keeps its name (module_waitlist_module_check), so verify_schema
-- registers this BEHAVIOR change via an H-token (existence-by-name can't tell the
-- old enum body from this one). Apply with the SQL editor Role dropdown = postgres.

BEGIN;

ALTER TABLE public.module_waitlist
  DROP CONSTRAINT IF EXISTS module_waitlist_module_check;

ALTER TABLE public.module_waitlist
  ADD CONSTRAINT module_waitlist_module_check
  CHECK (module ~ '^[a-zA-Z]{2,40}$');

COMMIT;

-- No new column/table, so a PostgREST reload isn't strictly required (the CHECK is
-- enforced in Postgres regardless). Kept for parity with the table's own reload
-- discipline; harmless.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   -- new key now accepted:
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(),'studentHub')
--     ON CONFLICT DO NOTHING;                     -- succeeds
--   -- an existing key still accepted:
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(),'grooming')
--     ON CONFLICT DO NOTHING;                     -- succeeds
--   -- malformed values still rejected:
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(),'');         -- ERROR 23514
--   INSERT INTO module_waitlist (user_id, module) VALUES (auth.uid(),'a b/c!');   -- ERROR 23514
--   -- confirm the new definition (should show the ~ regex, NOT IN(...)):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'module_waitlist_module_check';
--
-- ── Rollback (restore the 20260812 enum, incl. studentHub) ───────────────────
--   ALTER TABLE public.module_waitlist DROP CONSTRAINT IF EXISTS module_waitlist_module_check;
--   ALTER TABLE public.module_waitlist ADD CONSTRAINT module_waitlist_module_check
--     CHECK (module IN ('homeServices','grooming','garages','transport',
--                       'insurance','pets','events','jobs','accommodation','studentHub'));
--   NOTIFY pgrst, 'reload schema';
