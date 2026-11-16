# GCP, Maps and Places keys
Moved out of `CLAUDE.md` (2026-11-16) to cut per-message context; still binding. CLAUDE.md links here.

## gcloud service account
- ⚠ **GCP API-key work runs via `gcloud` on this Mac as service account `ada-apikeys-ops@trnc-health-58b47`** (Berke,
  2026-10-30; Berke's own gcloud login REVOKED). Roles: API Keys Admin + Logging Viewer + Monitoring Viewer on
  `trnc-health-58b47`, `project-958a71e2-…` and (2026-10-31) `ada-app-499617`, + Service Usage Consumer on the last two; no
  other project. API Keys Admin includes `getKeyString`, so the SA CAN read the Places server key: the ban below is the guard.
  Key file `~/.config/ada-gcp/ada-apikeys-ops.json` (600, outside every repo and the vault): never commit/print/copy it;
  lost Mac → delete the SA key in IAM. Monitoring: send `x-goog-user-project: ada-app-499617` (billed; 58b47 is not). Read with
  `gcloud services api-keys describe/list`; NEVER `get-key-string`. Before any `update`, save `describe --format=json` to the vault; `--no-check-existing-usage`
  only when the blocking traffic is proven 4xx (Monitoring `request_count` by credential). Vault `2026-10-30_gcp-keys-gcloud.md`.

## Keys per build
- **Two Maps keys, two GCP projects** (Android reads the key from the BUILD; an OTA cannot change it):
  production EAS env = `AIzaSyDa…0Nlg` in **ada-app-499617** ("Maps Platform API Key"), **restricted
  2026-10-06**: Android apps `com.berkeustun95.ada` + upload SHA-1 + Play App Signing SHA-1 (a Places call gets 403
  `API_KEY_ANDROID_APP_BLOCKED`; nothing else may use this key, iOS uses Apple Maps). API = Maps SDK for Android
  (`maps-android-backend`) only since 2026-10-31 06:43Z (was the 35-API default; rollback script in vault `attachments/`). A new signing key needs its SHA-1 added FIRST; preview EAS env + local `.env` = `AIzaSyDb…uNu8` in
  **My First Project** (`project-958a71e2-96dc-4371-942`), Android apps: `com.berkeustun95.ada.preview` + preview
  SHA-1 and `com.berkeustun95.ada` + this Mac's debug-keystore SHA-1 (local dev builds); API = Maps SDK for Android
  (`maps-android-backend`) only since 2026-10-30 (rollback script in vault `attachments/`). Blank map, no error = the build's key refuses that package/SHA-1. Read which key a
  build uses with `eas env:list --environment <env>`, never from `.env` (they differ). Vault `play-console-status.md`.
- **Google keys for check-ins (2026-10-07, both in ada-app-499617 "ADA App", billing country Cyprus →
  Maps Platform EEA terms):** iOS map `AIzaSyCa…w3Ic` "ADA Maps – iOS" (Maps SDK for iOS, bundle ids
  `com.berkeustun95.ada` + `.preview`) = EAS env `GOOGLE_MAPS_IOS_API_KEY` (production + preview,
  sensitive) — from now on EVERY iOS build carries the Google Maps SDK (`app.config.js` adds it when
  set). Places `AIzaSyAK…azbM` "ADA Places – server" (Places API (New) only) = Edge Function secret
  `GOOGLE_PLACES_SERVER_KEY`, used only by `google-places`.
