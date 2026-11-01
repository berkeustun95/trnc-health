# Döveç API — PLUG-IN CHECKLIST

Everything is built and dark. When Döveç sends the API, do these steps in order. Each step names
the exact file and lines. Nothing else in the codebase should need to change.

## 0. What we need from Döveç

- [ ] Base URL (e.g. `https://api.dovec…/v1`)
- [ ] API key + how to send it (Bearer header? `x-api-key`?)
- [ ] One sample response per endpoint, with **real** field names (projects, units, photos)
- [ ] Pagination style (page/per_page? cursor? `last_page`/`total`?)
- [ ] The full vocabulary of: project status, unit category/type, unit availability
- [ ] Their logo file (SVG or PNG ≥ 600 px wide) for the partner page

## 1. Fill in the mapping — `supabase/functions/_shared/dovec-feed.mjs` (the ONLY file)

Every guessed line ends in `// GUESS`. Go through them top to bottom:

| What | Where in `dovec-feed.mjs` |
|---|---|
| Endpoint path | `PROJECTS_PATH` |
| Page size | `PER_PAGE` |
| Auth header | `authHeaders()` — swap to `{ 'x-api-key': apiKey }` if that is their scheme |
| Page envelope + "is there a next page" | `readPage()` and the two `searchParams.set(...)` lines in `fetchFeed()` |
| Project status values | `PROJECT_STATUS` (their value → `selling` / `under_construction` / `delivered`) |
| Unit category values | `UNIT_TYPE` (their value → `apartment` / `villa` / `studio` / `house` / `commercial`) |
| Which units are listed | `UNIT_LISTED` (only "available"-type values; sold/reserved are delisted automatically) |
| City names → region | `DISTRICT` |
| Project fields | in `mapFeed()`: `p.id`, `p.status`, `p.name`, `p.description_html`, `p.price`, `p.location.*`, `p.progress_percent`, `p.unit_types`, `p.delivery`, `p.url`, `p.gallery` |
| Unit fields | in `mapFeed()`: `p.units`, `u.id`, `u.availability`, `u.category`, `u.price`, `u.layout`, `u.code`, `u.description_html`, `u.features`, `u.bedrooms`, `u.bathrooms`, `u.gross_m2`, `u.net_m2`, `u.floor`, `u.url`, `u.images` |
| Price block | `priceOf()` — `on_request`, `amount`/`from`, `currency` |
| Photo list | `mediaOf()` — `id`, `url`, `is_cover` |
| Delivery date format | `parseDelivery()` (handles `2027-Q2` and `YYYY-MM-DD` today) |

If units come from a **separate endpoint** instead of nested in each project, `fetchFeed()` grows a
second loop and attaches units to their project; `mapFeed()` stays the same.

Then:
- [ ] Replace `fixtures/dovec-mock.json` with a trimmed copy of their **real** response shape (keep it
      fictional data or anonymised), and update `scripts/test-dovec-sync.mjs` expectations.
- [ ] `npm run dovec:test` — must be all green (pagination, mapping, contact strip, photo hiding,
      change detection, delist/relist, mass-delist floor).
- [ ] `node scripts/build-dovec-preview.mjs` to regenerate the device preview, then `npm run dovec:preview`.

## 2. Secrets (never in a file)

- [ ] Edge Function secrets, from a 600-mode env file:
      `scripts/sb.sh secrets set --env-file <file>` with
      `DOVEC_API_BASE_URL=…`, `DOVEC_API_KEY=…`, `DOVEC_SYNC_ENABLED=false` (stays false until step 4)
- [ ] GitHub `production` environment secrets: `DOVEC_API_BASE_URL`, `DOVEC_API_KEY`
      (used by `dovec-images.yml`)
- [ ] Vault, once, in the SQL editor: `select vault.create_secret('<service key>', 'dovec_sync_key');`

## 3. Database (Berke's `production-db` approval)

- [ ] `gh workflow run supabase-migrate -f files="20261153_dovec_partner_feed.sql 20261154_contact_events_dovec.sql"` (dry),
      then again with `-f apply=true`.
- [ ] `supabase/verify_schema.sql` QUERY 1: the `20261153_*` and `20261154_*` rows read OK.

## 4. Deploy + first run (rows land PENDING — invisible to users)

- [ ] `scripts/fn-deploy.sh sync-dovec --go` (verify_jwt true, from `deploy-config.json`)
- [ ] Set `DOVEC_SYNC_ENABLED=true` (Edge Function secret)
- [ ] Invoke once by hand; the response must be `ok: true` with sensible `project_plan` / `unit_plan`
      counts and readable `skipped` / `flagged` lists
- [ ] `gh workflow run dovec-images` (dry), then `-f apply=true` — covers + unit photos mirrored
- [ ] Check the pending rows as admin: every project has a cover, prices and statuses match Döveç's site,
      no contact data in any description

## 5. Schedule (twice daily, like Novest)

- [ ] Copy `supabase/functions/sync-dovec/schedule.sql` to `npm run migration:next`, stamp, apply via
      `supabase-migrate`. It creates `sync-dovec-morning` / `-evening` (05:10 / 15:10 UTC) **inactive**.
- [ ] Switch them on: `select cron.alter_job(jobid, active := true) from cron.job where jobname like 'sync-dovec-%';`
- [ ] Uncomment the `schedule:` block in `.github/workflows/dovec-images.yml` (05:30 / 15:30 UTC)

## 6. Go-live (one release step)

- [ ] Logo: add to `assets/partners/dovec/`, wire in `constants/partnerAssets.js`, show it in
      `screens/DovecPartnerScreen.js` intro (replaces the text name, ADA frame unchanged)
- [ ] Publish the rows, in a migration:
      ```sql
      UPDATE public.estate_agencies   SET status = 'active' WHERE id = '00000000-0000-4000-9000-000000000003';
      UPDATE public.property_projects SET status = 'active' WHERE source = 'dovec' AND status = 'pending';
      UPDATE public.properties        SET status = 'active' WHERE source = 'dovec' AND status = 'pending';
      ```
      From then on the sync publishes new rows itself (agency active).
- [ ] Döveç units then also appear in **Konaklama** (decided 2026-11-01: they should). Price-on-request
      units render "Fiyat için arayın" there (utils/money.js `propertyPriceText`, any source) and sort
      last on both price sorts. Spot-check one on device after the UPDATE.
- [ ] Turkish device pass with `DOVEC_PARTNER_LIVE = true` flipped locally
- [ ] Flip `DOVEC_PARTNER_LIVE = true` in **both** `constants/flags.js` and `EXPECTED_SCALARS` in
      `scripts/check-module-flags.mjs`, one commit → Preview → Berke's go → `npm run ota`

## Reporting leads to Döveç

Per project, per month (admin role):
```sql
select p.name, m.month, m.calls, m.whatsapps, m.tap_minutes
  from contact_events_monthly m join property_projects p on p.id = m.entity_id
 where m.module = 'dovec' order by m.month desc, p.name;
```
These are anonymous tap counts (no names or numbers of the people who tapped), and a floor:
quote "at least N".
