-- Read-only probe (2026-11-25): the Döveç project id the agreed test enquiry will name (partner feed data, no user data).
-- The project the 'D-Point' seed is attached to, and whether it is still listed. Result sealed (vault only).
SELECT c.seed_name, c.project_id, p.name, p.listed
  FROM public.dovec_project_coords c
  LEFT JOIN public.dovec_projects p ON p.id = c.project_id
 WHERE c.seed_name = 'D-Point';
