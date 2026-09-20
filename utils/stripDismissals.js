import AsyncStorage from '@react-native-async-storage/async-storage'

// ─── Live-strip dismissals — per ROW id, per DEVICE ─────────────────────────
//
// Keyed on the home_strip_pin row id rather than on "the notice", so a second notice
// months from now is not silently pre-dismissed by somebody having closed the first one.
// That is the whole reason this is a list and not a boolean.
//
// ⚠ DEVICE-LOCAL ON PURPOSE. There is no server-side record and none is wanted: this is a
//   UI preference, not consent. A per-user row would be one more thing holding a fact
//   about a person, readable by whatever policy is written next, for no benefit the user
//   would notice.
//
// A failed read returns an EMPTY set rather than throwing. The consequence of getting
// this wrong in that direction is that somebody sees a card again; the consequence of
// throwing is that the whole strip resolve fails and the slot goes to the terminal rank.
// Showing a dismissed card once is the cheaper mistake.
const KEY = '@trnc_strip_dismissed'
const CAP = 50

export async function readStripDismissals() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

export async function addStripDismissal(id) {
  if (!id) return
  const set = await readStripDismissals()
  set.add(String(id))
  // Capped and FIFO-trimmed. Unbounded growth would be slow to matter and impossible to
  // notice — a row's id stays in here long after the row itself has expired out of its
  // flight window, so without a cap this only ever grows. 50 is far more notices than
  // this app will run; the trim keeps the oldest out rather than the newest.
  const arr = [...set].slice(-CAP)
  await AsyncStorage.setItem(KEY, JSON.stringify(arr))
}
