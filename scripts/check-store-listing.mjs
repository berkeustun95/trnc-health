#!/usr/bin/env node
// ─── Play store listing guard ───────────────────────────────────────────────
//
//   npm run store:check     # exit 1 if a listing would be refused or break policy
//   npm run store:listing   # this check, then fastlane supply (text only)
//
// Two things it refuses:
//
// 1. Play's length limits — title ≤ 30, short ≤ 80, full ≤ 4000, counted in code points.
//
// 2. HEALTH, PHARMACY OR eSIM WORDS, in any of the nine languages. On Play, ADA is NOT a
//    health app, and that is deliberate: declaring health features forces an Organization
//    developer account, and that combination is what got the app rejected on 2026-07-06
//    (CLAUDE.md → Compliance). The duty roster stays in the app; the listing never names
//    it. eSIM is here because CONNECTIVITY_LIVE is false, so the listing must not promise it
//    — drop that word from this list on the day the module goes live, not before.
//
// A word list that stops matching is a check that passes on everything. So every run
// first puts the bullets that were REMOVED from the 2026-09-24 draft through the same
// patterns, and refuses to report green unless each one is caught.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'fastlane/metadata/android'
const LANGS = ['tr-TR', 'en-US', 'ru-RU', 'ar', 'el-GR', 'fr-FR', 'es-ES', 'de-DE', 'fa']
const LIMITS = { 'title.txt': 30, 'short_description.txt': 80, 'full_description.txt': 4000 }

// Vets are not health content: the lookbehinds keep Tierärzte / دامپزشکان / أطباء بيطريون.
const FORBIDDEN = [
  /\be-?sim\b/iu,   // bounded: Turkish resim / kesim contain 'esim'
  /pharma|health|hospital|clinic|medic|doctor|duty/iu,
  /eczane|nöbetçi|sağlık|hastane|klinik|doktor|ilaç/iu,
  /аптек|дежурн|здоров|больниц|клиник|врач|лекарств/iu,
  /صيدل|مناوب|صحة|صحي|مستشف|عياد|طبيب|أطباء(?!\s*بيطري)|دواء|أدوية/u,
  /φαρμακ|εφημερ|υγεί|νοσοκομ|κλινικ|γιατρ/iu,
  /pharmacie|garde|santé|hôpital|médec/iu,
  /farmac|guardia|salud|clínica|médic/iu,
  /apothek|notdienst|gesundheit|krankenhaus|(?<!tier)ärzt|(?<!tier)arzt|medikament/iu,
  /داروخانه|کشیک|سلامت|بیمارستان|درمانگاه|(?<!دام)پزشک|دارو/u,
]

// Bullets 1 (duty pharmacies) and 6 (eSIM) as they stood in the draft, one per language.
const MUST_CATCH = [
  'Nöbetçi eczaneler – bugün hangi eczane açık', 'eSIM – Kıbrıs\'a gelmeden internetini hazırla',
  'Duty pharmacies – which pharmacy is open today',
  'Дежурные аптеки — какая аптека открыта сегодня',
  'الصيدليات المناوبة – أي صيدلية مفتوحة اليوم',
  'Εφημερεύοντα φαρμακεία – ποιο φαρμακείο είναι ανοιχτό σήμερα',
  'Pharmacies de garde – quelle pharmacie est ouverte',
  'Farmacias de guardia – qué farmacia está abierta hoy',
  'Notdienst-Apotheken – welche Apotheke heute geöffnet hat',
  'داروخانه‌های کشیک – امروز کدام داروخانه باز است',
]
const MUST_PASS = ['Haustiere – Tierärzte und Tierpensionen', 'حیوانات خانگی – دامپزشکان', 'أطباء بيطريون', 'resimler ve kesim']

// İ lowercases to i + U+0307 and would slip past /i; fold it before matching.
const hit = s => FORBIDDEN.find(re => re.test(s.replaceAll('İ', 'i')))

const fails = []
for (const s of MUST_CATCH) if (!hit(s)) fails.push(`self-test: pattern list no longer catches "${s}"`)
for (const s of MUST_PASS) if (hit(s)) fails.push(`self-test: "${s}" is a false positive (${hit(s)})`)

const present = existsSync(ROOT) ? readdirSync(ROOT).filter(d => !d.startsWith('.')) : []
for (const l of LANGS) if (!present.includes(l)) fails.push(`${l}: folder missing`)
// supply uploads EVERY folder here, so every folder is checked — not just the nine we expect.
for (const l of present) if (!LANGS.includes(l)) console.log(`note: ${l} is not one of the nine — checked and uploaded anyway`)

console.log('lang     title  short   full')
let checked = 0
for (const l of present) {
  const counts = []
  for (const [file, max] of Object.entries(LIMITS)) {
    const p = join(ROOT, l, file)
    if (!existsSync(p)) { fails.push(`${l}/${file}: missing`); counts.push('—'); continue }
    const txt = readFileSync(p, 'utf8')
    const n = [...txt].length
    counts.push(n)
    checked++
    if (n === 0) fails.push(`${l}/${file}: empty`)
    if (n > max) fails.push(`${l}/${file}: ${n} > ${max}`)
    txt.split('\n').forEach((line, i) => {
      const re = hit(line)
      if (re) fails.push(`${l}/${file}:${i + 1} matches ${re} → "${line.trim()}"`)
    })
  }
  console.log(`${l.padEnd(8)} ${String(counts[0]).padStart(5)} ${String(counts[1]).padStart(6)} ${String(counts[2]).padStart(6)}`)
}
console.log(`limits: title ≤${LIMITS['title.txt']}, short ≤${LIMITS['short_description.txt']}, full ≤${LIMITS['full_description.txt']} · ${checked} files read`)

if (checked !== present.length * 3) fails.push(`read ${checked} files, expected ${present.length * 3}`)
if (fails.length) {
  console.error(`\n✗ store listing check FAILED (${fails.length}):\n  ` + fails.join('\n  '))
  process.exit(1)
}
console.log(`✓ store listing OK — ${present.length} languages, no health/pharmacy/eSIM words (self-test: ${MUST_CATCH.length} caught, ${MUST_PASS.length} look-alikes allowed)`)
