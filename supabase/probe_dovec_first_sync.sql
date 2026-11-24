-- Read-only probe (2026-11-23): Döveç first sync. Partner project data only (public marketing data), no user data.
-- Per project: listed, and whether its pin is the seeded coordinate for that exact name.
SELECT p.name, p.city, p.status, p.listed, p.available_units, p.from_price,
       p.latitude IS NOT NULL AS has_pin,
       c.seed_name IS NOT NULL AS seed_matched,
       (p.latitude IS NOT DISTINCT FROM c.latitude AND p.longitude IS NOT DISTINCT FROM c.longitude) AS pin_equals_seed
FROM public.dovec_projects p
LEFT JOIN public.dovec_project_coords c ON c.project_id = p.id
ORDER BY p.name;

-- Seeds: every seeded name matched to a project, or not.
SELECT seed_name, last_status, project_id IS NOT NULL AS matched, matched_at IS NOT NULL AS stamped
FROM public.dovec_project_coords ORDER BY seed_name;

-- Totals and feed state (project counts only).
SELECT (SELECT count(*) FROM public.dovec_projects) AS projects_total,
       (SELECT count(*) FROM public.dovec_projects WHERE listed) AS projects_listed,
       (SELECT count(*) FROM public.dovec_project_coords WHERE project_id IS NOT NULL) AS seeds_matched,
       (SELECT count(*) FROM public.dovec_project_coords) AS seeds_total,
       s.published, s.suspended, s.last_good_sync_at
FROM public.dovec_settings s WHERE s.id = 1;
