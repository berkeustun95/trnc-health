#!/usr/bin/env python3
"""One-off: KITOB's member-list workbook -> data/kitob template CSV.

  python3 scripts/convert-kitob-xlsx.py "data/kitob/raw/KITOB Üye Listesi - 17 Eylül 2026.xlsx" \
      data/kitob/kitob-2026-09-17.csv

Python standard library only (an .xlsx is a zip of XML), so nothing is added to package.json.
Reads the "Alfabetik liste" sheet only: the other two sheets carry the same hotels but drop
some websites, and Kaya Artemis's site differs there. The "No" column is alphabetical
position, not a member number, so uye_no stays empty and the importer keys on name + region.
Bed counts are not carried (no column for them). The output feeds scripts/import-kitob-hotels.mjs.

Prints a review report: totals, generic websites hidden, and every value it had to repair.
"""
import csv, re, sys, zipfile, xml.etree.ElementTree as ET

SHEET = 'Alfabetik liste'
EXPECTED_ROWS = 102
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

CLASSES = {  # KITOB label -> template label the importer accepts
    '*****': '5 Yıldız', '****': '4 Yıldız', '***': '3 Yıldız', '**': '2 Yıldız', '*': '1 Yıldız',
    'touristic bungalow': 'Bungalow', 'holiday village': 'Tatil Köyü', 'boutique hotel': 'Butik Otel',
    'special certificated': 'Özel Sertifikalı', 'apart hotel': 'Apart Otel',
}
CITIES = {'GİRNE': 'Girne', 'İSKELE': 'İskele', 'GAZİMAĞUSA': 'Gazimağusa', 'GAZIMAĞUSA': 'Gazimağusa',
          'LEFKOŞA': 'Lefkoşa', 'GÜZELYURT': 'Güzelyurt', 'LEFKE': 'Lefke'}
# Karpaz is ADA's 7th region; KITOB files these villages under İSKELE. Berke 2026-09-29: follow
# constants/regions.js, "east of Boğaz = Karpaz" (Bafra resort strip included). Boğaz and İskele
# centre stay İskele. Only applied when KITOB's city is İSKELE.
KARPAZ_VILLAGES = {'Bafra', 'Yeni Erenköy', 'Kaplıca', 'Mehmetçik'}

# Links that point at a directory or an unrelated site rather than the hotel (Berke, 2026-09-29).
GENERIC_SITES = {'northcyprus.net'}
HIDE_SITE_FOR = {('LORD\'S PALACE HOTEL & SPA', 'girnelimancasino.com'), ('DORANA HOTEL', 'tourism.neu.edu.tr')}
# Domains that no longer resolve (NXDOMAIN, checked twice 2026-09-29). Hidden by Berke's ruling:
# a dead link is worse than none. Re-check at go-live; a hotel may have a new site.
DEAD_SITES = {'arkinpalmbeachhotel.com', 'citrus-tree.com', 'clubalda.org', '5-fingers.co.uk',
              'flippersholidayvillage.com', 'hotelfonorthcyprus.com', 'kaplıcabeach.com',
              'girnelimancasino.com', 'sammyshotels.com', 'adabeachhotel.com', 'parkheritage.com'}
# Answered only over plain http in the 2026-09-29 check; every other site is stored as https.
HTTP_ONLY = {'grandsapphireresort.com', 'balciplaza.com', 'mountainviewcyprus.com'}

URL_RE = re.compile(r'^(https?://)?[a-z0-9ıçğöşü][a-z0-9ıçğöşü.-]*\.[a-zıçğöşü]{2,}(/\S*)?$', re.I)
ABBREV = {'VIL.': 'VILLAGE', 'BUNG.': 'BUNGALOWS', 'HOL.RES.HOTEL&BUNG': 'HOLIDAY RESORT HOTEL & BUNGALOWS',
          'APT': 'APART'}
LOWER_PARTICLES = {'di', 'de', 'la', 'le', 'les', 've', 'and'}
# Words whose plain capital I is Turkish ı. Everything else maps I -> i (English words), and
# İ -> i always (KITOB types İ in English words too: VİLLAGE, CASİNO, AİRPORT).
TURKISH_I = {'ALTINKAYA', 'ARDIÇ', 'AĞACI', 'DENİZKIZI', 'KAPLICA', 'BALCI', 'ARKIN', 'KAŞGAR',
             'MİMOZA', 'ÇELEBİ', 'KOCAREİS', 'SKALİ', 'RESTORAN', 'TATİL', 'KÖYÜ', 'ÜNBAY', 'BÜYÜK',
             'ANADOLU', 'KEMERLİ', 'KONAK', 'BUTİK', 'OTEL', 'LAPİDA', 'OSMAN', 'AGA', 'VELMER'}


def read_sheet(path, name):
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    for sh in wb.find('m:sheets', NS):
        if sh.get('name') != name:
            continue
        tgt = rels[sh.get('{%s}id' % NS['r'])].lstrip('/')
        tgt = tgt if tgt.startswith('xl/') else 'xl/' + tgt
        rows = []
        for row in ET.fromstring(z.read(tgt)).iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                col = re.match(r'[A-Z]+', c.get('r')).group()
                v = c.find('m:v', NS)
                if c.get('t') == 's':
                    cells[col] = ss[int(v.text)]
                elif c.get('t') == 'inlineStr':
                    cells[col] = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                else:
                    cells[col] = v.text if v is not None else ''
            rows.append(cells)
        return rows
    sys.exit(f'sheet {name!r} not found')


def squash(s):
    return ' '.join((s or '').split())


def split_name_site(cell):
    toks = squash(cell).split(' ')
    site = None
    if toks and URL_RE.match(toks[-1]):
        site = toks.pop()
    while toks and toks[-1] in ('-', '–'):
        toks.pop()
    return ' '.join(toks), site


def word_case(w, first):
    up = ABBREV.get(w, w)
    if up != w:
        return ' '.join(word_case(x, first and i == 0) for i, x in enumerate(up.split(' ')))
    if '&' in w and w != '&':
        return ' & '.join(word_case(p, first) for p in w.split('&') if p)
    turkish = w.strip(".,'") in TURKISH_I
    low = w.replace('İ', 'i').replace('I', 'ı' if turkish else 'i').lower()
    if not first and low in LOWER_PARTICLES:
        return low
    # Capitalise the first letter (a word KITOB starts with İ keeps İ: İskele); after an
    # apostrophe the rest stays lower case (Lord's, Noah's).
    if not low:
        return low
    head = 'İ' if w.startswith('İ') else low[0].upper()
    return head + low[1:]


def display_name(raw):
    words = raw.split(' ')
    out = ' '.join(word_case(w, i == 0) for i, w in enumerate(words))
    return re.sub(r'\s+', ' ', out)


def region_and_address(cell):
    s = squash(cell)
    m = re.match(r'^(?:(?P<village>[^,]+),\s*)?(?P<city>[A-ZÇĞİÖŞÜ]+)(?:\s*\((?P<paren>[^)]+)\))?$', s)
    if not m:
        return None, None, f'region {s!r} not understood'
    city = CITIES.get(m.group('city'))
    village = m.group('village')
    paren = m.group('paren')
    if paren and paren not in ('East', 'West', 'Center'):
        village = village or paren          # "GİRNE (Çatalköy)", "İSKELE (Kaplıca)"
    if village and village.upper() == village:   # "BALIKESİR" — a village near Ercan, not the city
        village = village.replace('İ', 'i').replace('I', 'ı').lower().capitalize()
    if not city:
        return None, None, f'city {m.group("city")!r} not mapped'
    if village and village in KARPAZ_VILLAGES:
        city = 'Karpaz'
    return city, village, None


def phone(cell):
    s = squash(cell).replace('(+9 392)', '(+90 392)')
    first = re.split(r'\s*/\s*', s)[0]
    return first, (s if first != s else None)


def main(src, dst):
    rows = read_sheet(src, SHEET)
    data = [r for r in rows if re.fullmatch(r'\d+(\.0)?', (r.get('A') or '').strip())]
    report = {'hidden': [], 'dead': [], 'repairs': [], 'second_numbers': [], 'errors': [], 'no_site': []}
    out = []
    for r in data:
        raw_name, site = split_name_site(r.get('B'))
        klass = CLASSES.get(squash(r.get('C')).lower()) or CLASSES.get(squash(r.get('C')))
        if not klass:
            report['errors'].append(f'{raw_name}: class {r.get("C")!r} not mapped')
        city, village, err = region_and_address(r.get('D'))
        if err:
            report['errors'].append(f'{raw_name}: {err}')
        tel, extra = phone(r.get('E'))
        if '(+9 392)' in squash(r.get('E')):
            report['repairs'].append(f'{raw_name}: phone "(+9 392" -> "(+90 392"')
        if extra:
            report['second_numbers'].append(f'{raw_name}: {extra!r} -> kept {tel!r}')
        if site:
            bare = re.sub(r'^(https?://)?(www\.)?', '', site).rstrip('/').lower()
            host = bare.split('/')[0]
            if bare in GENERIC_SITES or (raw_name, bare) in HIDE_SITE_FOR:
                report['hidden'].append(f'{raw_name}: {site}')
                site = None
            elif host in DEAD_SITES:
                report['dead'].append(f'{raw_name}: {site}')
                site = None
            else:
                path = re.sub(r'^(https?://)?', '', site).rstrip('/')
                site = ('http://' if host in HTTP_ONLY else 'https://') + path
        else:
            report['no_site'].append(raw_name)
        out.append({'uye_no': '', 'otel_adi': display_name(raw_name), 'sinif': klass or '',
                    'ilce': city or '', 'adres': village or '', 'telefon': tel, 'eposta': '',
                    'web_sitesi': site or '', 'enlem': '', 'boylam': '', '_kitob_name': raw_name})
    if len(out) != EXPECTED_ROWS:
        report['errors'].append(f'{len(out)} hotels read, expected {EXPECTED_ROWS}')
    with open(dst, 'w', newline='', encoding='utf-8') as f:
        cols = ['uye_no', 'otel_adi', 'sinif', 'ilce', 'adres', 'telefon', 'eposta', 'web_sitesi', 'enlem', 'boylam']
        w = csv.DictWriter(f, fieldnames=cols, delimiter=';', extrasaction='ignore')
        w.writeheader()
        w.writerows(out)
    from collections import Counter
    print(f'{len(out)} hotels -> {dst}')
    print('classes:', dict(Counter(o['sinif'] for o in out)))
    print('regions:', dict(Counter(o['ilce'] for o in out)))
    for k in ('errors', 'repairs', 'second_numbers', 'hidden', 'dead', 'no_site'):
        print(f'\n{k} ({len(report[k])}):')
        for line in report[k]:
            print('  ' + line)
    return out, report


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
