# Curates data/institutions/{tr,cy,gb}.csv from the official lists, downloaded 2026-10-08:
#   YÖK yok.gov.tr/tr/university?type=1,2 (+ YÖK Atlas ids) · highereducation.ac.cy institution pages
#   OfS Register xlsx (2026-10-02) + /api/Provider · Medr register xlsx (31 Jul 2026)
#   sfc.ac.uk/our-funding/university-funding · nidirect.gov.uk universities-and-colleges-northern-ireland
# The raw downloads are not committed (official_*.csv, uk/*.xlsx, uk/providers.json); this file is
# the record of every hand decision on top of them: TR_NAME, CY_CITY, GB_NAME, GB_CITY, URL_FIX.
# Hipo university-domains-list was a cross-check only, never a source.

import csv, json, re, sys
from urllib.parse import urlparse
sys.path.insert(0, 'pylib')
import openpyxl
OUT = '/Users/berkeustun/trnc-health-intl/data/institutions'

def tr_lower(s):
    return s.replace('I', 'ı').replace('İ', 'i').lower()
def tr_title_word(w):
    return w[:1].replace('i', 'İ').replace('ı', 'I').upper() + w[1:] if w else w
def tr_city(s):
    return ' '.join(tr_title_word(tr_lower(p)) for p in s.split())

# Source links that do not answer as given, replaced by what they demonstrably lead to
# (checked 2026-10-08): the www host has no DNS / the http link redirects / TLS fails.
URL_FIX = {
    'https://www.gsu.edu.tr': 'https://gsu.edu.tr',
    'https://www.demiroglu.bilim.edu.tr': 'https://demiroglu.bilim.edu.tr',
    'https://www.anglia.ac.uk': 'https://www.aru.ac.uk',
    'https://www.bishopg.ac.uk': 'https://www.lincolnbishop.ac.uk',
}
def homepage(u):
    h = _homepage(u)
    return URL_FIX.get(h, h)
def _homepage(u):
    u = u.strip().split(' / ')[0].strip()
    if not re.match(r'^https?://', u): u = 'https://' + u
    p = urlparse(u)
    return 'https://' + p.netloc.lower()

def write(fn, rows):
    with open(f'{OUT}/{fn}', 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['source_key', 'name', 'city_name', 'website_url', 'source_url', 'note'])
        w.writeheader()
        for r in rows: w.writerow({k: r.get(k, '') for k in w.fieldnames})
    print(fn, len(rows))

# ── TR ──
TR_NAME = {
    'Kto Karatay Üniversitesi': 'KTO Karatay Üniversitesi',
    'Mef Üniversitesi': 'MEF Üniversitesi',
    'Ted Üniversitesi': 'TED Üniversitesi',
    'Tobb Ekonomi ve Teknoloji Üniversitesi': 'TOBB Ekonomi ve Teknoloji Üniversitesi',
    'Sanko Üniversitesi': 'SANKO Üniversitesi',
    'Bezm-İ Âlem Vakıf Üniversitesi': 'Bezm-i Âlem Vakıf Üniversitesi',
    'İzmir Katip Çelebi Üniversitesi': 'İzmir Kâtip Çelebi Üniversitesi',  # the university's own spelling (Berke, 2026-10-09)
    'Ostim Teknik Üniversitesi': 'OSTİM Teknik Üniversitesi',
}
tr = []
for x in csv.DictReader(open('official_tr.csv', encoding='utf-8')):
    if x['type'] == 'vakif_myo': continue
    n = TR_NAME.get(x['name_titlecase_derived'], x['name_titlecase_derived'])
    tr.append(dict(source_key='yok:' + x['yok_id'], name=n, city_name=tr_city(x['city']),
                   website_url=homepage(x['website']), source_url=x['source'],
                   note='devlet' if x['type'] == 'devlet' else 'vakıf'))
write('tr.csv', tr)

# ── CY ──
CY_CITY = {'Nicosia; Limassol': '', 'Pyla, Larnaca': 'Larnaca', 'Nicosia (Strovolos)': 'Nicosia', 'Pafos': 'Paphos'}
cy = []
for x in csv.DictReader(open('official_cy.csv', encoding='utf-8')):
    slug = x['source'].rstrip('/').rsplit('/', 1)[1]
    cy.append(dict(source_key='mesy:' + slug, name=x['name'], city_name=CY_CITY.get(x['city'], x['city']),
                   website_url=homepage(x['website']), source_url=x['source'], note=x['type']))
write('cy.csv', cy)

# ── GB ──
GB_NAME = {  # UKPRN → student-facing name, where the OfS legal name is not it
    '10007788': 'University of Cambridge', '10007774': 'University of Oxford',
    '10003270': 'Imperial College London', '10007799': 'Newcastle University',
    '10007154': 'University of Nottingham', '10007156': 'University of Salford',
    '10007138': 'University of Northampton', '10007767': 'Keele University',
    '10007768': 'Lancaster University', '10007143': 'Durham University',
    '10001282': 'Northumbria University', '10004351': 'Middlesex University',
    '10000824': 'Bournemouth University', '10007155': 'University of Portsmouth',
    '10007147': 'University of Hertfordshire', '10001883': 'De Montfort University',
    '10007776': 'University of Roehampton', '10037449': 'Plymouth Marjon University',
    '10005553': 'Royal Holloway, University of London', '10007164': 'University of the West of England, Bristol',
    '10008397': 'Norland University of Early Childhood', '10031982': 'BPP University',
    '10039956': 'The University of Law', '10005451': 'Arden University', '10037544': 'BIMM University',
    '10086591': "Regent's University London", '10032036': 'Amity University London',
    '10048199': 'Northeastern University London',
    '10005470': 'Richmond American University London', '10008173': 'University of the Built Environment',
    '10004063': 'London School of Economics and Political Science',
    '10007162': 'University of the Arts London',
    # London colleges without university title (added by decision 2026-10-08)
    '10003645': "King's College London", '10007775': 'Queen Mary University of London',
    '10007780': 'SOAS University of London', '10002718': 'Goldsmiths, University of London',
    '10007760': 'Birkbeck, University of London',
}
GB_CITY = {'Newcastle Upon Tyne': 'Newcastle upon Tyne', 'Newcastle-upon-Tyne': 'Newcastle upon Tyne',
           'Stoke on Trent': 'Stoke-on-Trent'}
KEEP_THE = {'The Open University'}
def gb_clean(n):
    if n in KEEP_THE: return n
    return re.sub(r'^The ', '', n)
prov = {p['Ukprn']: p for p in json.load(open('uk/providers.json'))}
gb = []
OFS = 'https://register-api.officeforstudents.org.uk/api/Download/ (OfS Register, file 2026-10-02)'
for x in csv.DictReader(open('official_uk_ofs_england.csv', encoding='utf-8')):
    if x['flag']: continue
    if x['ukprn'] == '10082728': continue  # INTO University Partnerships: a pathway company, not a university (Berke, 2026-10-09)
    gb.append(dict(source_key='ukprn:' + x['ukprn'], name=GB_NAME.get(x['ukprn'], gb_clean(x['name'])),
                   city_name=GB_CITY.get(x['city'], x['city']), website_url=homepage(x['website']),
                   source_url=OFS, note='England, OfS university title'))
for uk in ['10003645', '10007775', '10007780', '10002718', '10007760']:
    p = prov[uk]
    addr = [l.strip() for l in p['ContactAddress'].split('\n') if l.strip()]
    city = addr[-3]  # line before the postcode, before "United Kingdom"
    assert city == 'London', (uk, addr)
    gb.append(dict(source_key='ukprn:' + uk, name=GB_NAME[uk], city_name=city, website_url=homepage(p['Website']),
                   source_url='https://register-api.officeforstudents.org.uk/api/Provider (OfS, registered, no university title)',
                   note='England, University of London college'))
MEDR = 'https://www.medr.cymru/wp-content/uploads/2026/07/Register-Medr-31Jul2026-English.xlsx'
WALES_CITY = {'Bangor University': 'Bangor', 'Cardiff University': 'Cardiff', 'Swansea University': 'Swansea',
              'Cardiff Metropolitan University': 'Cardiff', 'University of Wales Trinity Saint David': 'Carmarthen',
              'University of South Wales': 'Pontypridd', 'Wrexham University': 'Wrexham', 'Aberystwyth University': 'Aberystwyth'}
ws = openpyxl.load_workbook('uk/medr.xlsx', read_only=True).active
for i, r in enumerate(ws.iter_rows(values_only=True)):
    if i < 3 or not r[0] or r[3] == 'Not applicable': continue
    assert WALES_CITY[r[0]].lower() in r[5].lower(), (r[0], r[5])
    gb.append(dict(source_key='medr:' + r[0], name=r[0], city_name=WALES_CITY[r[0]], website_url=homepage(r[9]),
                   source_url=MEDR, note='Wales, Medr register, university title'))
s = open('uk/sfc_unifund.html', encoding='utf-8', errors='ignore').read()
blk = s[s.find('http://www.abertay.ac.uk') - 200:]
for u, t in re.findall(r'href="(https?://[^"]+)"[^>]*>([^<]{3,80})<', blk)[:19]:
    t = t.strip()
    if t == 'Open University in Scotland': continue  # same institution as The Open University (OfS)
    gb.append(dict(source_key='sfc:' + t, name=t, city_name='', website_url=homepage(u),
                   source_url='https://www.sfc.ac.uk/our-funding/university-funding/', note='Scotland, SFC-funded'))
NI = 'https://www.nidirect.gov.uk/articles/universities-and-colleges-northern-ireland'
gb.append(dict(source_key='nidirect:Queen\'s University Belfast', name="Queen's University Belfast", city_name='Belfast',
               website_url='https://www.qub.ac.uk', source_url=NI, note='Northern Ireland; city from the name, URL from the source link'))
gb.append(dict(source_key='nidirect:Ulster University', name='Ulster University', city_name='',
               website_url='https://www.ulster.ac.uk', source_url=NI, note='Northern Ireland; three campuses (Belfast, Coleraine, Derry~Londonderry)'))
write('gb.csv', gb)
names = [r['name'] for r in tr + cy + gb]
dups = {n for n in names if names.count(n) > 1}
print('duplicate names:', dups or 'none')
