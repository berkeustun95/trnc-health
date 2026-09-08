# Partner assets

Drop the files here at EXACTLY these paths, then uncomment the matching block in
`constants/partnerAssets.js` and run `npm run partners:check`.

Nothing in the app reads this folder directly. `constants/partners.js` names string
KEYS; `constants/partnerAssets.js` is the only file that turns a key into a file, and
Metro resolves those `require()`s at build time — so a path that does not exist is a
bundler error, not a missing image. That is why the entries ship commented out.

## TadilArt Cyprus — 18 files

    tadilart-logo.png                        1600x455  transparent, BLACK mark
    tadilart-logo-onDark.png                 1600x455  transparent, WHITE mark

    tadilart/bathroom/before_1_wc.jpg
    tadilart/bathroom/before_2_shower.jpg
    tadilart/bathroom/before_3_basin.jpg
    tadilart/bathroom/after_1_wide.jpg
    tadilart/bathroom/after_2_vanity.jpg
    tadilart/bathroom/after_3_shower.jpg
    tadilart/bathroom/after_4_wc.jpg
    tadilart/bathroom/after_5_basin.jpg
    tadilart/bathroom/after_6_door.jpg
    tadilart/bathroom/progress_1.jpg

    tadilart/extension/01_oncesi.jpg
    tadilart/extension/02_baslangic.jpg
    tadilart/extension/03_celik.jpg
    tadilart/extension/04_insa.jpg
    tadilart/extension/05_cephe.jpg
    tadilart/extension/06_sonuc.jpg

If the photos are `.png`, change the extension in `constants/partnerAssets.js` — one
file, one place. `constants/partners.js` never names a file.

## No text in the images

Every label — Öncesi / Sonrası and the six sequence steps — is rendered from
`constants/i18n.js` in nine languages and drawn OVER the photo. The source posts had
English "Before" / "In Progress" burned into the artwork; those crops must not come
back, because a burned-in English word is a label seven of our nine locales cannot read
and no translation can fix.
