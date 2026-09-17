import { createContext } from 'react'

// ─── What is UNDERNEATH a piece of text ─────────────────────────────────────
//
// Two signals, both existing only so utils/devTextAudit.js (__DEV__) can answer one
// question: "is this label sitting straight on the photo?" Nothing here changes a pixel,
// and nothing here is dev-gated — a context with no consumer and a counter nobody reads
// cost less than the `if (__DEV__)` branches it would take to strip them, and keeping
// them unconditional means the production tree and the audited tree are the SAME tree.
// An audit that only runs against a differently-shaped tree is measuring something else.
//
// ► ON_SAFE_SURFACE — set by anything that paints its own opaque background.
//   ContentCard is the one that matters: it is how every readable label in ADA gets to be
//   readable. Any other component that lays an opaque surface under its children (a solid
//   header band, a filled pill) can provide it too, and SHOULD, because otherwise the
//   audit will flag legible text sitting on it. That is the known noise source in this
//   check — see the audit's header.
export const OnSafeSurface = createContext(false)

// ► PHOTO BACKDROP — a COUNTER, not a context, and that asymmetry is forced.
//   PageBackground does not wrap the screen's content; it renders as an absoluteFill
//   SIBLING of it (see components/PageBackground.js and any of its 22 callers). A context
//   provider inside it would reach nothing at all — the labels are not its descendants.
//   So "is a photo backdrop on screen" is a property of the SCREEN, tracked by mount, and
//   the only thing the audit can honestly ask.
//
//   The consequence: this is screen-wide, so it cannot tell that one label is over the
//   photo and another is over a solid header further down. That is what OnSafeSurface is
//   for, and between the two the common cases are covered.
export const photoBackdrop = { count: 0 }
