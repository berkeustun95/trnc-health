#!/usr/bin/env node
// utils/money.js — the shared amount formatter. npm run money:check
// Runs on Node's full ICU; Hermes on Android uses the device ICU, so the device screenshot is the
// other half of the evidence (Turkish grouping on the phone), not this.
import { formatAmount, moneyText, propertyPriceText, numberLocale } from '../utils/money.js'

let bad = 0
const t = (name, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(54)} ${JSON.stringify(got)}${ok ? '' : `  wanted ${JSON.stringify(want)}`}`)
}

t('Turkish groups with a dot', moneyText(129000, 'GBP', 'Turkish'), '£129.000')
t('English groups with a comma', moneyText(129000, 'GBP', 'English'), '£129,000')
t('German groups with a dot', moneyText(1250000, 'EUR', 'German'), '€1.250.000')
t('locale follows the app language, not the device', numberLocale('Turkish'), 'tr')
t('English is en-GB', numberLocale('English'), 'en-GB')
t('unknown currency keeps its code', moneyText(5, 'CHF', 'English'), 'CHF 5')
t('null amount -> null, never "£0"', moneyText(null, 'GBP', 'Turkish'), null)
t('empty string -> null', formatAmount('', 'English'), null)
t('decimals shown only when the value has them', formatAmount(1499.5, 'Turkish', { decimals: 2 }), '1.499,50')
t('a whole number stays bare with decimals allowed', formatAmount(1499, 'Turkish', { decimals: 2 }), '1.499')
t('rent carries its period suffix (Turkish)', propertyPriceText({ price: 900, currency: 'GBP', price_period: 'monthly' }, 'Turkish'), '£900/ay')
t('sale (total) has no suffix', propertyPriceText({ price: 214000, currency: 'GBP', price_period: 'total' }, 'Turkish'), '£214.000')
t('price on request (Turkish label)', propertyPriceText({ price: null, price_on_request: true, currency: 'GBP' }, 'Turkish'), 'Fiyat için arayın')
t('price on request wins over a stray price', propertyPriceText({ price: 1, price_on_request: true, currency: 'GBP' }, 'English'), 'Call for price')
t('no price, not on request -> null (nothing rendered)', propertyPriceText({ price: null, currency: 'GBP' }, 'English'), null)
t('a row from before 20261153 (no column) still prices', propertyPriceText({ price: 98000, currency: 'GBP' }, 'English'), '£98,000')

if (bad) { console.log(`\n  ${bad} money-format check(s) FAILED`); process.exit(1) }
console.log('\nmoney format: OK')
