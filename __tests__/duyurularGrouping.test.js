import fs from 'fs'
import path from 'path'
import { groupDuyurular, stageOf, foldTitle, matchesQuery, closingSoonCount } from '../constants/duyurular'
import { pushRoute } from '../utils/pushRoute'

let n = 0
const row = (title, day, extra = {}) => ({ id: `r${++n}`, title, published_at: `${day}T08:00:00+00:00`, official_url: `https://x/${n}`, ...extra })
const shown = out => out.map(c => c.title)

describe('stageOf', () => {
  it('reads stage, exam and date; singular/plural and date case do not split an exam', () => {
    const a = stageOf('YATAKLI TEDAVİ KURUMLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR (6 kASIM 2026)')
    const b = stageOf('YATAKLI TEDAVİ KURUMLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVLARI KESİNLEŞTİ (11 Kasım 2026)')
    expect(a).toEqual({ stage: 1, exam: b.exam, date: '6 KASIM 2026' })
    expect(b.stage).toBe(3)
    expect(stageOf('TAPU VE KADASTRO DAİRESİ MÜNHAL KADROSUNUN YAZILI SINAVI YAPILDI (8 Kasım 2026)').exam)
      .toBe(stageOf('TAPU VE KADASTRO DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVLARI YAPILIYOR').exam)
  })
  it('keeps written and oral exams apart, and ignores titles without SINAV or a stage word', () => {
    expect(stageOf('YATAKLI TEDAVİ KURUMLARI DAİRESİ SÖZLÜ SINAVLARI YAPILDI (1 Ekim 2026)').exam)
      .not.toBe(stageOf('YATAKLI TEDAVİ KURUMLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVLARI YAPILDI (4 Ekim 2026)').exam)
    expect(stageOf('Ustalık ve Kalfalık Belgesi Uygulama Sınavı Kayıtları 5-15 Ekim’de…')).toBeNull()
    expect(stageOf('Yol çalışması yapıldı')).toBeNull()
  })
  it('folds Turkish letters both ways', () => {
    expect(foldTitle('Dışişleri İhtiyat Şube Ğ Ü Ö Ç')).toBe('DISISLERI IHTIYAT SUBE G U O C')
  })
})

describe('groupDuyurular', () => {
  it('one card per sitting, carrying the latest stage, earlier stages newest first', () => {
    const a = row('DIŞİŞLERİ DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR (21 Ekim 2026)', '2026-10-14')
    const b = row('DIŞİŞLERİ DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI (21 Ekim 2026)', '2026-10-21')
    const c = row('DIŞİŞLERİ DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI KESİNLEŞTİ (27 Ekim 2026)', '2026-10-27')
    const out = groupDuyurular([b, c, a])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(c.id)
    expect(out[0].earlier.map(e => e.id)).toEqual([b.id, a.id])
  })
  it('an undated stage joins a dated one', () => {
    const out = groupDuyurular([
      row('KARAYOLLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR (8 Ekim 2026)', '2026-09-25'),
      row('KARAYOLLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI', '2026-10-08'),
    ])
    expect(out).toHaveLength(1)
  })
  it('a YAPILDI finds its YAPILIYOR past an unrelated card of the same exam', () => {
    const out = groupDuyurular([
      row('YATAKLI TEDAVİ KURUMLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVLARI YAPILIYOR (4 Ekim 2026)', '2026-09-25'),
      row('YATAKLI TEDAVİ KURUMLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVLARI KESİNLEŞTİ (29 Eylül 2026)', '2026-09-29'),
      row('YATAKLI TEDAVİ KURUMLARI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVLARI YAPILDI (4 Ekim 2026)', '2026-10-04'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].title).toMatch(/YAPILDI \(4 Ekim/)
    expect(out[0].earlier).toHaveLength(1)
    expect(out[1].earlier).toHaveLength(0)
  })
  it('unclear cases stay separate: same stage twice, different dates, a stage skipped back, too far apart', () => {
    const sameStage = groupDuyurular([
      row('TAPU VE KADASTRO DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI (8 Kasım 2026)', '2026-11-08'),
      row('TAPU VE KADASTRO DAİRESİ MÜNHAL KADROSUNUN YAZILI SINAVI YAPILDI (8 Kasım 2026)', '2026-11-08'),
    ])
    expect(sameStage).toHaveLength(2)
    const otherDate = groupDuyurular([
      row('YÜKSEK MAHKEME GENEL SEKRETERLİĞİ SÖZLÜ SINAVI (MÜLAKAT) YAPILIYOR (28 Eylül 2026)', '2026-09-25'),
      row('YÜKSEK MAHKEME GENEL SEKRETERLİĞİ SÖZLÜ SINAVI (MÜLAKAT) YAPILDI (1 Ekim 2026)', '2026-10-01'),
    ])
    expect(otherDate).toHaveLength(2)
    const skip = groupDuyurular([
      row('İHTİYAT SANDIĞI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR', '2026-09-28'),
      row('İHTİYAT SANDIĞI DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI KESİNLEŞTİ (2 Ekim 2026)', '2026-10-02'),
    ])
    expect(skip).toHaveLength(2)
    const far = groupDuyurular([
      row('SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR', '2026-09-01'),
      row('SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI', '2026-09-23'),
    ])
    expect(far).toHaveLength(2)
  })
  it('a new YAPILIYOR opens a new sitting after a finished one', () => {
    const out = groupDuyurular([
      row('SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR', '2026-11-02'),
      row('SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI', '2026-11-08'),
      row('SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR (25 Kasım 2026)', '2026-11-22'),
    ])
    expect(shown(out)).toEqual([
      'SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR (25 Kasım 2026)',
      'SOSYAL HİZMETLER DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI',
    ])
  })
  it('hides exact reposts across sources and ages, keeping the newest', () => {
    const old = row('2026-2027 Eğitim Öğretim Yılı Güz Dönemi Yüksek Öğrenim Burs Müracaatları Devam Ediyor', '2026-09-30')
    const neu = row('2026-2027 Eğitim Öğretim Yılı Güz Dönemi Yüksek Öğrenim Burs Müracaatları Devam Ediyor', '2026-10-22')
    const x = row('Ustalık ve Kalfalık Belgesi Uygulama Sınavı Kayıtları 5-15 Ekim’de...', '2026-10-01', { institution: 'Mesleki Teknik Öğretim Dairesi' })
    const y = row('Ustalık ve Kalfalık Belgesi Uygulama Sınavı Kayıtları 5-15 Ekim’de…', '2026-10-02', { institution: 'Kıbrıs Türk Esnaf ve Zanaatkârlar Odası' })
    const out = groupDuyurular([old, x, neu, y])
    expect(out.map(c => c.id)).toEqual([neu.id, y.id])
    expect(out[0].earlier.map(e => e.id)).toEqual([old.id])
  })
  it('different titles are never hidden, rows are not mutated, the output is newest first', () => {
    const rows = [row('Bir duyuru', '2026-10-01'), row('Başka bir duyuru', '2026-10-03'), row('Üçüncü', '2026-10-02')]
    const before = JSON.stringify(rows)
    const out = groupDuyurular(rows)
    expect(shown(out)).toEqual(['Başka bir duyuru', 'Üçüncü', 'Bir duyuru'])
    expect(out.every(c => c.earlier.length === 0)).toBe(true)
    expect(JSON.stringify(rows)).toBe(before)
  })
})

describe('what grouping must not break (Berke, hold point 1)', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  it('search: a word only a hidden stage carries still finds the shown card', () => {
    const [card] = groupDuyurular([
      row('DIŞİŞLERİ DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILIYOR (21 Ekim 2026)', '2026-10-14'),
      row('DIŞİŞLERİ DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI YAPILDI', '2026-10-21'),
      row('DIŞİŞLERİ DAİRESİ MÜNHAL KADROLARININ YAZILI SINAVI KESİNLEŞTİ (27 Ekim 2026)', '2026-10-27', { institution: 'Kamu Hizmeti Komisyonu' }),
    ])
    expect(card.earlier).toHaveLength(2)
    expect(card.title).toMatch(/KESİNLEŞTİ/)
    expect(matchesQuery(card, 'yapılıyor')).toBe(true)
    expect(matchesQuery(card, '21 ekim')).toBe(true)
    expect(matchesQuery(card, 'tapu')).toBe(false)
    const [rep] = groupDuyurular([
      row('Ustalık Belgesi Kayıtları', '2026-10-01', { institution: 'Mesleki Teknik Öğretim Dairesi' }),
      row('Ustalık Belgesi Kayıtları', '2026-10-02', { institution: 'Esnaf ve Zanaatkârlar Odası' }),
    ])
    expect(matchesQuery(rep, 'mesleki teknik')).toBe(true)
  })
  it('banner: counts cards as the list shows them, a repost once', () => {
    const rows = [
      row('Burs Müracaatları Devam Ediyor', '2026-09-30'),
      row('Burs Müracaatları Devam Ediyor', '2026-10-22'),
      row('Başka bir ilan', '2026-10-20'),
    ]
    expect(closingSoonCount(rows)).toBe(2)
    expect(closingSoonCount([])).toBe(0)
    const b = read('components/home/redesign/DuyurularBanner.js')
    expect(b).toMatch(/setClosing\(closingSoonCount\(data\)\)/)
    expect(b).not.toMatch(/head: true/)
    expect(b).toMatch(/data\.length === count/)
  })
  it('push: no push opens a single announcement, so a hidden row cannot be a push target', () => {
    // If a per-announcement push is ever added, it must resolve a hidden row to its shown card: this test is the reminder.
    for (const screen of ['duyurular', 'duyuru', 'announcement', 'announcements']) expect(pushRoute({ screen, id: 'x' })).toBeNull()
    expect(read('utils/pushRoute.js')).not.toMatch(/duyuru|announcement/i)
    expect(read('screens/DuyurularScreen.js')).toMatch(/export default function DuyurularScreen\(\{ lang, onBack, backRef = null \}\)/)
  })
})

describe('wiring', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  it('the list groups what it fetched; the detail links every earlier stage', () => {
    expect(read('screens/DuyurularScreen.js')).toMatch(/setItems\(groupDuyurular\(await fetchAll\(\)\)\)/)
    const d = read('screens/DuyuruDetailScreen.js')
    expect(d).toMatch(/earlier\.map\(/)
    expect(d).toMatch(/openUrl\(e\.official_url, 'earlier'\)/)
    // A failed open shows its alert beside what was tapped, not under the main button.
    expect(d).toMatch(/openFailed === 'main' && <InlineAlert/)
    expect(d).toMatch(/openFailed === 'earlier' && <InlineAlert/)
    expect(d).toMatch(/t\('duyEarlierStages', lang\)/)
  })
})
