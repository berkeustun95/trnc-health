#!/usr/bin/env node
// ─── hotelsofnorthcyprus.com (KITOB's official guide) → local staging ───────
//
//   node scripts/crawl-hnc-hotels.mjs            # crawl (cached pages are reused)
//   node scripts/crawl-hnc-hotels.mjs --refresh  # refetch every page
//
// PERMISSION (Berke, 2026-09-29): KITOB approved using this site's photos and content in ADA;
// the written email is to follow (vault: kitob-import-geocode-PLAN). Credit shown with every
// photo: "Fotoğraf: KITOB – hotelsofnorthcyprus.com".
//
// POLITE: robots.txt (read 2026-09-29) disallows only /wp-admin/. One request at a time, 2 s
// apart, an identifying User-Agent, pages cached in data/hnc/pages/ so a re-run fetches nothing
// it already has. Only each hotel's MAIN photo is downloaded (the first gallery image).
//
// Writes data/hnc/hotels.json (gitignored): per site hotel → name, class, location, address,
// phone, email, description (English — the site has no Turkish), main photo URL, KITOB's own map
// marker (data-lat/data-lng), and a placeholder flag (Lorem ipsum is never imported).
// Matching to our 102 and the DB write are separate steps (import-hnc-hotels.mjs).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, 'data/hnc')
const UA = 'ADA-app hotel import (KITOB-approved; contact berkeustun95 via getadaapp.com)'
const REFRESH = process.argv.includes('--refresh')
const DELAY_MS = 2000
mkdirSync(resolve(DIR, 'pages'), { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function get(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null)
    if (r?.ok) return r
    await sleep(5000 * (i + 1))
  }
  throw new Error(`fetch failed: ${url}`)
}

const robots = await (await get('https://hotelsofnorthcyprus.com/robots.txt')).text()
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map(m => m[1])
const allowed = u => !disallowed.some(p => new URL(u).pathname.startsWith(p))

const sitemap = await (await get('https://hotelsofnorthcyprus.com/wp-sitemap-posts-hotel-1.xml')).text()
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(allowed)
console.log(`robots: disallow ${disallowed.join(', ') || '(none)'} · sitemap: ${urls.length} hotel pages`)

const decode = s => s.replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;/g, '–').replace(/&#038;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const text = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const PLACEHOLDER = /lorem ipsum|dolor sit amet|consectetur adipiscing|sed do eiusmod/i

function parse(url, html) {
  const info = html.slice(html.indexOf('class="hotel-info'))
  const name = text(info.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] || '')
  const location = text(info.match(/hotel-location[\s\S]*?<h4>([\s\S]*?)<\/h4>/)?.[1] || '')
  const klass = text(info.match(/<\/div>\s*<\/div>\s*<h4 class="px-4">([\s\S]*?)<\/h4>/)?.[1] || '')
  const gallery = info.match(/id="hotel-gallery"[\s\S]*?<\/section>/)?.[0] || ''
  const photos = [...gallery.matchAll(/<img[^>]*src="([^"]+)"/g)].map(m => m[1])
  // The description is the <p class="py-4 px-4"> block(s) between the header and Hotel Information
  // (there with or without a gallery).
  const paras = [...info.split('class="hotel-information')[0].matchAll(/<p class="py-4 px-4"[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => text(m[1])).filter(Boolean)
  const description = paras.join('\n\n')
  const block = info.match(/class="hotel-information[\s\S]*?class="hotel-facilities/)?.[0] || ''
  const address = text(block.match(/hotel-address[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || '')
  const phone = decode(block.match(/href="tel:([^"]+)"/)?.[1] || '')
  const email = decode(block.match(/href="mailto:([^"]+)"/)?.[1] || '')
  const site = [...block.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => decode(m[1])).find(h => !h.includes('hotelsofnorthcyprus.com')) || null
  const stars = +(info.match(/class="star-rating w-48[^"]*" src="[^"]*\/(\d)-star\.svg"/)?.[1] || 0) || null
  const marker = html.match(/class="marker" data-lat="([-\d.]+)" data-lng="([-\d.]+)"/)
  return { url, name, location, class: klass, stars, address, phone, email, website: site,
    description: PLACEHOLDER.test(description) ? null : (description || null),
    placeholder: PLACEHOLDER.test(description), photo: photos[0] || null, photo_count: photos.length, gallery: photos,
    marker: marker ? { lat: +marker[1], lng: +marker[2] } : null }
}

// Featured images: every page's "Nearby Hotels" cards pair a hotel link with that hotel's featured
// image (a WordPress thumbnail). 68 hotels have no gallery of their own, so this is their only
// photo. The thumbnail's -WxH suffix is stripped to reach the original upload.
function cards(html) {
  return [...html.matchAll(/<a href="(https:\/\/hotelsofnorthcyprus\.com\/hotels\/[^"]+)" class="single-similar-hotel[^"]*">\s*<img[^>]*src="([^"]+)"/g)]
    .map(m => [m[1], m[2].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1')])
}
const out = []
const featured = new Map()
let fetched = 0
for (const url of urls) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop()
  const cache = resolve(DIR, 'pages', `${slug}.html`)
  let html
  if (existsSync(cache) && !REFRESH) html = readFileSync(cache, 'utf8')
  else { if (fetched++) await sleep(DELAY_MS); html = await (await get(url)).text(); writeFileSync(cache, html) }
  for (const [u, img] of cards(html)) featured.set(u, img)
  const h = parse(url, html)
  if (!h.name) console.log(`  ⚠ could not parse a name: ${url}`)
  out.push({ slug, ...h })
}
for (const h of out) { h.featured = featured.get(h.url) || null; h.photo = h.photo || h.featured; h.photo_from = h.photo ? (h.photo === h.featured && h.photo_count === 0 ? 'featured' : 'gallery') : null }
writeFileSync(resolve(DIR, 'hotels.json'), JSON.stringify(out, null, 1))
const n = f => out.filter(f).length
console.log(`parsed ${out.length} (fetched ${fetched}, cached ${out.length - fetched}) · with photo ${n(h => h.photo)} · with description ${n(h => h.description)} · placeholder text skipped ${n(h => h.placeholder)} · with KITOB marker ${n(h => h.marker)}`)
for (const h of out.filter(h => h.placeholder)) console.log(`  placeholder (skipped): ${h.name}`)
