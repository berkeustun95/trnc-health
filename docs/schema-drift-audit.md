# Schema drift audit

Manual-apply migrations have no CI, so nothing catches a file that was committed but
never applied — or applied and then edited. This documents the audit built on 19 Aug
2026, what it found, and the two open process gaps it exposed.

## Headline finding: drift is one-directional

**Every object the repo declares reached the database. Nothing was missing.**

Sections `A` (nullability), `D` (missing column), `E` (missing constraint) and
`G` (missing index) all returned **zero rows** against 390 columns, 153 constraints and
31 indexes.

That is the significant result, and it is not a footnote. It says the `facilities.area`
class of failure — committed, never applied — **does not currently exist anywhere in
this schema**. `facilities.area` itself is present.

Everything that drifted drifted the *other* way: the database holds things the repo does
not describe, because a destructive statement never ran. So the risk to manage is not
"did my migration apply" — it demonstrably did. It is "did the *cleanup half* of my
migration apply", and the answer was no, twice out of twice.

### The pattern

The repo contains exactly **one `DROP COLUMN` and one `RENAME COLUMN`**. Neither took
effect. Every additive migration did.

| Statement | File | Transactional? | Applied? |
|---|---|---|---|
| `DROP COLUMN service_type` | `20260802_garage_booking_details.sql` | **no** — only `SET ROLE`/`RESET ROLE` | **no** |
| `RENAME COLUMN kteb_confirmed → business_verified` | `20260719_claim_rename_and_tax_no.sql` | yes | yes, then undone (see below) |
| `DROP CONSTRAINT appointments_requested_time_future` | `20260719_fix_appointment_time_check.sql` | **yes** | **yes** |

The two `20260719` files are wrapped in `BEGIN`/`COMMIT`; `20260802` is not, and it is
the one whose destructive half is missing while its additive half (`ADD COLUMN
garage_booking_details`) is present. Two destructive DROPs, one transactional and
applied, one not and not — that is evidence for the transaction conclusion, not just an
inference from a single case.

## What survived the audit

| Finding | Mechanism |
|---|---|
| `appointments.service_type` still live | `20260802`'s `DROP` never ran; its `ADD` did. No `BEGIN/COMMIT`, so the halves applied independently |
| `claim_requests.kteb_confirmed` live beside `business_verified` | The rename applied, then `20260719_claim_evidence_and_guard.sql` was **re-run afterwards** and its `ADD COLUMN IF NOT EXISTS kteb_confirmed` recreated the old name |
| `duty_list_date_idx` | Live index created by no migration |
| `facilities_backup_20260718` | 411-row snapshot, no `CREATE TABLE` anywhere, no reader — see below |

All addressed in `supabase/migrations/20260902_capture_schema_drift.sql`.

## Two process fixes

### 1. Wrap destructive statements in `BEGIN`/`COMMIT`

A migration without a transaction applies statement by statement. A truncated paste, a
statement that errors halfway, or a hand that stops after the part that "looks like the
change" all leave the additive half committed and the destructive half missing. That is
`20260802` exactly.

Inside a transaction the same truncation commits nothing.

### 2. `ADD COLUMN IF NOT EXISTS` is not re-run-safe across a later `RENAME`

```sql
-- 20260719_claim_evidence_and_guard.sql
ADD COLUMN IF NOT EXISTS kteb_confirmed boolean NOT NULL DEFAULT false;
-- 20260719_claim_rename_and_tax_no.sql  (later)
RENAME COLUMN kteb_confirmed TO business_verified;
```

Re-running the first file after the second checks for `kteb_confirmed`, does not find it
(it is called `business_verified` now), and **recreates it from scratch**. You end up
with the pre-rename and post-rename column side by side, both satisfying their own
migration's idempotency guard.

Generally: `IF NOT EXISTS` guards a *name*, and a rename invalidates the name. Re-running
an "idempotent" migration out of order is not free. If a column has been renamed since,
the earlier migration is no longer safe to replay and should say so in its header.

## Open: paste safety

**This is the root cause of everything above, and it is still unfixed.** I identified
partial paste as the mechanism behind `20260802` but never proposed a remedy — recording
it here so it stops being an unstated assumption.

Migrations are applied by selecting text in the Supabase SQL editor and running it. That
has three failure modes, and the workflow currently detects none of them:

1. **Partial application** — a truncated selection applies some statements.
2. **Never applied** — a file is committed and forgotten.
3. **Applied, then edited** — the file on disk no longer matches what ran. Indistinguishable
   from (1) after the fact, which is why `20260802` cannot be diagnosed further today.

`verify_schema.sql` catches (2) only for objects somebody remembered to register, and
catches (3) only where an H-token happens to check the changed body. Neither is
systematic.

### Proposal: an applied-migrations ledger

```sql
CREATE TABLE IF NOT EXISTS public.schema_migrations_applied (
  filename    text PRIMARY KEY,
  checksum    text NOT NULL,      -- sha256 of the file as applied
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT current_user
);
```

Every migration's **last statement inside its transaction** records itself:

```sql
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20260902_capture_schema_drift.sql', '<sha256 emitted by the generator>')
ON CONFLICT (filename) DO UPDATE SET checksum = excluded.checksum, applied_at = now();
```

This closes all three:

- **Partial application** — the INSERT is the last statement inside `BEGIN/COMMIT`. A
  truncated paste never reaches `COMMIT`, so nothing applies at all; and if the editor
  autocommits, the missing ledger row makes it visible.
- **Never applied** — compare the ledger against `ls supabase/migrations/`. The diff is
  the answer, with no register to maintain.
- **Applied, then edited** — the checksum no longer matches the file on disk. This is the
  case nothing can currently detect.

`scripts/audit-schema-drift.mjs` computes the checksums (it already reads every migration),
emits the expected ledger, and the audit gains a section comparing ledger to disk. RLS on,
no policies, service_role and postgres only — nothing client-facing needs to read it.

**Cost:** two lines per migration and one column of discipline. **Not adopted yet** — it
needs a decision, and back-filling the ledger for ~78 existing files means either
accepting "applied, checksum unknown" for all of them or checksumming the current files
and treating today as the baseline. The second is honest and cheap; the first is a lie
that would go stale.

## `facilities_backup_20260718` — investigated, dropped

411 rows, 26 columns. **Referenced by nothing**: no app code, no script, no function,
view or policy. Created during the 2026-07-18 capture work and never cleaned up.

| Rows | |
|---|---|
| 397 | also in `facilities` today, identical except 3 (status ×2, photos ×1) |
| 12 | deleted **duplicates** — six state hospitals appeared 3× in the snapshot, 1× now |
| 2 | unique to the snapshot |

`facilities` has since gained 10 columns the snapshot lacks (`category`, `city`, `area`,
`service_types`, `service_prices`, `hidden_*`, `featured_*`), so it could not serve as a
restore source regardless.

The two unique rows, archived verbatim in the migration:

```
Near East Hospital    hospital  Yakın Doğu Blv, Lefkoşa
Gönyeli Diş Kliniği   dentist   Gönyeli, Lefkoşa
both: phone NULL, verified true, is_public FALSE, status active,
      created_at 2026-05-30T22:01:56.848802+00 (bulk seed)
```

**Decision: archive-and-drop.** All 399 current facilities have `is_public = true`; both
deleted rows had `is_public = false`. They were hidden seed stubs with no phone number,
deliberately excluded and then removed — not data anyone lost. Keeping the table would
convert an unfinished incident artifact into permanent furniture, and it sits in the
PostgREST API surface, unreachable only because RLS is on with zero policies: one
accidental permissive policy away from publishing 411 rows.

### Separate product question

**Near East Hospital is absent from the directory** — no facility of that name, or any
`Yakın Doğu` spelling. It is a real and significant private hospital in Lefkoşa. Gönyeli
has 20 pharmacies and no dentist. Both may be intentional curation; flagging because this
is a health-access app and that is a content gap, not a schema one. Adding a facility is
curation, not a migration.

## The tool

`scripts/audit-schema-drift.mjs` replays every DDL statement in `supabase/` and
`supabase/migrations/` to build the schema the repo *claims*, then emits
`supabase/schema_drift_audit.sql` — one read-only statement returning only
disagreements. Regenerate after adding migrations; never hand-edit the output.

Why it exists alongside `verify_schema.sql`: that file checks a hand-maintained
**register**, so anything that drifted before somebody registered it is invisible to it
by construction. This derives expectations from the migrations themselves, so nothing
has to be remembered. The two are complementary — the register catches changed *bodies*
under unchanged names via H-tokens; the audit catches everything nobody thought to list.

### Seven bug classes found while building it

The first run produced ~70 rows. **All but three were parser defects.** A tool whose
output has to be hand-filtered is worse than no tool, because the filtering is the
judgement it was supposed to automate.

| # | Class | Manifestation |
|---|---|---|
| 1 | **Emitted SQL did not parse** | `notnull` used as a bare column alias. It is a `type_func_name_keyword` (legacy `expr NOTNULL`), so it cannot be a `ColId`. Failed on line 25 |
| 2 | **Order-insensitive settle** | Drops collected into a *set* and subtracted from adds regardless of order, so every `DROP … IF EXISTS x; ADD … x` idempotency pair vanished from expectations. Hit constraints, and separately indexes (all `CREATE` scanned before all `DROP` within a file) |
| 3 | **Inline constraints unparsed** | `status text CHECK (…)` is auto-named `events_status_check` by Postgres; only explicit `ADD CONSTRAINT` was collected. Hit `CREATE TABLE` (~60 rows) and, separately, `ALTER TABLE ADD COLUMN` (3 rows) |
| 4 | **Replay order** | Root files replayed alphabetically, so `beaches_landmarks_desc_jsonb.sql` (an `ALTER … TYPE JSONB`) ran before `beaches_landmarks_migration.sql` (the `CREATE TABLE`). The ALTER hit a nonexistent table and the CREATE won. Produced three false findings including `events.organizer_id` |
| 5 | **Truncated type names** | `double precision` captured as `double` — 9 rows |
| 6 | **Signature case-folding** | Literal signatures lowercased on both sides. Cosmetically wrong (`^[a-za-z]`), but the real cost is a **false negative**: a regex narrowed from `[a-zA-Z]` to `[a-z]` would compare equal |
| 7 | **Signature sort collation** | Repo side sorted by JS code unit, live side by the database's default collation, which weights punctuation differently. Same literal *set*, different serialised *order* — so every signature containing `^` or `{` mismatched. Fixed with `COLLATE "C"` |

Nine manifestations, seven classes. Class 4 is the one that matters most: it produced a
finding I reported as real (`events.organizer_id` NOT NULL in the repo) when
`events_gisekibris_migration.sql:29` had done the `DROP NOT NULL` all along.

### How the parser is validated

`20260718_capture_2_check_constraints.sql` captured **47 real constraint names from the
live database**. The generator's replication of Postgres's auto-naming rule reproduces
**46 of 47**. The 47th, `appointments_requested_time_future`, is correctly excluded —
the repo's last operation on it is a `DROP` — and the audit confirmed it is absent live,
which is what proved that transactional DROP applied.

The generator also refuses to write output that would not parse: identifiers in `ColId`
positions are checked against `reserved_keyword` and `type_func_name_keyword`, plus
paren/quote balance, read-only-ness, and exactly one statement.

### What it does not check

- Constraint bodies are compared by **literal signature** (sorted distinct quoted
  strings and numbers), because Postgres rewrites `x IN ('a','b')` into
  `x = ANY (ARRAY['a'::text,…])` and text comparison is all noise. Catches a widened
  bound or a changed enum member; will **not** catch `<=` flipped to `<`.
- Types are compared loosely after normalisation; precision and domain differences may
  not surface.
- **Policies, triggers, functions and views are out of scope.** `verify_schema.sql`
  covers these by register only, so they carry the same blind spot the audit was built
  to close for columns. This is the largest remaining gap.
- A draft migration sitting in `supabase/migrations/` is read as repo truth, so an
  unapplied proposal can make the audit agree with a database it was never applied to.
  Verified this round that the pending capture migration changes no expectation row, but
  the mechanism exists.
