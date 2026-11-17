# Social sign-in (Google + Apple, native, from 1.2.0)
Moved out of `CLAUDE.md` (2026-11-16) to cut per-message context; still binding. CLAUDE.md links here.

Plan: `~/ObsidianVault/10-ada/2026-09-21_social-auth.md`.
- Runtime 1.2.0 is the fence (`runtimeVersion` = `appVersion`). 1.1.0 fixes ship from `release/1.1`.
- Every social branch keys on `app_metadata.provider` (`socialProvider()` in `utils/socialAuth.js`, first identity only).
- `revokeGoogle()` runs BEFORE anything signs out of Supabase (after, `revokeAccess()` no-ops).
- Under 13: Google/Apple accounts are DELETED, email accounts are FLAGGED.
- A name the provider gave is never asked for again (App Store 4.0); Apple sends it once.
- `display_name` is labelled "Username" in all nine locales, never "name".
- The three native modules are `require()`d inside functions (`check-native-import-safety.mjs`).
- Deleting an Apple user outside the app: `gh workflow run revoke-apple-token -f user_id=<id>` FIRST,
  confirm revoked, THEN delete (`apple_refresh_tokens` cascades with `auth.users`).
- `handle_new_user` reads no metadata; names reach `profiles` from the client only.

