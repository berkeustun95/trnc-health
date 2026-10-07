-- Read-only probe 2 for 20261079 (pharmacy_coords policy + seed + manual pins), 2026-10-04.
-- gh workflow run supabase-readonly -f file=supabase/probe_pharmacy_coords_2.sql --ref db/pharmacy-coords
-- Everything the migration must not guess: constraints, triggers, grants, how name_key is derived,
-- where each manually pinned name lives, and every SÖNMEZ / SÜNMEZ / ÖZVOL / ÖZYOL in any table.
select json_build_object(
  'pg', version(),
  'constraints', (select json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid)))
                    from pg_constraint where conrelid = to_regclass('public.pharmacy_coords')),
  'indexes', (select json_agg(indexdef) from pg_indexes where schemaname = 'public' and tablename = 'pharmacy_coords'),
  'triggers', (select json_agg(pg_get_triggerdef(oid)) from pg_trigger
                where tgrelid = to_regclass('public.pharmacy_coords') and not tgisinternal),
  'grants', (select json_agg(json_build_object('grantee', grantee, 'priv', privilege_type) order by grantee, privilege_type)
               from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'pharmacy_coords'),
  'name_key_fn', (select json_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'pharmacy_name_key'),
  'name_key_mismatch_vs_lower', (select count(*) from public.pharmacy_coords where name_key is distinct from lower(name)),
  'name_key_samples', (select json_agg(json_build_object('name', name, 'key', name_key))
                         from (select * from public.pharmacy_coords where name ~ '[İIıŞĞÜÖÇ]' limit 6) x),
  'regions', (select json_agg(json_build_object('region', region, 'n', n) order by region)
                from (select region, count(*) n from public.pharmacy_coords group by region) x),
  'duty_list_constraints', (select json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid)))
                              from pg_constraint where conrelid = to_regclass('public.duty_list')),
  'duty_list_triggers', (select json_agg(pg_get_triggerdef(oid)) from pg_trigger
                           where tgrelid = to_regclass('public.duty_list') and not tgisinternal),
  -- The 14 pinned names + the two spelling questions, wherever they appear.
  'targets_coords', (select json_agg(to_jsonb(c) order by c.name) from public.pharmacy_coords c
                      where c.name ~* '(KARPAZIN|GÜLTEN VELİ|ŞİFALI|ÖZBİRTAN|DOĞAN BAŞAK|ERENKÖY|HAMİTKÖY|İSFENDİYAROĞLU|MEHMET TUT|MISRA ÖZBAY|NELİN|ÖZYOL|ÖZVOL|SUDE UZUN|SÜNMEZ|SÖNMEZ|SONMEZ|SUNMEZ)'),
  'targets_duty', (select json_agg(x order by x.name) from (
                     select name, region, count(*) n, min(duty_date) first, max(duty_date) last,
                            max(phone) phone, max(address) address
                       from public.duty_list
                      where name ~* '(KARPAZIN|GÜLTEN VELİ|ŞİFALI|ÖZBİRTAN|DOĞAN BAŞAK|ERENKÖY|HAMİTKÖY|İSFENDİYAROĞLU|MEHMET TUT|MISRA ÖZBAY|NELİN|ÖZYOL|ÖZVOL|SUDE UZUN|SÜNMEZ|SÖNMEZ|SONMEZ|SUNMEZ)'
                      group by name, region) x),
  'targets_facilities', (select json_agg(json_build_object('id', id, 'name', name, 'type', type, 'status', status,
                            'city', city, 'area', area, 'address', address, 'phone', phone,
                            'lat', latitude, 'lng', longitude) order by name)
                           from public.facilities
                          where name ~* '(KARPAZ|GÜLTEN|VELİ ECZ|ŞİFALI|ŞIFALI|ÖZBİRTAN|DOĞAN BAŞAK|ERENKÖY|HAMİTKÖY|İSFENDİYAR|MEHMET TUT|MISRA|NELİN|ÖZYOL|ÖZVOL|SUDE UZUN|SÜNMEZ|SÖNMEZ|SONMEZ|SUNMEZ)'),
  'all_coords', (select json_agg(json_build_object('name', name, 'region', region, 'lat', lat, 'lng', lng)) from public.pharmacy_coords),
  'facilities', (select json_agg(json_build_object('name', name, 'latitude', latitude, 'longitude', longitude))
                   from public.facilities where type = 'pharmacy' and latitude is not null),
  'roster', (select json_agg(json_build_object('name', name, 'region', region)) from (
               select distinct name, region from public.duty_list
                where duty_date >= (now() at time zone 'Europe/Istanbul')::date) x)
) as report;
