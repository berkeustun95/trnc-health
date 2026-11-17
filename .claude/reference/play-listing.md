# Play listing
Moved out of `CLAUDE.md` (2026-11-16) to cut per-message context; still binding. CLAUDE.md links here.

- Text lives in `fastlane/metadata/android/<lang>/` (tr-TR, en-GB default, ru-RU, ar, el-GR, fr-FR,
  es-ES, de-DE, fa). Play is downstream: Console hand edits are overwritten. No images/binaries there.
- Titles match the ad: `ADA – North Cyprus Assistant` / `ADA – Kuzey Kıbrıs Asistanı`, "ADA" first
  in all; es-ES uses `ADA: …` (length). Never "Guide". Paragraph 2 says "assistant" once.
- Limits: title ≤ 30, short ≤ 80, full ≤ 4000 code points. Title files have NO trailing newline.
- No health, pharmacy, duty, clinic or doctor wording in any language; no "eSIM" while
  `CONNECTIVITY_LIVE` is false (remove that guard pattern the day Connectivity goes live).
- Paragraph 1 = independence disclaimer; description carries official source links. The guard reads
  URLs from `fastlane/metadata-backup/android/en-GB`. el-GR names no state. Bullets name LIVE modules only.
- `npm run store:check` enforces all of the above on every folder. `npm run store:listing` = check +
  text-only `fastlane supply`; dry run `-- --validate_only true`. Needs
  `./google-play-service-account.json` (gitignored, mode 600, never committed or printed).
- ⚠ A real push joins whatever Play is reviewing: wait for pending reviews; if refused, use
  `--changes_not_sent_for_review true` and send from Console.
- ⚠ `fastlane supply init` overwrites the folder: snapshot into `fastlane/metadata-backup/android`.
- Ruby 2.6, gems in `vendor/bundle` (`bundle install` once); compare files as UTF-8 (`LC_ALL=en_US.UTF-8`).
- **Play developer account ID `7054171312151082560`.** Reports bucket = `gs://pubsite_prod_7054171312151082560`
  (CONFIRMED 2026-10-27: 200 for `ada-fastlane@ada-app-499617` after Berke granted "View app information and download
  bulk reports (read-only)"; `pubsite_prod_rev_<id>` is 404, does not exist). `stats/ratings/` and `reviews/` stay empty
  until Play generates its first monthly report.
  Reviews API = last 7 days, text reviews only. iOS reviews: ASC `customerReviews` (app `6783996527`). Vault
  `2026-10-20_store-reviews-pull.md`.

