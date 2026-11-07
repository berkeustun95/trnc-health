// The Friday "Bu hafta sonu" push (Explore stage 4, 2026-11-07): what the message says. Pure, so
// digest_test.ts runs it under `deno test` with no network.

const TZ = 'Asia/Famagusta'
const LANG_CODE: Record<string, string> = {
  English: 'en', Turkish: 'tr', Arabic: 'ar', Russian: 'ru', Greek: 'el',
  French: 'fr', Spanish: 'es', German: 'de', Persian: 'fa',
}

// TRNC wall-clock date parts of an instant.
function cyprusYmd(at: Date): { y: number; m: number; d: number; dow: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(at)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), dow }
}

// The instant of TRNC local midnight starting the given calendar day (DST-correct: probe the offset).
function cyprusMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0)
  for (const off of [2, 3]) {
    const at = new Date(guess - off * 3600_000)
    const c = cyprusYmd(at)
    const hh = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(at))
    if (c.y === y && c.m === m && c.d === d && hh === 0) return at
  }
  return new Date(guess - 3 * 3600_000)
}

// The coming weekend: Saturday 00:00 → Monday 00:00 TRNC. On Saturday it is this weekend, on Sunday
// what is left of it (from Sunday 00:00).
export function weekendWindow(now: Date): { from: Date; to: Date } {
  const c = cyprusYmd(now)
  const toSat = c.dow === 6 ? 0 : c.dow === 0 ? -1 : 6 - c.dow
  const base = new Date(Date.UTC(c.y, c.m - 1, c.d + toSat))
  const sat = { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() }
  const monDate = new Date(Date.UTC(sat.y, sat.m - 1, sat.d + 2))
  const from = c.dow === 0 ? cyprusMidnight(c.y, c.m, c.d) : cyprusMidnight(sat.y, sat.m, sat.d)
  return { from, to: cyprusMidnight(monDate.getUTCFullYear(), monDate.getUTCMonth() + 1, monDate.getUTCDate()) }
}

export interface DigestEvent { title: string; start_date: string; end_date: string | null }
export interface DigestPlace { name: string; name_i18n: Record<string, string> | null }

// Listed inside the window: starts before it ends, and is still on when it starts (no end = that day).
export function inWindow(e: DigestEvent, w: { from: Date; to: Date }): boolean {
  const s = new Date(e.start_date).getTime()
  if (!Number.isFinite(s) || s >= w.to.getTime()) return false
  const end = e.end_date ? new Date(e.end_date).getTime() : s + 18 * 3600_000
  return end > w.from.getTime()
}

// One place a week, the same for everyone: ISO week number picks from a stable list.
export function weekPick<T>(rows: T[], now: Date): T | null {
  if (!rows.length) return null
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const day = (new Date(t).getUTCDay() + 6) % 7
  const thu = new Date(t - day * 86400_000 + 3 * 86400_000)
  const jan4 = Date.UTC(thu.getUTCFullYear(), 0, 4)
  const week = 1 + Math.round(((thu.getTime() - jan4) / 86400_000 - 3 + ((new Date(jan4).getUTCDay() + 6) % 7)) / 7)
  return rows[week % rows.length]
}

const TITLE: Record<string, string> = {
  English: '🎉 This weekend on ADA', Turkish: "🎉 Bu hafta sonu ADA'da", Arabic: '🎉 عطلة نهاية هذا الأسبوع على ADA',
  Russian: '🎉 На этих выходных в ADA', Greek: '🎉 Αυτό το σαββατοκύριακο στο ADA', French: '🎉 Ce week-end sur ADA',
  Spanish: '🎉 Este fin de semana en ADA', German: '🎉 Dieses Wochenende bei ADA', Persian: '🎉 این آخر هفته در ADA',
}
const MORE: Record<string, string> = {
  English: '+{n} more events', Turkish: '+{n} etkinlik daha', Arabic: '+{n} فعاليات أخرى', Russian: 'и ещё {n} событий',
  Greek: '+{n} ακόμη εκδηλώσεις', French: '+{n} autres événements', Spanish: '+{n} eventos más', German: '+{n} weitere Events',
  Persian: '+{n} رویداد دیگر',
}
const VISIT: Record<string, string> = {
  English: 'Worth a visit: {p}', Turkish: 'Gezmek için: {p}', Arabic: 'يستحق الزيارة: {p}', Russian: 'Стоит посетить: {p}',
  Greek: 'Αξίζει μια επίσκεψη: {p}', French: 'À visiter : {p}', Spanish: 'Para visitar: {p}', German: 'Einen Besuch wert: {p}',
  Persian: 'ارزش دیدن دارد: {p}',
}

export function digestMessage(lang: string, events: DigestEvent[], place: DigestPlace | null): { title: string; body: string } {
  const L = TITLE[lang] ? lang : 'English'
  // Titles as written: re-casing ALL-CAPS breaks either Turkish (KIBRIS → Kibris) or English (PIG → Pıg).
  const named = events.slice(0, 2).map(e => e.title.trim())
  const parts: string[] = []
  if (named.length) parts.push(named.join(' · ') + (events.length > 2 ? ` ${MORE[L].replace('{n}', String(events.length - 2))}` : ''))
  if (place) {
    const pn = place.name_i18n?.[LANG_CODE[L]] || place.name_i18n?.en || place.name
    parts.push(VISIT[L].replace('{p}', pn))
  }
  return { title: TITLE[L], body: parts.join('\n') }
}
