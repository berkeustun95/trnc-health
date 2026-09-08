---
name: commit
description: Stage and commit ADA changes with a message in the project's house style. Use when the user types /commit or asks to commit their work.
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *) Bash(git diff *) Bash(git push *) Bash(npm run drift:check) Bash(npm run drift:regen)
---

## Working tree

Status:
!`git status --short`

Diff vs last commit:
!`git diff HEAD`

Migrations touched in this change (tracked edits AND new files):
!`{ git diff HEAD --name-only -- supabase/migrations/; git ls-files --others --exclude-standard -- supabase/migrations/; } | sort -u | sed 's/^/  /' || true`

Drift-audit freshness:
!`npm run --silent drift:check 2>&1 | tail -12 || true`

## Your task

You are committing changes to ADA, a React Native + Expo (SDK 54) health-access app
for North Cyprus. The project commits directly to the current branch (`main`, no
feature branches).

### Step 0 — The drift audit (a BLOCKING check, not a reminder)

`supabase/schema_drift_audit.sql` is GENERATED from every DDL statement in
`supabase/migrations/`. It is the report you run FIRST against a database you are
unsure about — so a stale one is worse than no report at all: it answers confidently
about a schema that no longer exists. It has already gone stale by three migrations
(`1007` home_strip_pin, `1008` ad_banners, `1009` ad_modules) with nothing anywhere
saying so.

**Read the two blocks above — they were executed before you saw this file, so there is
nothing here to remember to run.**

The migrations list covers `git ls-files --others` as well as `git diff HEAD`, and that
is not belt-and-braces: `git diff HEAD` does not list UNTRACKED files, so a brand-new
migration — the commonest migration commit there is — showed up as "nothing touched"
until this was fixed. The block would then have sent you down the "EMPTY but STALE"
branch and made you ask a question you already had the answer to.

- **"Migrations touched" is NON-EMPTY and the drift check says STALE** → run
  `npm run drift:regen`, then `git add supabase/schema_drift_audit.sql` and include it
  in THIS commit. Not a follow-up commit: the audit and the migration that moved it
  belong in the same change, or the repo has a window where they disagree. Say in your
  reply that you regenerated it.
- **"Migrations touched" is NON-EMPTY and the drift check says OK** → nothing to do.
  Somebody already regenerated it, which is the intended state.
- **"Migrations touched" is EMPTY but the drift check says STALE** → do NOT silently
  regenerate; that would bury an unrelated schema change inside this commit. Tell the
  user the audit is stale, quote the first differing line the check printed, and ask
  whether to fix it here or in its own commit.
- **The drift check errored rather than passing or failing** → treat it as a failure and
  say so. A guard that could not run has told you nothing, and "no output" and "no
  problems" are the same thing on screen.

Never edit `schema_drift_audit.sql` by hand to make the check pass. It carries a
"GENERATED — do not hand-edit" banner for the reason every generated artifact does: the
next regeneration silently discards the edit.

### Step 1 — Check for house-rule violations BEFORE committing

Scan the diff for these. If you find any, list them clearly and ask whether to
proceed before committing — do not silently commit a violation:

- **i18n bypass:** user-facing strings not wrapped in `t(key, lang)` — hardcoded
  text in JSX, button labels, or placeholders. (Known offender to watch: avatar
  picker modal.)
- **Hardcoded colors:** any color literal other than `#fff` / `#ffffff` or an
  `rgba(...)` tint. Everything else must come from `colors` in `constants/theme.js`.
- **Subcomponents inside a parent:** components that re-render must be defined at
  module top level, never nested inside their parent (prevents remount bugs).
- **Package version changes:** any edit to dependency versions in `package.json`.
  Versions only change via `npx expo install` — flag manual bumps.
- **RLS / ownership gap:** Supabase queries on user data missing an ownership
  filter (e.g. an `appointments` update without `.eq('customer_id', session.user.id)`).
- **Secret exposure:** any sign of the Supabase service role key. Only the anon
  public key belongs in app code.

### Step 2 — Write the commit message in the project's style

Match the existing history exactly:

- One line. Lead with an imperative/noun verb: `Add`, `Fix`, `Remove`, `Move`,
  `Support`, or `Visual polish:` for grouped UI tweaks.
- Capitalized first word, **no trailing period**.
- Concise but specific. Use a parenthetical for technical detail.
- Name the platform when the change is platform-specific.

Real examples from this repo:

- `Support multiple specialties per facility (text[] column)`
- `Fix map facility selection on Android`
- `Visual polish: auth form card, photo bg on main, card visibility fixes`

Avoid Conventional Commits prefixes (`feat:`, `fix:`) — this repo does not use them.

### Step 3 — Commit and push

Stage all changes (including untracked files shown in status), commit with the
message, then push to the remote. Show me the final message, the files included,
and confirm the push succeeded.