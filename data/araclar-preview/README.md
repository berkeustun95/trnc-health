# Araçlar Preview test photos

Test data for ADA Preview only. Every photo belongs to the inactive test dealer "ADA Test Oto", which production never shows (`dealers.is_active = false`; only `is_previewer()` sessions can read it).

- **Licence:** every file is **CC0** on Wikimedia Commons. The licence was read per file from the Commons API (`extmetadata.LicenseShortName`) on 2026-11-07. `photos.json` lists each file's Commons title, author, page and the sha256 of the committed bytes.
- **Encoding:** re-encoded with sharp (max 1200 px wide, mozjpeg q80), the same settings as the Novest mirror.
- **Upload:** `scripts/seed-araclar-preview.mjs` uploads the files to `vehicle-images/partner/ada-test-oto/<file>`. It runs through the `araclar-preview-seed` workflow, which is dry by default.

No photo here comes from a listing site or a dealer. Real listing photos arrive only through a site adapter, after that site's terms of use and robots.txt have been checked (vault `10-ada/2026-11-07_araclar-PLAN.md`).
