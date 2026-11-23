import { Dimensions } from 'react-native'

// The house banner counts as seen once at least this share of its height is on screen.
export const HOUSE_VISIBLE_SHARE = 0.5

// Share (0..1) of a box at window y with height h that lies between the window top and bottomInset above the
// window bottom (the floating tab bar covers that band, so a banner under it is not on screen).
export function shareOnScreen(y, h, windowH, bottomInset) {
  if (!(h > 0)) return 0
  const seen = Math.min(y + h, windowH - bottomInset) - Math.max(y, 0)
  return Math.max(0, Math.min(1, seen / h))
}

// Measured live every time (never a cached onLayout position): the Home hub restores its scroll offset with no
// scroll event, and the strip above can change height after it loads.
export function measureShare(node, bottomInset, cb) {
  if (!node || typeof node.measureInWindow !== 'function') return
  node.measureInWindow((_x, y, _w, h) => cb(shareOnScreen(y, h, Dimensions.get('window').height, bottomInset)))
}
