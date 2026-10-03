-- Store-update popup thresholds (20261051): soft = latest_version, force = min_supported_version.
select json_agg(json_build_object('platform', platform, 'latest_version', latest_version,
  'min_supported_version', min_supported_version) order by platform) as app_versions
from public.app_versions;
