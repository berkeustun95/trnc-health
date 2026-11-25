-- Read-only (Berke, 2026-11-25): Gişe Kıbrıs repeat sessions that borrowed the first
-- session's banner id. Lists event rows only (no user data, no counts): every gisekibris
-- row starting on/after 2026-11-01, plus any row whose external_id is one of the borrowed
-- image ids or the sessions' own page ids, whatever its date.
select e.external_id, e.status, e.start_date, e.end_date, e.title, e.ticket_url,
       e.updated_at
from public.events e
where e.source = 'gisekibris'
  and (e.start_date >= timestamptz '2026-11-01'
       or e.external_id in (
         'gk-pTvxB7NxtGCRMjLNyMc9', 'gk-hjX91RN2fnhXMLV9t2fv', 'gk-FoHo1UcBibuVBWlhyUPY',
         'gk-cmwkl4z0d013qecqb8aweqe2y', 'gk-xJx2vhZAbKthgpumGulh',
         'gk-cmwncx16f009ecxtvh9z9n1mm', 'gk-cmwnddnqz008zechbpyigh0g9',
         'gk-cmwdvuo5n009zcxeyybp55wy9', 'gk-cmwdvvur100a0cxeyg806bsda',
         'gk-cmwdvwt1f0090echd1lqr4l6b', 'gk-cmwdvxjw00091echdvb495odf',
         'gk-cmwndj1jw0094echbypzuhfiw', 'gk-cmwndkn2000akcxtv4uzt2mpk',
         'gk-cmwt52g9b026ecxhtlg66sd1l', 'gk-cmwqaix4z01fsecf8aidu97cn'))
order by e.start_date, e.title;
