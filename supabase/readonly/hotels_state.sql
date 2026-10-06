-- Oteller go-live state (read-only): migration, import, publish window, map pins, photos.
select json_build_object(
  'migration_1059', exists (select 1 from public.schema_migrations_applied where filename like '20261059%'),
  'hotels_total', (select count(*) from public.hotels),
  'active', (select count(*) from public.hotels where is_active),
  'delisted', (select count(*) from public.hotels where delisted_at is not null),
  'public_visible', (select count(*) from public.hotels where is_active and delisted_at is null),
  'with_pin', (select count(*) from public.hotels where lat is not null and is_active and delisted_at is null),
  'with_photo', (select count(*) from public.hotels where photo_url is not null and is_active and delisted_at is null),
  'list_dates', (select json_agg(distinct source_list_date) from public.hotels)
) as hotels_state;
