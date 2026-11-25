import { countryCodeOptions, countryCodeMatches } from '../constants/countryCodes'

const find = (lang, q) => countryCodeOptions(lang).filter(o => countryCodeMatches(o, q)).map(o => o.value)

describe('phone-code picker search', () => {
  const queries = ['turkey', 'Turkey', 'Türkiye', 'turkiye', 'TÜRKİYE', 'türkiye', 'TURKIYE', '90', '+90']
  for (const lang of ['Turkish', 'English']) {
    for (const q of queries) {
      it(`${lang}: "${q}" finds +90`, () => { expect(find(lang, q)).toContain('+90') })
    }
  }
  it('a different country does not match', () => {
    expect(find('Turkish', 'greece')).not.toContain('+90')
    expect(find('English', 'greece')).toEqual(['+30'])
  })
  it('diacritics: Almanya, Germany, Deutschland-less, Türkçe-folded names', () => {
    expect(find('Turkish', 'almanya')).toEqual(['+49'])
    expect(find('Turkish', 'germany')).toEqual(['+49'])
    expect(find('Turkish', 'ISVEC')).toEqual(['+46'])
    expect(find('Turkish', 'Suudi Arabistan')).toEqual(['+966'])
  })
  it('stored values are unchanged', () => {
    expect(countryCodeOptions('Turkish')[0].value).toBe('+90')
  })
})
