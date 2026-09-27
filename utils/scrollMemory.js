import { useRef, useCallback } from 'react'

// ─── Scroll memory — "back keeps your place" for views that DO unmount ─────────
//
// Overlays keep a list mounted under its detail (Events, Explore places, Housing…). Some
// levels cannot: an early return that swaps a landing for a category, or App.js swapping a
// whole page (Pets), or App.js unmounting a module for eSIM / the Welcome Guide. Those
// remember their offset here, keyed per view, and restore it on the next mount.
//
//   const mem = useScrollMemory('hs:landing')
//   <ScrollView {...mem} …>          (FlatList too)
//
// Restores once the content is tall enough to reach the saved offset; if it never gets
// that tall (the list shrank after a refresh) it stays at the furthest valid position.
// A drag by the user ends the restore, so it never fights them.
//
// Keys live for the app session. The owner forgets its prefix when the module closes
// (forgetScroll), so reopening a module starts at the top, as before.

const offsets = new Map()

export function forgetScroll(prefix) {
  for (const k of [...offsets.keys()]) if (k.startsWith(prefix)) offsets.delete(k)
}

export function useScrollMemory(key) {
  const node = useRef(null)
  const done = useRef(false)
  const viewport = useRef(0)
  // A stable callback ref re-arms the restore whenever a NEW scroll view attaches — the hook
  // may live in a parent that stays mounted while the list itself remounts (a landing that
  // comes back after its category page).
  const ref = useCallback(n => {
    if (n && n !== node.current) done.current = false
    node.current = n
  }, [])

  function restore(contentH) {
    if (done.current) return
    const y = offsets.get(key) || 0
    if (y <= 0) { done.current = true; return }
    const max = Math.max(0, contentH - viewport.current)
    const target = Math.min(y, max)
    const n = node.current
    if (n?.scrollToOffset) n.scrollToOffset({ offset: target, animated: false })
    else n?.scrollTo?.({ y: target, animated: false })
    if (target >= y) done.current = true
  }

  return {
    ref,
    scrollEventThrottle: 64,
    onLayout: e => { viewport.current = e.nativeEvent.layout.height },
    onScroll: e => { if (done.current) offsets.set(key, e.nativeEvent.contentOffset.y) },
    onScrollBeginDrag: () => { done.current = true },
    onContentSizeChange: (w, h) => restore(h),
  }
}
