---
name: ada-design-audit
description: Visual design audit lens for ADA (React Native / Expo): hierarchy, spacing rhythm, typography, colour, alignment and consistency against ada-style tokens. Use when auditing or reviewing any ADA screen.
---

# Visual design audit (React Native)

Audit from a screenshot first, then confirm in code (file:line). Every finding names the token it should use.

## Check
- **Hierarchy:** one clear primary element per screen; title → section → row steps through `type`
  (pageTitle/detailTitle → sectionHeading → rowTitle → body/small → meta/caption). No two adjacent levels
  that look the same; no one-off `fontSize`.
- **Spacing rhythm:** paddings/gaps from `space` (4/8/12/16/20/24). Gutters equal on both sides and equal
  to the sibling screen. Vertical rhythm between sections consistent. Raw numbers off the scale are findings.
- **Alignment:** left edges of header, cards and section headings share one line; icons optically centred
  in their wells; baselines of side-by-side text align; numbers right-aligned in columns.
- **Colour:** tokens only (`colors.*`, `category.*`); no raw hex outside theme.js. Navy anywhere in ADA's
  frame is a finding (ada-style §6). Text-on-tint pairs from theme.js, not improvised.
- **Surfaces:** cards `radii.card` + `elevation.card`, never border AND shadow; on a module photo use
  `Card`/`ListCard` (0.93 white). One canvas per screen.
- **Consistency:** the same thing looks the same everywhere (chips, badges, back button, section headers).
  A near-copy of a `components/ui/` component is a finding: name the component to reuse.
- **Density & truncation:** at 320dp width and in Turkish, nothing clips or ellipsizes that should not;
  single-line hugging labels carry `ellipsizeSlack`.

## Tools
`npm run home:check`, `npm run labels:check`, `npm run hero:check`, `npm run logo:check`,
`npm run refs:check`, `node scripts/check-font-family.mjs`. `utils/devTextAudit.js` measures clipped text on device.
Print what each one checked; a green guard answers only its own question.
