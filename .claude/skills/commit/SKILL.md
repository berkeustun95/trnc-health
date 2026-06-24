---
name: commit
description: Stage and commit ADA changes with a message in the project's house style. Use when the user types /commit or asks to commit their work.
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *) Bash(git diff *) Bash(git push *)
---

## Working tree

Status:
!`git status --short`

Diff vs last commit:
!`git diff HEAD`

## Your task

You are committing changes to ADA, a React Native + Expo (SDK 54) health-access app
for North Cyprus. The project commits directly to the current branch (`main`, no
feature branches).

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