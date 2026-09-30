# Database rules (supabase/, SQL, RLS, migrations)

Read with the root CLAUDE.md, whose "Verification principles" (numbered) apply here in full.
Incident backstories: `~/ObsidianVault/10-ada/claude-md-lessons.md`.

## RLS and storage policies
- RLS is the security boundary; every user-data table has RLS on. Explain every policy you write in
  plain English: who can read/write what.
- ⚠ **No RLS or storage policy changes through the Supabase dashboard. Migrations only.** A dashboard
  policy exists nowhere in the repo, so a rebuild yields a different security posture and
  `verify_schema.sql` cannot see it.
- **A DO block asserts the FULL policy set for the object it touches, never just its own.** RLS is
  permissive-OR: presence of mine never proves absence of theirs. Assert `count(*)` of every policy
  reaching the object, PRINT the names, and assert no permissive policy is bucket-unscoped (an
  expression never mentioning `bucket_id` applies to every bucket).
- **Test the role the claim is about.** An anon-key probe says nothing about `authenticated`.
  `authenticated` includes every guest; `TO authenticated` does not exclude them, only
  `NOT is_anonymous_session()` does. Without a JWT, `has_table_privilege` / `has_column_privilege`
  answer for a named role and resolve inherited grants a grantee-filtered count cannot see.
- **Every denial assertion has a positive control beside it** ("and the legitimate path still works",
  e.g. a signed URL still resolves), or the suite scores full marks on a bucket nobody can read.
- For a bucket with `public = true`, Storage serves reads without evaluating RLS; only a private
  bucket makes its SELECT policy load-bearing.
- To test behaviour against live data without writing: `BEGIN; SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":…}'; <call>; ROLLBACK;`. `RESET ROLE` (or count as
  postgres) before verifying a write the role cannot read.
- A migration file is intent, not evidence. `pg_get_functiondef`, `pg_get_constraintdef`,
  `pg_policies`, `information_schema` are the authority; quote which one you read.

## Migrations (manual apply, no CI)
- Applied by hand in the SQL editor (Role → postgres); nothing catches a committed-but-unapplied file.
- **Register every new object in `supabase/verify_schema.sql`** (A tables · B columns · C functions ·
  D triggers · E constraints · F indexes · G grants · H tokens · Q2 cron · Q3 policies). A
  behaviour-only `CREATE OR REPLACE`, a changed DEFAULT, grant or comment needs an H-section token.
  Run the script after applying; the first row of QUERY 1 is the verdict.
- **Every ADD COLUMN migration ends with `NOTIFY pgrst, 'reload schema';`** after `RESET ROLE;`, or
  PostgREST reports 42703 for a column that exists.
- **Prefixes are SEQUENCE NUMBERS, not dates.** Next file: `npm run migration:next` (highest prefix on
  any local or origin/* branch + 1), never today's date or `ls | tail -1`. The pre-push guard
  `check-migration-numbers.mjs` blocks duplicate prefixes. A filename says nothing about when it was
  written or applied; the only applied date is `schema_migrations_applied.applied_at`.
- **An applied migration lands on MAIN the same day, as a file:** `git checkout <branch> -- <file>`
  onto a branch off main (never cherry-pick a commit carrying app code), with `verify_schema.sql`
  merged and the ledger check + drift audit REGENERATED. Main's migrations folder = prod's ledger.
- **Wrap every manual-apply migration in `BEGIN … COMMIT` with its assertions INSIDE**, even for one
  line: a false alarm then rolls back cleanly and is re-runnable.
- **The harness is not prod's Postgres.** `scripts/migration-harness.mjs` is PGlite = PostgreSQL 18.3;
  prod is an older major (`SELECT version();`). In any in-migration `EXCEPTION WHEN`, catch every
  SQLSTATE the behaviour can raise across versions (`foreign_key_violation OR restrict_violation`).
  A harness pass is evidence about PG 18 only; check error codes, `pg_get_*def` renderings and
  planner/locking behaviour against prod output before a token relies on them.
- **An applied migration file is never edited.** Corrections go in `verify_schema.sql` or a new file.
- Pre-launch tables DEFAULT to unpublished (`is_active DEFAULT false`); register the DEFAULT as an H
  token — a reverted DEFAULT creates no named object.

## SQL editor scripts
- ⚠ **A script for the SQL editor must not reference any object it created earlier in the same
  script** (42P01 twice, TEMP and ordinary tables alike; mechanism unconfirmed, not worth confirming
  in prod). Write ONE statement that creates nothing: a `DO` block that accumulates a report in a
  variable and ends with `RAISE EXCEPTION` carrying it. `RAISE NOTICE` is invisible in that editor.
  The abort is the rollback. A healthy run shows red — put the verdict in the first line.

## verify_schema.sql and in-migration assertions
SQL corollaries of the root verification principles:
- **Derive, never name-list** (principle 3): count what IS, print it; bump a count in the same commit
  with a reason. A baseline (e.g. storage.objects' 36) may list names because the set IS the fact.
- **One count, one owner.** When a migration changes a count another token asserts, RETIRE that token
  in the same commit — do not bump it, and do not leave it to go red. Keep only the half that is
  genuinely its own. A known-stale row teaches the reader to skim past the next real MISSING.
- **`pg_get_functiondef()` returns the COMMENTS.** Anchor negatives to a code SHAPE (`FROM
  appointments`, a quoted tuple), never a bare word, and pair each negative with a positive. Never
  delete an explanatory comment to satisfy a check.
- **Prefer readings that need no decoding:** `pg_get_triggerdef()`, never `tgargs::text` (BYTEA, NUL-
  terminated). Write tokens from the live rendering, not the migration file (`BETWEEN` renders as
  `>= … AND <= …`).
- Reach possibly-absent objects via `to_regclass` / `to_regprocedure` / catalogs, never `::regclass`
  or a bare name: QUERY 1 is one statement and a missing name kills the whole report. Use
  `aclexplode(proacl)` where `has_function_privilege` would raise on an absent function.
  `COALESCE(…, false)` around `bool_and` / subqueries, since NULL does not fire.
- `IS DISTINCT FROM` in every assertion where NULL is reachable (principle 11).
- **A verification block that mutates real rows picks rows it cannot damage and restores what it
  captured, not what it assumes** — files are written re-runnable, so the second apply must be safe.
- **A scripted edit to a large SQL file needs a STRUCTURAL check:** strip comments and literals, count
  parens, scan for a `)` followed by content or adjacent tuple lines missing a comma.
- **`terms:check` passing means a migration FILE exists, not that it is applied** (it scans
  `supabase/migrations/` as text). Only running `verify_schema.sql` closes that gap — same for every
  repo-side guard (principle 9).
- Shape checks do not catch expired content (see root: staleness checks).

## Moderation SQL
- **The word filter has two halves that must agree character-for-character:** `contains_blocked_term()`
  (boundary) and `utils/profanity.js` via `utils/moderationNormalize.js` (preview). Change both in
  the same commit, then `npm run moderation:check`.
- `normalize_for_moderation()` handles Turkish capital İ, zero-width/format characters and Arabic
  tatweel, NFC only. Never add accent folding (`göt` would match "got") or `ı→i` folding (`sık sık`
  would match `sik`).
- **Changing `normalize_for_moderation()` changes the display-name uniqueness key.** Recompute in the
  same migration: `UPDATE profiles SET display_name = display_name WHERE display_name IS NOT NULL;`.
- **You cannot log a rejection from the transaction you abort.** The only rollback-surviving sink is
  `RAISE LOG`; `moderation_rejections` is self-reported by the client in a second transaction. Ask
  which transaction any "record the refusal" write lands in. Verify that log via
  `blocked_terms.hit_count`, since the author cannot SELECT their own row.
- `utils/profanity.js` reads the whole `blocked_terms` table; PostgREST `max-rows` is 1000. Loaders
  and probes use `count: 'exact'` against rows received (the total is only in `Content-Range`).

## Other database facts
- `handle_new_user` reads no metadata; a blocked term there would abort the `auth.users` insert.
- `apple_refresh_tokens` cascades with `auth.users`: revoke (`scripts/revoke-apple-token.mjs`) before
  any out-of-app delete.
- `MIN_SIGNUP_AGE` is a trigger (`interval '13 years'`, 20261001), never a CHECK (`CURRENT_DATE` is
  STABLE); `npm run profile:check` compares it to `constants/profileGate.js`.
- `search_content` ignores `MODULE_FLAGS` and must never gain a `student_education` or `messages` arm.
- `min_supported_version`: QUERY 5 of `verify_schema.sql` is the blocking gate; do not change it
  without the two-platform device pass (root, "Store-update popup").
