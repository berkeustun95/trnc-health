# Current Spec — Phase 1: Services Near Me

## Goal
Sort facilities by distance from the user, and clearly flag the nearest OPEN
pharmacy. This is the "I just arrived, it's late, where do I go" moment.

## What exists already
- `facilities` table in Supabase (name, type, address, latitude, longitude,
  opening_hours, languages, is_public, verified) with a public read policy.
- App.js fetches all facilities and renders them as cards (query -> state -> render).

## Tasks (do these one at a time; show me the diff after each)

### Task 1 — Get the user's location
- Add `expo-location` via `npx expo install expo-location`.
- On app load, request location permission and get the device's coordinates.
- If permission is denied, the app must still work: just show the unsorted list
  with a small note like "Enable location to see nearest services." Never crash.

### Task 2 — Sort by distance
- Compute distance from the user to each facility (Haversine formula on lat/long).
- Sort the list nearest-first.
- Show the distance on each card, e.g. "1.2 km away".

### Task 3 — "Open now" badge
- Parse `opening_hours` and show an "Open now" / "Closed" badge on each card.
- Keep the parsing simple and predictable; if hours can't be parsed, show nothing
  rather than guessing wrong.

### Task 4 — Duty pharmacy (nöbetçi eczane)
- Add a `duty_schedule` table: `facility_id`, `date`. (Read-only public, same kind
  of read policy as facilities — no per-user data, so no RLS complexity here.)
- Surface tonight's on-duty pharmacy at the top with a clear "On duty tonight" label.

## Done when
- The list is sorted by real distance from where I'm standing.
- The nearest open pharmacy is obvious at a glance.
- Tonight's duty pharmacy is shown prominently.
- Denying location permission degrades gracefully (no crash, still usable).

## Constraints (also in CLAUDE.md)
- Stay on Expo SDK 54. Use `npx expo install`. Do not bump versions.
- Minimal changes; don't refactor App.js beyond what these tasks need.