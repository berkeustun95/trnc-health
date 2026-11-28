// ─── Döveç limit-trigger live proof: the pure parts (SQL text, precondition, verdicts, redacted output) ─────────────
// Engine: scripts/dovec-lock-proof.mjs, workflow .github/workflows/dovec-lock-proof.yml. This file holds no key and no
// network call, so tests drive it with injected `post` / `sleep`. NOTHING here commits: every statement that writes runs
// inside a DO block that ends in a deliberate exception (the transaction rolls back); the only trace is burnt values of
// public.dovec_lead_external_seq (sequences are not rolled back), i.e. a gap in the ADA-n numbers.

export const HOLD_MS = 10000      // A holds the advisory lock this long
export const B_DELAY_MS = 3000    // B starts this long after A is fired; the margin check below proves B really started inside the hold
export const MARGIN_MS = 2000     // B must have started at least this long before A ended: an UNBLOCKED insert takes milliseconds, not seconds
const TIMEOUT = '30s'

const OK_REFS = ['refs/heads/main']
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

// Refuse before anything is sent. `apply` must be the literal 'true' or 'false' (an unset input is a refusal, not a dry run).
export function refusal({ ref, inCI, apply }) {
  if (apply !== 'true' && apply !== 'false') return `apply must be exactly "true" or "false" (got ${apply === undefined ? 'nothing' : 'something else'})`
  if (inCI && !OK_REFS.includes(ref)) return 'runs from main only (this ref is not main)'
  if (!inCI && apply === 'true') return 'a write run happens only in GitHub Actions'
  return null
}

export const PRECONDITION_SQL = `
SELECT
  p.prosecdef AS secdef,
  COALESCE(p.proconfig, ARRAY[]::text[]) AS config,
  pg_get_functiondef(p.oid) LIKE '%IF NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.dovec_leads WHERE user_id = NEW.user_id AND client_request_id = NEW.client_request_id)%' AS has_skip,
  (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.dovec_leads'::regclass AND NOT t.tgisinternal AND (t.tgtype & 31) = 7)::int AS before_insert_row_triggers,
  (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.dovec_leads'::regclass AND NOT t.tgisinternal AND (t.tgtype & 31) = 7
     AND t.tgname = 'dovec_leads_rate_limit' AND t.tgfoid = p.oid AND t.tgenabled = 'O')::int AS rate_limit_triggers,
  EXISTS (SELECT 1 FROM public.dovec_projects WHERE listed) AS has_listed_project
FROM pg_proc p WHERE p.oid = to_regprocedure('public.dovec_leads_enforce_limits()')`

// row = the one row of PRECONDITION_SQL (or undefined when the function does not exist). Returns the failing checks.
export function evalPrecondition(row) {
  if (!row) return ['the limit function does not exist']
  const cfg = Array.isArray(row.config) ? row.config : []
  const sp = cfg.filter(c => String(c).startsWith('search_path='))
  const fails = []
  if (row.secdef !== true) fails.push('the function is not SECURITY DEFINER')
  if (sp.length !== 1 || !/^search_path=(""|'')?$/.test(String(sp[0]))) fails.push('search_path is not pinned to the empty path')
  if (row.has_skip !== true) fails.push('the function lacks the repeat-skip (EXISTS)')
  if (row.before_insert_row_triggers !== 1 || row.rate_limit_triggers !== 1) fails.push('dovec_leads_rate_limit is not the one BEFORE INSERT row trigger on this function')
  if (row.has_listed_project !== true) fails.push('there is no listed project to satisfy the foreign key')
  return fails
}

const PICK = `SELECT id INTO v_proj FROM public.dovec_projects WHERE listed ORDER BY id LIMIT 1;
  IF v_proj IS NULL THEN RAISE EXCEPTION 'lockproof_no_project'; END IF;`
const row = (user, crid) => `INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status, is_test)
    VALUES (${user}, ${crid}, repeat('a', 64), v_proj, 'LOCKPROOF', '+900000000000', 'English', 'en', true, 'lockproof', 'mock', false)`
const epoch = v => `(extract(epoch FROM ${v}) * 1000)::bigint`
const wrap = body => `SET LOCAL lock_timeout = '${TIMEOUT}'; SET LOCAL statement_timeout = '${TIMEOUT}';
DO $lp$
DECLARE v_proj text;
${body}
$lp$`

// A: insert one row (the trigger takes the advisory lock), hold, then raise: the whole transaction rolls back.
export const caseASql = user => wrap(`  t_lock timestamptz; t_end timestamptz;
BEGIN
  ${PICK}
  ${row(`'${user}'::uuid`, 'gen_random_uuid()')};
  t_lock := clock_timestamp();
  PERFORM pg_sleep(${HOLD_MS / 1000});
  t_end := clock_timestamp();
  RAISE EXCEPTION 'lockproof_a:%:%', ${epoch('t_lock')}, ${epoch('t_end')};
END;`)

// B: the same user, a different request id, while A holds. It must wait for A's transaction to end.
export const caseBSql = user => wrap(`  t_start timestamptz; t_end timestamptz;
BEGIN
  ${PICK}
  t_start := clock_timestamp();
  ${row(`'${user}'::uuid`, 'gen_random_uuid()')};
  t_end := clock_timestamp();
  RAISE EXCEPTION 'lockproof_b:%:%', ${epoch('t_start')}, ${epoch('t_end')};
END;`)

// Twin at the limit, ONE transaction, as service_role (what the edge function is): three rows, the twin of the third,
// a 4th NEW request, and a fresh person as the positive control. Each in its own subtransaction.
export const caseTwinSql = (u1, u2) => wrap(`  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid(); v_c3 uuid := gen_random_uuid();
  v_three text := 'unset'; v_twin text := 'unset'; v_fourth text := 'unset'; v_fresh text := 'unset';
BEGIN
  ${PICK}
  SET LOCAL ROLE service_role;
  BEGIN
    ${row(`'${u1}'::uuid`, 'v_c1')};
    ${row(`'${u1}'::uuid`, 'v_c2')};
    ${row(`'${u1}'::uuid`, 'v_c3')};
    v_three := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_three := SQLSTATE; END;
  BEGIN
    ${row(`'${u1}'::uuid`, 'v_c3')};
    v_twin := 'ACCEPTED';
  EXCEPTION WHEN OTHERS THEN v_twin := SQLSTATE; END;
  BEGIN
    ${row(`'${u1}'::uuid`, 'gen_random_uuid()')};
    v_fourth := 'ACCEPTED';
  EXCEPTION WHEN OTHERS THEN v_fourth := SQLSTATE; END;
  BEGIN
    ${row(`'${u2}'::uuid`, 'gen_random_uuid()')};
    v_fresh := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_fresh := SQLSTATE; END;
  RESET ROLE;
  RAISE EXCEPTION 'lockproof_t:%:%:%:%', v_three, v_twin, v_fourth, v_fresh;
END;`)

export const LEFTOVER_SQL = `SELECT EXISTS (SELECT 1 FROM public.dovec_leads WHERE name = 'LOCKPROOF') AS leftover`

const MARK = /lockproof_(a|b|t):([^\s"\\]+)/
export function parseMarker(res, kind) {
  const text = res?.error ?? ''
  const m = MARK.exec(text)
  if (!m || m[1] !== kind) return null
  return m[2].split(':')
}

const WORD = { '23505': 'unique_violation', 'DV429': 'rate_limited', accepted: 'accepted', ACCEPTED: 'accepted' }
const word = s => WORD[s] ?? 'other_error'

export function verdictLock(a, b) {   // a = [lockEpochMs, endEpochMs], b = [startEpochMs, endEpochMs]
  if (!a || !b || [...a, ...b].some(x => !/^\d+$/.test(x))) return { ok: false, line: 'lock case: INCONCLUSIVE, a session did not report its timings', ms: {} }
  const [aLock, aEnd, bStart, bEnd] = [...a, ...b].map(Number)
  const remaining = aEnd - bStart, wait = bEnd - bStart
  const started = bStart >= aLock && remaining >= MARGIN_MS
  const blocked = bEnd >= aEnd   // zero tolerance: both readings are clock_timestamp() on the one database host, and B cannot return before A's transaction ends, which is after A's reading
  const ms = { remaining_hold_ms: remaining, wait_ms: wait }
  const tail = `blocked=${blocked} remaining_hold_ms=${remaining} wait_ms=${wait}`
  if (!started) return { ok: false, line: `lock case: INCONCLUSIVE, B did not start inside A's hold (the two calls were not concurrent) ${tail}`, ms }
  return { ok: blocked, line: `lock case: ${blocked ? 'PASS' : 'FAIL'} ${tail}`, ms }
}

export function verdictTwin(t) {
  if (!t) return { ok: false, line: 'twin case: INCONCLUSIVE, the session did not report' }
  const [three, twin, fourth, fresh] = t
  const ok = three === 'accepted' && twin === '23505' && fourth === 'DV429' && fresh === 'accepted'
  return { ok, line: `twin case: ${ok ? 'PASS' : 'FAIL'} three_in=${word(three)} twin_at_limit=${word(twin)} new_fourth=${word(fourth)} other_person=${word(fresh)}` }
}

// Anything that leaves this process: uuids and ADA-n removed, long text cut. Used for unexpected errors only.
export const redact = s => String(s ?? '').replace(UUID, '<id>').replace(/ADA-\d+/g, '<ext>').replace(/\s+/g, ' ').slice(0, 160)

export async function runProof({ apply, post, sleep, uuid, log }) {
  const out = []
  const say = l => { out.push(l); log(l) }
  const pre = await post(PRECONDITION_SQL)
  if (pre.error) { say(`precondition: could not read the catalog (${redact(pre.error)})`); return { code: 1, out } }
  const fails = evalPrecondition(pre.rows?.[0])
  say(`precondition: ${fails.length ? 'REFUSED' : 'met'} (live limit function is the repeat-skip definer version, one BEFORE INSERT row trigger, a listed project exists)`)
  for (const f of fails) say(`  - ${f}`)
  if (fails.length) return { code: 1, out }
  if (apply !== 'true') {
    say('dry run: nothing was written. With apply, two cases run, every write rolled back:')
    say('  lock case: two concurrent sessions, same person; B must wait for A, A holds hold_ms=' + HOLD_MS)
    say('  twin case: one session as the service role; twin at the limit must be a unique violation, a new fourth must be rate limited')
    return { code: 0, out }
  }
  const u = uuid(), u1 = uuid(), u2 = uuid()
  let ok = true
  try {
    const aP = post(caseASql(u))
    await sleep(B_DELAY_MS)
    const bP = post(caseBSql(u))
    const [a, b] = await Promise.all([aP, bP])
    const v = verdictLock(parseMarker(a, 'a'), parseMarker(b, 'b'))
    if (!parseMarker(a, 'a') && a.error) say(`lock case: session A error: ${redact(a.error)}`)
    if (!parseMarker(b, 'b') && b.error) say(`lock case: session B error: ${redact(b.error)}`)
    say(v.line); ok = ok && v.ok
    const tw = await post(caseTwinSql(u1, u2))
    const t = parseMarker(tw, 't')
    if (!t && tw.error) say(`twin case: error: ${redact(tw.error)}`)
    const vt = verdictTwin(t)
    say(vt.line); ok = ok && vt.ok
  } catch (e) {
    ok = false
    say(`run aborted: ${redact(e.message)}`)
  } finally {
    const l = await post(LEFTOVER_SQL)
    const left = l.rows?.[0]?.leftover
    say(`leftover LOCKPROOF rows exist: ${left === false ? 'false' : left === true ? 'true' : 'unknown'}`)
    if (left !== false) ok = false
  }
  say(ok ? 'RESULT: all cases passed, nothing committed' : 'RESULT: FAILED')
  return { code: ok ? 0 : 1, out }
}
