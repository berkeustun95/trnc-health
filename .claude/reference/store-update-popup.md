# Store-update popup
Moved out of `CLAUDE.md` (2026-11-16) to cut per-message context; still binding. CLAUDE.md links here.

`app_versions` (20261051): `latest_version` = dismissible, `min_supported_version` BLOCKS. Raising it
above `'1.0.0'` on either platform needs a force-tier device pass on BOTH Android and iOS first (never
run on either; iOS alone tests the native Modal vs the emergency root overlay, no hardware back, and
`itms-apps://`). iOS test = new build from **main**, never `release/1.1`. `verify_schema.sql` QUERY 5
goes red when raised; that is the review moment. Pass criteria: vault "Store-update popup force tier".

