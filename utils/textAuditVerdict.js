// ─── The truncation verdict, with nothing around it ─────────────────────────
//
// ► THIS MODULE IMPORTS NOTHING, AND THAT IS LOAD-BEARING.
//   utils/devTextAudit.js cannot be imported under plain Node — it pulls in react-native
//   and dies on a module-resolution error before it can be asked a single question. So the
//   part that actually decides "did this string get cut off" lives here instead, where a
//   test can import the REAL function rather than a copy of it. constants/messaging.js and
//   constants/profileGate.js are import-free for exactly this reason.
//
//   Testing a copy is not testing. A copy is a second implementation that agrees with the
//   first until someone edits one of them.

// React's own flattening rules, because the source has to be what React would render:
// null/undefined/booleans contribute nothing, numbers stringify, arrays recurse, and a
// nested <Text> contributes its children. An inline <Image> or icon contributes nothing,
// which is correct — it occupies space but no characters.
export function flattenChildren(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string') { out.push(node); return }
  if (typeof node === 'number')  { out.push(String(node)); return }
  if (Array.isArray(node)) { for (const child of node) flattenChildren(child, out); return }
  if (node.props && node.props.children !== undefined) flattenChildren(node.props.children, out)
}

export function sourceTextOf(children) {
  const parts = []
  flattenChildren(children, parts)
  return parts.join('')
}

export function renderedTextOf(lines) {
  if (!Array.isArray(lines)) return ''
  return lines.map(l => (l && typeof l.text === 'string' ? l.text : '')).join('')
}

// Two normalisations, and the split matters.
//
// `display` is for the message a human reads.
//
// `dense` — ALL whitespace removed — is what the lengths are compared on, and it is the one
// doing real work. A line break eats the space it broke on, and whether the engine reports
// that space at the end of line N, the start of line N+1, or not at all is a platform
// detail nobody should have to be right about. Comparing raw lengths would flag every
// wrapped label in the app; comparing collapsed whitespace still depends on which side the
// space landed. Counting only non-whitespace characters is immune to all of it, and
// truncation removes real characters, so nothing that matters is lost.
export const display = s => String(s).replace(/\s+/g, ' ').trim()
export const dense   = s => String(s).replace(/\s+/g, '')

// The verdict. Characters went missing ⇒ the string did not fit.
//
// ► NOT `lines.length === numberOfLines`. That is true of every label that legitimately
//   fills its allowed lines, so it cannot tell healthy from broken — an assertion with no
//   red to go to for the one input that matters.
export function isTruncated(source, lines) {
  const rendered = renderedTextOf(lines)
  return dense(rendered).length < dense(source).length
}
