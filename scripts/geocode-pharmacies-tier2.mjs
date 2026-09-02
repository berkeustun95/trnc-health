#!/usr/bin/env node
/**
 * Tier-2 pharmacy geocoder for public.facilities.
 *
 * Implements the tier 2 definition from migration 20260919 verbatim:
 *
 *   2  Google Places, accepted ONLY when it agrees with the address town and,
 *      where the number is a landline on a >=90%-pure exchange, with the phone
 *      prefix.
 *
 * Anything that fails the town test is NOT written. It goes to
 * hand-place-queue-YYYYMMDD-HHMM.csv for tier-3 placement by hand on satellite
 * imagery. Timestamped so runs never overwrite each other.
 * Writing a coordinate we cannot corroborate is the failure mode
 * facilities_coords_need_provenance exists to prevent.
 *
 * NOTE ON TIER DIRECTION: 3 is the most trustworthy, 1 the least. Do not
 * write `geocode_tier <= 2` meaning "the good ones".
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... node geocode-pharmacies-tier2.mjs [--limit 25] [--dry-run]
 *
 * Supabase creds follow the repo convention (import-gisekibris-events.mjs,
 * import-novest-properties.mjs, seed-explore-photos.mjs): the URL comes from
 * .env as EXPO_PUBLIC_SUPABASE_URL, and the key is chosen by mode, exactly as
 * seed-explore-photos.mjs does it —
 *
 *   --dry-run : EXPO_PUBLIC_SUPABASE_ANON_KEY (publishable, RLS-bound)
 *   writing   : the secret key from Keychain "ada-supabase-service-role"
 *
 * The legacy anon/service_role JWTs were disabled 2026-06-04; only the
 * sb_publishable_ / sb_secret_ pair works. Picking the key by mode means a dry
 * run is PHYSICALLY unable to write, not merely branched away from writing.
 *
 * ⚠ Under the publishable key the purity fetch sees only what RLS exposes
 *   (`public read live facilities`: status active, hidden_at null). Under the
 *   secret key it sees every row. The two can legitimately differ.
 *
 * Start with --limit 10 --dry-run and read the output.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEYCHAIN_SERVICE = 'ada-supabase-service-role';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 25;

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const fail = (...lines) => { console.error('\n' + lines.join('\n') + '\n'); process.exit(1); };

// Fails loudly. Never falls back to a hardcoded value or a prompt — a silent
// fallback here would either fail confusingly or use the wrong key.
function serviceRoleKey() {
  let out;
  try {
    out = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    fail(`Could not read Keychain entry "${KEYCHAIN_SERVICE}".`,
      '',
      'This means the entry is ABSENT **or** the read was denied by a sandbox —',
      'the two are indistinguishable from here, so do not assume it is missing.',
      'If it is genuinely absent, create it with:',
      `  security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`,
      '(paste the sb_secret_... key at the prompt — it is not echoed)');
  }
  const key = out.trim();
  if (!key) fail(`Keychain entry "${KEYCHAIN_SERVICE}" is empty.`);
  if (key.startsWith('sb_publishable_')) {
    fail(`Keychain entry "${KEYCHAIN_SERVICE}" holds the PUBLISHABLE key, not the secret one.`,
      'It is bound by RLS and cannot write coordinates to facilities.');
  }
  return key;
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env');

const SUPABASE_KEY = DRY_RUN
  ? (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
     || fail('EXPO_PUBLIC_SUPABASE_ANON_KEY missing — expected in .env'))
  : serviceRoleKey();

const { GOOGLE_PLACES_API_KEY } = process.env;
if (!GOOGLE_PLACES_API_KEY) {
  fail('Missing GOOGLE_PLACES_API_KEY.',
    '',
    'NOTE: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is NOT a substitute. It is restricted',
    'in Cloud Console to Android apps (com.berkeustun95.ada + SHA-1) and to the',
    'Maps SDK for Android, so places.googleapis.com rejects it from Node with',
    'HTTP 403 API_KEY_ANDROID_APP_BLOCKED. This needs a SEPARATE server-side key',
    'with Places API (New) enabled. Do not loosen the Android key\'s restriction.');
}

console.log(`auth: ${DRY_RUN ? 'publishable (dry-run, RLS-bound)' : 'secret key (Keychain)'}`);

// Timestamped, because a fixed name means every run silently destroys the
// previous run's queue — which is how an 82-row queue was lost. Local time.
const QUEUE_CSV = (() => {
  const d = new Date(), z = (x) => String(x).padStart(2, '0');
  return `hand-place-queue-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`
    + `-${z(d.getHours())}${z(d.getMinutes())}.csv`;
})();

const BBOX = { minLat: 34.95, maxLat: 35.75, minLng: 32.20, maxLng: 34.65 };
const CENTER = { latitude: 35.25, longitude: 33.4 };
const RADIUS_M = 50000;
const PURITY_THRESHOLD = 0.9;   // the migration's ">=90%-pure exchange"

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

// Every Supabase call goes through one of these two. PostgREST reports errors as
// a 4xx/5xx with a JSON body ({message, hint, code}); the previous code called
// .json() on that body unconditionally and handed an OBJECT to a for..of, which
// is why an auth failure surfaced 5 lines later as "all is not iterable" instead
// of as the 401 it was. Print the status and the body, at the call site.
async function sbCheck(path, init = {}, what = path, { soft = false } = {}) {
  let res;
  try {
    res = await sb(path, init);
  } catch (e) {
    if (soft) return { ok: false, detail: `network error: ${e.message}` };
    fail(`Supabase request failed (${what})`, `  network error: ${e.message}`);
  }
  if (!res.ok) {
    const body = (await res.text()) || '<empty body>';
    // soft: the caller survives the failure and reports it. Used ONLY by the
    // write pass, where one bad PATCH must not take the other 296 with it.
    // Reads stay fail-fast — a run built on a failed read is meaningless.
    if (soft) return { ok: false, detail: `${res.status} ${res.statusText}: ${body}` };
    fail(`Supabase ${res.status} ${res.statusText} (${what})`,
      `  ${body}`,
      '',
      res.status === 401 || res.status === 403
        ? '  401/403 here is almost always the key. Legacy anon/service_role JWTs\n'
          + '  were disabled 2026-06-04 — only sb_publishable_ / sb_secret_ work.'
        : '');
  }
  return res;
}

/**
 * Checked GET returning an array, with a TRUNCATION guard.
 *
 * PostgREST's server-side `max-rows` (1000 here) OVERRIDES a larger client
 * `limit`, silently. The purity table below is DERIVED from this fetch, so a
 * truncated read would quietly change which exchanges count as pure — i.e. it
 * would alter the tier-2 acceptance gate without changing a line of its logic.
 * Comparing the exact count against what arrived is the only form of this check
 * that works at any cap; testing `rows >= limit` is a truncation guard defeated
 * by truncation, which this repo has already shipped once.
 */
async function sbRows(path, what = path, { expectAll = true } = {}) {
  const res = await sbCheck(path, { headers: { Prefer: 'count=exact' } }, what);
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    fail(`Supabase returned a non-array for ${what}`, `  ${JSON.stringify(rows)}`);
  }
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  // expectAll=false for a query whose `limit` is a deliberate batch size (the
  // --limit run), where total > received is the NORMAL state and says how much
  // backlog remains. Only a query meant to read everything can be truncated.
  if (expectAll && Number.isFinite(total) && total > rows.length) {
    fail(`TRUNCATED: ${what}`,
      `  server holds ${total} rows, only ${rows.length} arrived (PostgREST max-rows).`,
      '  Page this query before trusting anything derived from it.');
  }
  rows._total = total;
  return rows;
}

const trLower = (s) =>
  (s || '').normalize('NFC').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

// Suffix tokens carried by nearly every pharmacy name, so they are worthless as
// evidence of identity — 'AKÇAY ECZANESİ' and 'ERİN ECZANESİ' share 'eczanesi'
// and nothing else. DERIVED through trLower(), not hand-typed: 'ECZANESI' with a
// DOTLESS I folds to 'eczanesı', which is a DIFFERENT STRING from 'eczanesi'.
// Miss that and the stray token overlaps between any two such names, so the guard
// passes everything while looking like it is checking something.
const NAME_NOISE = new Set(['eczanesi', 'eczanesı', 'ecznesi', 'pharmacy']);

/**
 * Identity tokens of a pharmacy name. Parentheticals are dropped BEFORE
 * tokenising (as separators they would leave their contents behind), and
 * single characters are dropped as initials/noise. \p{L} with /u so Turkish
 * and Greek letters are letters rather than separators.
 */
function nameTokens(s) {
  return new Set(
    trLower(s)
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1 && !NAME_NOISE.has(t))
  );
}

/**
 * THE locality, from Places' STRUCTURED addressComponents.
 *
 * This replaced a segment -2 parse of formattedAddress, which was guessing at an
 * unpromised format and guessing wrong: 48 of 93 rejects in the 2026-09-01 18:56 run were
 * 'town unresolved (Places side)', and the report showed street names where a locality
 * should have been. A formatted address is a DISPLAY string — Places is free to reorder
 * it, drop the locality, or put a neighbourhood there — while addressComponents is the
 * structured field that actually promises what each part is.
 *
 * 'locality' first, then 'administrative_area_level_2'. Small TRNC villages frequently
 * have no locality component at all and carry only the district at level 2, which is the
 * granularity this check wants anyway — the migration is explicit that this class of test
 * "confirms a town and never a street".
 */
function localityOf(place) {
  for (const type of ['locality', 'administrative_area_level_2']) {
    const c = (place?.addressComponents || []).find((x) => (x.types || []).includes(type));
    if (c) return c.longText || c.shortText || null;
  }
  return null;
}

/**
 * The OLD segment -2 parse. Retained ONLY as a last-resort fallback for the gap report
 * when a place carries no addressComponents at all, so an unresolvable row still names
 * something a human can act on. Never the primary source any more.
 */
function localityGuess(formatted) {
  const parts = (formatted || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return '<empty formattedAddress>';
  const seg = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return seg.replace(/\s*\d[\d\s]*$/, '').trim() || seg;
}

/**
 * Collapse a per-row reason into a family, so the breakdown answers "is the
 * guard working or is my locality map short?" at a glance. Counting the raw
 * strings cannot answer that — every 'town X vs Y' is its own string, so the
 * signal would be spread across a long tail of count-1 rows.
 */
function reasonFamily(why) {
  if (why === 'name-mismatch' || why === 'shared-point' || why === 'no-result') return why;
  if (why.startsWith('error:')) return 'error';
  if (why.startsWith('phone exchange')) return 'phone contradiction';
  const m = why.match(/^town (.+) vs (.+)$/);
  if (m) {
    if (m[1] === '?' && m[2] === '?') return 'town unresolved (both sides)';
    if (m[2] === '?')                 return 'town unresolved (Places side)';
    if (m[1] === '?')                 return 'town unresolved (our address)';
    return 'town mismatch (both resolved)';
  }
  return why;
}

// Town resolution is deliberately district-level. The migration is explicit
// that this class of check "confirms a town and never a street" — so it is
// used to REJECT wrong towns, never to claim street accuracy.
const TOWN = {
  lefkoşa: 'Lefkoşa', nicosia: 'Lefkoşa', gönyeli: 'Lefkoşa', yenikent: 'Lefkoşa',
  hamitköy: 'Lefkoşa', köşklüçiftlik: 'Lefkoşa', köşlüçiftlik: 'Lefkoşa',
  ortaköy: 'Lefkoşa', kumsal: 'Lefkoşa', yenişehir: 'Lefkoşa', göçmenköy: 'Lefkoşa',
  taşkınköy: 'Lefkoşa', metehan: 'Lefkoşa', kermiya: 'Lefkoşa', aydemet: 'Lefkoşa',
  çağlayan: 'Lefkoşa', kızılbaş: 'Lefkoşa', dereboyu: 'Lefkoşa', 'küçük kaymaklı': 'Lefkoşa',
  kızılay: 'Lefkoşa',
  // Üst Mesarya -> nicosia (constants/regions.js anchors). Minareliköy is not in that
  // table, but every address carrying it reads "Minareliköy, Değirmenlik, Üst Mesarya"
  // and Değirmenlik IS anchored to nicosia.
  haspolat: 'Lefkoşa', demirhan: 'Lefkoşa', minareliköy: 'Lefkoşa',
  // regions.js anchors Cihangir to nicosia [Üst Mesarya], and the 08:10 queue shows
  // Places already resolving these two rows to Lefkoşa — so this closes 'town ? vs
  // Lefkoşa' from our side, which was the only side that was blank.
  cihangir: 'Lefkoşa',

  girne: 'Girne', kyrenia: 'Girne', lapta: 'Girne', alsancak: 'Girne',
  karaoğlanoğlu: 'Girne', çatalköy: 'Girne', doğanköy: 'Girne', karakum: 'Girne',
  zeytinlik: 'Girne', bellapais: 'Girne', ozanköy: 'Girne',
  'aşağı dikmen': 'Girne', çamlıbel: 'Girne', boğazköy: 'Girne',

  gazimağusa: 'Gazimağusa', mağusa: 'Gazimağusa', famagusta: 'Gazimağusa',
  sakarya: 'Gazimağusa', maraş: 'Gazimağusa', dumlupınar: 'Gazimağusa',
  çanakkale: 'Gazimağusa', baykal: 'Gazimağusa', kaliland: 'Gazimağusa',
  ayluga: 'Gazimağusa', karakol: 'Gazimağusa', salamis: 'Gazimağusa',
  tatlısu: 'Gazimağusa',
  // 'boğaziçi', NOT 'yeni boğaziçi'. The compound key does not work: in the string
  // "yeni boğaziçi" the existing 'boğaz'(İskele) key sits at index 5 while the compound
  // sits at 0, so the LATER index wins outright and the compound never fires — the
  // longest-match tie-break cannot help, because the indices are not tied. The short
  // key ties with 'boğaz' at the same index and wins on length, and it covers the bare
  // "Boğaziçi" spelling too.
  boğaziçi: 'Gazimağusa',
  // ── Mesarya villages, mapped to their DISTRICT, not to 'Mesarya' ─────────
  // 'Mesarya' is a pharmacists'-chamber duty-rota zone, NOT a district —
  // constants/regions.js says so and folds it: Alt Mesarya -> famagusta, Üst
  // Mesarya -> nicosia, except Geçitkale and Serdarlı which sit in Gazimağusa.
  // This map is compared against ourTown, which comes from facilities.address, and
  // those addresses say "Gazimağusa" or "Lefkoşa" — never "Mesarya". Mapping these
  // to 'Mesarya' would turn a "town ? vs ?" reject into a "Gazimağusa vs Mesarya"
  // reject: still rejected, but now disguised as a real geographic disagreement.
  akdoğan: 'Gazimağusa', vadili: 'Gazimağusa', türkmenköy: 'Gazimağusa',
  paşaköy: 'Gazimağusa', beyarmudu: 'Gazimağusa', inönü: 'Gazimağusa',
  serdarlı: 'Gazimağusa', geçitkale: 'Gazimağusa', dörtyol: 'Gazimağusa',
  // Not on the request list — found while checking it. SERVET GÖKŞİN's address
  // ("…Dilekkaya, Alt Mesarya") was the only pending row left with a null ourTown, and
  // regions.js anchors Dilekkaya to famagusta. Same class as Dörtyol.
  //
  // ⚠ DO NOT bulk-import the regions.js anchor table into this map. 60 of its comment
  //   labels are absent from TOWN, but most are STREETS — "Atatürk Cad.", "Hazar Sok.",
  //   "Ecevit Cad." — and a street key here would match inside thousands of addresses
  //   and hand back the wrong district with confidence. Villages only, one at a time,
  //   each with a pending row that needs it.
  dilekkaya: 'Gazimağusa',
  // Unaccented Turkish, not Greek: Places returns 'gazimagusa' with a plain g. The
  // accented key above cannot match it — ğ and g are different characters, and this map
  // deliberately does no accent folding (folding ö→o would make the Turkish town 'göt'
  // problem the moderation normalizer documents).
  gazimagusa: 'Gazimağusa',

  güzelyurt: 'Güzelyurt', morphou: 'Güzelyurt',
  lefke: 'Lefke', gemikonağı: 'Lefke', gaziveren: 'Lefke', yeşilyurt: 'Lefke',
  doğancı: 'Lefke',
  iskele: 'İskele', trikomo: 'İskele', boğaz: 'İskele', cevizli: 'İskele',
  bahçeler: 'İskele', ötüken: 'İskele', pamuklu: 'İskele', 'yeni iskele': 'İskele',
  // ── KARPAZ FOLDS TO İSKELE — IN THIS SCRIPT ONLY ────────────────────────
  // NOT because Karpaz is a rota zone; it is not. constants/regions.js makes it one of
  // the seven canonical REGIONS, enforced by CHECK constraints on job_postings, beaches
  // and landmarks, and carries an explicit "DO NOT correct this back to six — it is a
  // product decision". That decision stands and regions.js is untouched.
  //
  // The reason is narrower. THIS map exists to ask whether two sources agree about
  // where a pharmacy is, and the second source is Google, which uses OFFICIAL districts
  // — where the Karpaz peninsula IS İskele. Our addresses say "…Yenierenköy, Karpaz",
  // so ourTown was Karpaz while Places said İskele, and two sources describing the same
  // place in different vocabularies were scored as a geographic disagreement. Measured
  // in the 2026-09-02 08:10 queue: 'town Karpaz vs İskele' on KARPAZIN and
  // FATMA KAHYAOĞLU, both of which Places had matched correctly.
  //
  // Folding here changes only what this geocoder considers "agreement". It does not
  // touch REGIONS, resolveRegion(), the district chips, or any DB constraint — and the
  // app still calls the peninsula Karpaz everywhere a user can see.
  yenierenköy: 'İskele', 'yeni erenköy': 'İskele', karpaz: 'İskele',
  mehmetçik: 'İskele', bafra: 'İskele', dipkarpaz: 'İskele',

  // ── Greek localities ──────────────────────────────────────────────────────
  // Places answers in whatever language it has for a feature, so a TRNC result
  // can come back Greek. Without these the town test finds no theirTown, and a
  // perfectly good coordinate is REJECTED for a language mismatch rather than a
  // geographic one — a false reject that costs a hand-placement.
  //
  // TWO SPELLINGS PER NAME, AND BOTH ARE REQUIRED. Greek drops the tonos when
  // uppercased, so 'ΛΕΥΚΩΣΙΑ'.toLowerCase() is 'λευκωσια' while
  // 'Λευκωσία'.toLowerCase() is 'λευκωσία' — different strings, and townOf()
  // matches by substring, so listing one form silently misses the other.
  // Every key below was DERIVED by running the real forms through trLower(),
  // not typed by hand. Case-insensitivity comes free from that same call; the
  // final sigma is handled by toLowerCase (ΑΜΜΟΧΩΣΤΟΣ -> αμμοχωστος).
  //
  // Genitives are listed as their own keys rather than stripped by a rule:
  // Greek genitive is not a suffix you can chop safely (Αμμόχωστος ->
  // Αμμοχώστου moves the accent and changes the stem vowel), and a wrong chop
  // would invent a town rather than fail to find one.
  'λευκωσία': 'Lefkoşa',   'λευκωσίας': 'Lefkoşa',      // Nicosia (nom./gen.)
  'λευκωσια': 'Lefkoşa',   'λευκωσιας': 'Lefkoşa',      // …uppercased source
  'κερύνεια': 'Girne',     'κερύνειας': 'Girne',        // Kyrenia
  'κερυνεια': 'Girne',     'κερυνειας': 'Girne',
  'αμμόχωστος': 'Gazimağusa', 'αμμοχώστου': 'Gazimağusa',  // Famagusta
  'αμμοχωστος': 'Gazimağusa', 'αμμοχωστου': 'Gazimağusa',
  'μόρφου': 'Güzelyurt',   'μορφου': 'Güzelyurt',       // Morphou
  'λεύκα': 'Lefke',        'λεύκας': 'Lefke',           // Lefka
  'λευκα': 'Lefke',        'λευκας': 'Lefke',
  'τρίκωμο': 'İskele',     'τρικώμου': 'İskele',        // Trikomo
  'τρικωμο': 'İskele',     'τρικωμου': 'İskele',
  'μάνδρες': 'Lefkoşa',    'μανδρών': 'Lefkoşa',        // Mandres (Yılmazköy)
  'μανδρες': 'Lefkoşa',    'μανδρων': 'Lefkoşa',

  // ── ROMANISED Greek ───────────────────────────────────────────────────────
  // The Greek block above covers the Greek ALPHABET only. Places also returns Greek
  // place names transliterated into Latin — a different string entirely, matching
  // neither the Greek keys nor the Turkish ones — which is why 'Ammochostos' and
  // 'Morfou' came back unresolved from a map that already knew 'αμμόχωστος' and
  // 'μόρφου'. Same names, third spelling.
  ammochostos: 'Gazimağusa',   // Famagusta
  morfou: 'Güzelyurt',         // sits alongside the existing 'morphou' spelling
  ortakioi: 'Lefkoşa',         // Ortaköy
  lefkosia: 'Lefkoşa',         // Nicosia
  keryneia: 'Girne',           // Kyrenia
  // ⚠ 'lefka' is a PREFIX of 'Lefkara', a village in the REPUBLIC of Cyprus, so a
  //   Lefkara address would resolve to Lefke. Harmless today only because Lefkara sits
  //   at ~34.87N, below this script's BBOX floor of 34.95, so such a result is filtered
  //   out before townOf is ever called on it. If the BBOX is ever widened south, revisit
  //   this key first. 'trikomo' is NOT listed here — it is already a Latin key above.
  lefka: 'Lefke',
};

/**
 * Last matching town wins — TRNC addresses put the district at the end.
 *
 * ON A TIE, THE LONGER NEEDLE WINS. Without that, a key that is a PREFIX of another
 * key silently defeats it: both match at the same index, `i > at` is strict, and
 * whichever was declared first keeps the slot. Two keys hit this exactly —
 * 'boğaz'(İskele) is a prefix of 'boğazköy'(Girne) and of 'yeni boğaziçi'
 * (Gazimağusa) — so a bare "Boğazköy" resolved to İskele and the more specific keys
 * were INERT while looking present. It matters more now that localityOf() returns a
 * BARE locality ("Boğazköy") rather than a full address in which the district
 * appears later and wins on index.
 *
 * Longer = more specific, so preferring it is right in general, not a patch for
 * these two. Verified not to change any other resolution: "Boğaz"->İskele,
 * "Yeni İskele"->İskele, "İskele"->İskele are all unaffected.
 */
function townOf(text) {
  const t = trLower(text);
  let best = null, at = -1, len = -1;
  for (const [needle, town] of Object.entries(TOWN)) {
    const i = t.lastIndexOf(needle);
    if (i > at || (i === at && i !== -1 && needle.length > len)) {
      at = i; len = needle.length; best = town;
    }
  }
  return best;
}

/** '(0392) 227 16 64' -> '227'. Landlines only; 05xx mobiles have no geography. */
function exchangeOf(phone) {
  const d = (phone || '').replace(/\D/g, '');
  const m = d.match(/^(?:90)?0?392(\d{3})/);
  return m ? m[1] : null;
}

async function searchPlace(name, address) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.displayName,places.location,places.formattedAddress,places.primaryType,'
        + 'places.addressComponents',
    },
    body: JSON.stringify({
      textQuery: `${name}, ${address}`,
      languageCode: 'tr',
      maxResultCount: 3,
      locationBias: { circle: { center: CENTER, radius: RADIUS_M } },
    }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text()}`);
  return (await res.json()).places || [];
}

const inBox = (lat, lng) =>
  lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. exchange purity, computed from the table, never assumed ------------

const all = await sbRows(
  'facilities?type=eq.pharmacy&select=id,name,address,phone&limit=2000',
  'pharmacy corpus for exchange purity'
);
console.log(`purity corpus: ${all.length} pharmacy rows visible to this key`);

const byExchange = {};
for (const f of all) {
  const ex = exchangeOf(f.phone);
  const town = townOf(f.address);
  if (!ex || !town) continue;
  (byExchange[ex] ||= {})[town] = (byExchange[ex][town] || 0) + 1;
}
const pureExchange = {};
for (const [ex, towns] of Object.entries(byExchange)) {
  const total = Object.values(towns).reduce((a, b) => a + b, 0);
  const [top, n] = Object.entries(towns).sort((a, b) => b[1] - a[1])[0];
  if (n / total >= PURITY_THRESHOLD && total >= 3) pureExchange[ex] = top;
}
console.log(`exchange purity: ${Object.keys(pureExchange).length} pure of ${Object.keys(byExchange).length}`);
console.log(`  impure (carry no signal): ${
  Object.keys(byExchange).filter((e) => !pureExchange[e]).join(', ') || 'none'}\n`);

// --- 2. resolve -----------------------------------------------------------

// --- 1b. CROSS-RUN dedup seed ---------------------------------------------
// The in-run guard cannot see a point an EARLIER batch already wrote: that row
// has left `pending` (its latitude is no longer null) while its coordinate is
// still claimable. Same AKÇAY/ERİN failure, spread across two runs.
// NOT filtered to pharmacies — a pharmacy landing on a hospital's pin is just
// as wrong, and the whole table is the authority on what is already occupied.
const claimedRows = await sbRows(
  'facilities?latitude=not.is.null&select=id,name,type,latitude,longitude&limit=2000',
  'coordinates already written to facilities'
);
const preClaimed = new Map();
for (const r of claimedRows) {
  const k = `${Number(r.latitude).toFixed(4)},${Number(r.longitude).toFixed(4)}`;
  if (!preClaimed.has(k)) preClaimed.set(k, r);
}
console.log(`already placed: ${claimedRows.length} facilities carry coordinates`
  + ` (${preClaimed.size} distinct points)`);

const pending = await sbRows(
  'facilities?type=eq.pharmacy&latitude=is.null&select=id,name,address,phone'
  + `&order=name&limit=${LIMIT}`,
  'pharmacies awaiting coordinates',
  { expectAll: false }   // --limit is a batch size, not a cap being hit by accident
);
console.log(`backlog: ${pending._total} pharmacies have no coordinates`);

console.log(`${pending.length} to resolve (limit ${LIMIT})\n`);

const queue = [];
let written = 0, rejected = 0, missed = 0;
const seenPoints = new Map();
const accepted = new Map();   // key(4dp) -> {f, hit, corroboration}; written AFTER the loop
const poisoned = new Set();   // keys revoked by a collision — never re-acceptable
const crossRunHits = [];      // collisions with a coordinate already in the table
const localityGaps = [];      // Places localities TOWN could not resolve

for (const [i, f] of pending.entries()) {
  const label = `[${i + 1}/${pending.length}] ${f.name}`;
  const ourTown = townOf(f.address);
  try {
    const places = await searchPlace(f.name, f.address);
    const candidates = places.filter((p) => inBox(p.location.latitude, p.location.longitude));
    if (!candidates.length) {
      missed++;
      console.log(`${label}\n    NO RESULT in TRNC bounds`);
      queue.push([f.id, f.name, f.address, '', '', 'no-result']);
      continue;
    }

    const ex = exchangeOf(f.phone);
    const phonePredicts = ex ? pureExchange[ex] : null;
    const ourName = nameTokens(f.name);

    // EVERY CANDIDATE IS EVALUATED, NOT JUST THE FIRST.
    //
    // Places orders by its own relevance, which is not our relevance: it does not know
    // that we require the town to agree and the name to share a token. Taking result [0]
    // and rejecting on it threw away results [1] and [2] unexamined — so a pharmacy whose
    // correct match sat second was rejected while the answer was in the response.
    //
    // The GATES ARE UNCHANGED. Each candidate faces exactly the same three tests; this
    // only stops us discarding the ones we never looked at. First candidate to pass all
    // three wins — "first" by Places' own ranking, so on a tie we still defer to it.
    let chosen = null;
    let firstFail = null;
    for (const p of candidates) {
      const theirLocality = localityOf(p);
      // Structured component first. formattedAddress is kept as a FALLBACK — it is a
      // whole-string scan for a known town, not the segment -2 guess, so it can only add
      // resolutions, never change one the component already settled.
      const theirTown = townOf(theirLocality) || townOf(p.formattedAddress || '');
      const townAgrees = ourTown && theirTown && ourTown === theirTown;
      const nameAgrees = [...ourName].some((t) => nameTokens(p.displayName?.text || '').has(t));
      const phoneAgrees = phonePredicts ? phonePredicts === theirTown : null;
      const cand = { p, theirLocality, theirTown, townAgrees, nameAgrees, phoneAgrees };
      if (townAgrees && nameAgrees && phoneAgrees !== false) { chosen = cand; break; }
      if (!firstFail) firstFail = cand;
    }

    // The reject reason describes the FIRST candidate, so reasons stay comparable with
    // earlier runs' CSVs; `tried` says how many were actually examined.
    const best = chosen || firstFail;
    const hit = best.p;
    const { theirTown, theirLocality, townAgrees, nameAgrees, phoneAgrees } = best;
    const tried = candidates.length;

    // The migration's gate, plus an identity check: town must agree, the names
    // must share a token, and the phone — where it carries signal — must not
    // contradict. An exchange that carries no signal (impure, or a mobile with
    // no geography at all) does NOT block acceptance; it just leaves the row
    // corroborated by one signal instead of two.
    //
    // The name check is here because of a confirmed wrong pin: AKÇAY ECZANESİ
    // (Akçay village, Güzelyurt, exchange 725 — impure) matched ERİN ECZANESİ
    // in Güzelyurt town, several km away, and was accepted on town agreement
    // alone. Town agreement is DISTRICT-level — the migration says this class
    // of check "confirms a town and never a street" — so it cannot tell two
    // pharmacies in one district apart. The name token check can, and does:
    // {akçay} vs {erin} share nothing. A wrong pin is the failure that makes
    // someone DRIVE to the wrong place, which is worse than no pin at all.
    //
    // Which signals actually fired is recorded per row in geocode_corroboration
    // below — one entry or two — so a later review pass can sort by it.
    if (!townAgrees || !nameAgrees || phoneAgrees === false) {
      rejected++;
      // Gap report data. ourTown set + theirTown null implies the town branch
      // below, so this cannot mislabel a name or phone reject.
      if (ourTown && !theirTown) {
        // The structured component is what TOWN failed to recognise. Falls back to the
        // old parse only when Places returned no components at all, so the reported
        // string is a real locality rather than whatever sat in segment -2.
        localityGaps.push(theirLocality || localityGuess(hit.formattedAddress || ''));
      }
      const why = !townAgrees
        ? `town ${ourTown || '?'} vs ${theirTown || '?'}`
        : !nameAgrees
        ? 'name-mismatch'
        : phoneAgrees === false
        ? `phone exchange ${ex} implies ${phonePredicts}`
        // UNREACHABLE by construction: entering this block requires one of the
        // three conditions above, and each has its own branch. Kept, not
        // deleted, so the reason string survives if the two-signal rule is
        // reinstated. Do not read a 'single-signal' row in the CSV as current
        // behaviour — nothing can emit one today.
        : 'single-signal';
      console.log(`${label}\n    REJECT (${why}) -> hand-place   [${tried} candidate(s) tried]`
        + `\n      places: ${hit.displayName?.text || '<no displayName>'}`
        + `\n      locality: ${theirLocality || '<none in addressComponents>'}`
        + `\n      ${hit.formattedAddress || '<no formattedAddress>'}`
        + `\n      ${hit.location.latitude},${hit.location.longitude}`);
      queue.push([f.id, f.name, f.address, hit.location.latitude, hit.location.longitude, why]);
      continue;
    }

    const corroboration = ['address_town'];
    if (phoneAgrees === true) corroboration.push('phone_exchange');
    // Structurally always true under the current gate (!nameAgrees rejects above), but
    // written conditionally to mirror the line above and to stay correct if the gate is
    // ever loosened. Vocabulary documented by 20261005 — apply it or this value is
    // undocumented, not invalid: the column has no CHECK.
    if (nameAgrees) corroboration.push('name_match');

    const key = `${hit.location.latitude.toFixed(4)},${hit.location.longitude.toFixed(4)}`;

    // A SHARED POINT REJECTS BOTH ROWS. Two pharmacies cannot occupy one
    // coordinate, so at least one of the pair is wrong — and nothing here can
    // say which, so neither is trustworthy. This is the AKÇAY/ERİN failure in
    // the case where the names happen to share a token and slip the name
    // check. Previously it was only a summary warning, i.e. a wrong pin that
    // announced itself and was written anyway.
    // CROSS-RUN COLLISION. The point is already written to facilities. Reject
    // this row, but do NOT revoke the holder: revoking means an UPDATE that
    // clears a LIVE coordinate, which is a far bigger act than declining to
    // write a new one, and nothing here can say which of the two is wrong.
    // Reported in the summary so the call stays a human one.
    if (preClaimed.has(key)) {
      const owner = preClaimed.get(key);
      rejected++;
      console.log(`${label}\n    REJECT (shared-point) -> hand-place`
        + `\n      places: ${hit.displayName?.text || '<no displayName>'}`
        + `\n      ${hit.formattedAddress || '<no formattedAddress>'}`
        + `\n      ${hit.location.latitude},${hit.location.longitude}`
        + `\n      ↩ ${key} is ALREADY held by [${owner.name}] — left in place, see summary`);
      queue.push([f.id, f.name, f.address, hit.location.latitude, hit.location.longitude, 'shared-point']);
      crossRunHits.push({ row: f, owner, key });
      continue;
    }

    if (poisoned.has(key) || accepted.has(key)) {
      rejected++;
      console.log(`${label}\n    REJECT (shared-point) -> hand-place`
        + `\n      places: ${hit.displayName?.text || '<no displayName>'}`
        + `\n      ${hit.formattedAddress || '<no formattedAddress>'}`
        + `\n      ${hit.location.latitude},${hit.location.longitude}`);
      queue.push([f.id, f.name, f.address, hit.location.latitude, hit.location.longitude, 'shared-point']);
      // The revocation is a consequence of THIS row, so it prints under this
      // row's header rather than orphaned above it.
      const prior = accepted.get(key);
      if (prior) {
        accepted.delete(key);
        poisoned.add(key);
        rejected++;
        queue.push([prior.f.id, prior.f.name, prior.f.address,
          prior.hit.location.latitude, prior.hit.location.longitude, 'shared-point']);
        console.log(`      ↩ REVOKED [${prior.f.name}] — it claimed ${key} first;`
          + ` both are now hand-place, we cannot tell which is wrong`);
      }
      continue;
    }

    accepted.set(key, { f, hit, corroboration });
    console.log(`${label}\n    OK tier 2 [${corroboration.join(', ')}]  ${theirTown}`
      + `${tried > 1 ? `   [candidate ${candidates.indexOf(hit) + 1} of ${tried}]` : ''}`
      + `\n      ${hit.location.latitude},${hit.location.longitude}`
      + `\n      places: ${hit.formattedAddress || '<no formattedAddress>'}`);
  } catch (err) {
    missed++;
    console.log(`${label}\n    ERROR ${err.message}`);
    queue.push([f.id, f.name, f.address, '', '', `error: ${err.message}`]);
  }
  await sleep(120);
}

// --- 3. TALLY --------------------------------------------------------------
for (const { hit } of accepted.values()) {
  const k = `${hit.location.latitude.toFixed(4)},${hit.location.longitude.toFixed(4)}`;
  seenPoints.set(k, (seenPoints.get(k) || 0) + 1);
}
written = accepted.size;

// --- 4. the fixture's failure, as a check ---------------------------------
// The Nominatim seed put 387 rows on 142 points. If accepted coordinates
// collapse like that, Places is returning centroids and the run is bad
// regardless of what any per-row check said.
//
// NOTE: with shared-point rejection above, no accepted row can share a point,
// so dupes is now structurally 0 and this warning is unreachable. Kept rather
// than deleted — it is the backstop if the rejection is ever loosened, and a
// non-zero here would mean the dedupe itself is broken.
const dupes = [...seenPoints.values()].filter((n) => n > 1).length;
const collapse = written ? seenPoints.size / written : 1;

// --- 5. reject breakdown + locality gaps ----------------------------------
const byReason = new Map();
for (const row of queue) {
  const fam = reasonFamily(String(row[5] ?? ''));
  byReason.set(fam, (byReason.get(fam) || 0) + 1);
}
const reasonReport = [...byReason.entries()].sort((a, b) => b[1] - a[1])
  .map(([r, n]) => `    ${String(n).padStart(5)}  ${r}`).join('\n');

const byLocality = new Map();
for (const g of localityGaps) byLocality.set(g, (byLocality.get(g) || 0) + 1);
const localityReport = [...byLocality.entries()].sort((a, b) => b[1] - a[1])
  .map(([loc, n]) => `    ${String(n).padStart(5)}  ${loc}`).join('\n');

const crossRunReport = crossRunHits
  .map((h) => `    ${h.key}  ${h.row.name}\n${' '.repeat(10)}already held by [${h.owner.name}]`
    + ` (${h.owner.type}) — NOT revoked, your call`).join('\n');

// --- 6. PERSIST THE QUEUE AND REPORT, *BEFORE* ANY WRITE ------------------
// Order is deliberate. The write pass can fail; the queue is the record of
// everything this run decided, and losing it costs a whole Places pass. So it
// lands on disk and on screen while nothing can still go wrong.
//
// Consequence: the counts below describe what the run DECIDED, not what
// reached the database. The write pass prints its own result underneath.
writeFileSync(QUEUE_CSV,
  [['id', 'name', 'address', 'places_lat', 'places_lng', 'reason'], ...queue]
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));

console.log(`
-----------------------------------------
  accepted tier 2  ${written}${DRY_RUN ? '' : '   (write pass below)'}
  rejected         ${rejected}   -> ${QUEUE_CSV}
  no result/error  ${missed}
  distinct points  ${seenPoints.size} of ${written} accepted (${(collapse * 100).toFixed(0)}%)
  shared points    ${dupes}
-----------------------------------------
  queue by reason (everything in ${QUEUE_CSV}):
${reasonReport || '    (none)'}

  cross-run collisions — point already in facilities${
    crossRunHits.length ? ` (${crossRunHits.length})` : ''}:
${crossRunReport || '    (none)'}

  Places localities TOWN could not resolve${
    localityGaps.length ? ` (${localityGaps.length} rejects, ${byLocality.size} distinct)` : ''}:
${localityReport || '    (none)'}
    ^ candidates only — segment -2 of formattedAddress, so a street can slip in.
      NOT added to TOWN automatically; decide which are real first.
-----------------------------------------
${DRY_RUN ? 'DRY RUN — nothing written.\n' : ''}${
  collapse < 0.95
    ? 'WARNING: coordinates are collapsing onto shared points. This is the\n'
      + 'Nominatim fixture failure. Stop and inspect before writing more.\n'
    : ''}`);

// --- 7. WRITE PASS — last, and per-row survivable -------------------------
// After the loop because a collision is only visible when the SECOND row
// claims a point, and both must be rejected — impossible to honour if the
// first was already PATCHed. After the report because a failed PATCH must not
// take the queue file with it.
if (!DRY_RUN) {
  const writeFailures = [];
  let ok = 0;
  console.log(`write pass — PATCHing ${accepted.size} rows...`);
  for (const { f, hit, corroboration } of accepted.values()) {
    const res = await sbCheck(`facilities?id=eq.${f.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        latitude: hit.location.latitude,
        longitude: hit.location.longitude,
        geocode_source: 'google_places',
        geocode_tier: 2,
        geocode_corroboration: corroboration,
        geocoded_at: new Date().toISOString(),
      }),
    }, `PATCH ${f.name}`, { soft: true });
    if (res.ok) ok++;
    else {
      writeFailures.push({ f, detail: res.detail });
      console.log(`  FAILED ${f.name} — ${res.detail}`);
    }
  }
  console.log(`\nwrite pass: ${ok} written, ${writeFailures.length} failed`);
  if (writeFailures.length) {
    console.log(`
-----------------------------------------
  THESE ROWS DID NOT REACH THE DATABASE (${writeFailures.length})
  They are NOT in ${QUEUE_CSV} — that file holds rejects, and these were
  accepted. Their latitude is still null, so a later run will retry them.
-----------------------------------------`);
    for (const w of writeFailures) {
      console.log(`  ${w.f.id}  ${w.f.name}\n      ${w.detail}`);
    }
  }
}
